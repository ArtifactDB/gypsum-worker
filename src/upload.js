import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as gh from "./github.js";
import * as lock from "./lock.js";
import * as expiry from "./expiry.js";
import * as pkeys from "./internal.js";
import * as latest from "./latest.js";

/**************** Initialize uploads ***************/

export async function initializeUploadHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let version = request.params.version;

    let bucket = globals.r2_bucket_name;
    let master = globals.gh_master_token;
    let s3obj = globals.s3_binding;

    let user = await auth.findUser(request, master, nonblockers);
    if (user == null) {
        throw new utils.HttpError("no user identity supplied", 401);
    } else if (!auth.uploaders.has(user)) {
        throw new utils.HttpError("user is not registered as an uploader", 403);
    } else {
        let perms = await auth.getPermissions(project, bound_bucket, nonblockers);
        if (perms !== null && auth.determinePrivileges(perms, user) != "owner") {
            throw new utils.HttpError("user is not registered as an owner of the project", 403);
        }
    }

    await lock.lockProject(project, version, bound_bucket, user);
    let body = await request.json();
    let files = body.filenames;

    let precollected = [];
    let prenames = []
    function add_presigned_url(f) {
        let params = { Bucket: bucket, Key: project + "/" + version + "/" + f, Expires: 3600 };
        if (f.endsWith(".json")) {
            params.ContentType = "application/json";
        }
        precollected.push(s3obj.getSignedUrlPromise('putObject', params));
        prenames.push(f);
    }

    let md5able = [];
    let linked = {};
    let link_expiry_checks = new Set;

    for (const f of files) {
        if (typeof f == "string") {
            add_presigned_url(f);

        } else if (typeof f == "object") {
            if (f.check === "md5") {
                md5able.push(f);

            } else if (f.check == "link") {
                let upack = utils.unpackId(f.value.artifactdb_id);
                if (upack.version == "latest") {
                    throw new utils.HttpError("cannot link to a 'latest' alias in 'filenames'", 400);
                }

                link_expiry_checks.add(pkeys.expiry(upack.project, upack.version));
                linked[f.filename] = f.value.artifactdb_id;

            } else {
                throw new utils.HttpError("invalid entry in the request 'filenames'", 400);
            }

        } else {
            throw new utils.HttpError("invalid entry in the request 'filenames'", 400);
        }
    }

    // Resolving the MD5sums against the current latest version. 
    if (md5able.length) {
        let lres = await latest.getLatestPersistentVersionOrNull(project, bound_bucket);
        if (lres == null || lres.index_time < 0) {
            for (const f of md5able) {
                add_presigned_url(f.filename);
            }
        } else {
            let last = lres.version;
            async function check_md5(filename, field, md5sum) {
                let res = await bound_bucket.get(project + "/" + last + "/" + filename + ".json");
                if (res !== null) {
                    let meta = await res.json();
                    if (meta[field] == md5sum) {
                        linked[filename] = project + ":" + filename + "@" + last;
                        return;
                    }
                } 
                add_presigned_url(filename);
            }

            let promises = [];
            for (const f of md5able) {
                promises.push(check_md5(f.filename, f.value.field, f.value.md5sum));
            }
            await Promise.all(promises);
        }
    }
    
    // Checking if the linked versions have any expiry date.
    {
        let links = Array.from(link_expiry_checks);
        let bad_links = await Promise.all(links.map(k => bound_bucket.head(k)));
        for (var i = 0; i < bad_links.length; i++) {
            if (bad_links[i] !== null) {
                let details = links[i].split("/");
                throw new utils.HttpError("detected links to a transient project '" + details[0] + "' (version '" + details[1] + "')", 400);
            }
        }
    }

    // If there are any links, save them for later use.
    if (Object.keys(linked).length) {
        nonblockers.push(utils.quickUploadJson(bound_bucket, pkeys.links(project, version), linked));
    }

    for (const [k, v] of Object.entries(linked)) {
        let src = project + ":" + k + "@" + version;
        linked[k] = "/link/" + btoa(src) + "/to/" + btoa(v);
    }

    // Saving expiry information. We used to store this in the lock file, but
    // that gets deleted on completion, and we want to make sure that indexing
    // is idempotent; so we make sure it survives until expiration.
    if ("expires_in" in body) {
        let exp = expiry.expiresInMilliseconds(body.expires_in);
        nonblockers.push(utils.quickUploadJson(bound_bucket, pkeys.expiry(project, version), { "expires_in": exp }));
    }

    let presigned_vec = await Promise.all(precollected);
    let presigned = {};
    for (var i = 0; i < presigned_vec.length; i++) {
        presigned[prenames[i]] = presigned_vec[i];
    }

    nonblockers.push(gh.postNewIssue("purge project",
        JSON.stringify({ 
            project: project,
            version: version,
            mode: "incomplete",
            delete_after: Date.now() + 2 * 3600 * 1000 
        }),
        master
    ));

    return utils.jsonResponse({ 
        presigned_urls: presigned, 
        links: linked, 
        completion_url: "/projects/" + project + "/version/" + version + "/complete",
        abort_url: "/projects/" + project + "/version/" + version + "/abort"
    }, 200);
}

/**************** Create links ***************/

export async function createLinkHandler(request, bound_bucket, globals, nonblockers) {
    let from = atob(request.params.source);
    let to = atob(request.params.target);
    let unpacked = utils.unpackId(from);

    let master = globals.gh_master_token;
    let user = await auth.findUser(request, master, nonblockers);
    await lock.checkLock(unpacked.project, unpacked.version, bound_bucket, user);

    let path = unpacked.project + "/" + unpacked.version + "/" + unpacked.path;
    let details = { "artifactdb_id": to };

    // Store the details both inside the file and as the metadata.
    nonblockers.push(utils.quickUploadJson(bound_bucket, path, details, details));

    return new Response(null, { status: 202 });
}

/**************** Complete uploads ***************/

export async function completeUploadHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let version = request.params.version;

    let master = globals.gh_master_token;
    let user = await auth.findUser(request, master, nonblockers);
    await lock.checkLock(project, version, bound_bucket, user);

    let body = await request.json();
    if (!("read_access" in body)) {
        body.read_access = "public";
    }
    if (!("write_access" in body)) {
        body.read_access = "owners";
    }
    if (!("owners" in body)) {
        body.owners = [user];
    }
    if (!("viewers" in body)) {
        body.viewers = [];
    }
    body.scope = "project";
    auth.validateNewPermissions(body);

    let overwrite = request.query.overwrite_permissions === "true";
    let info = await gh.postNewIssue(
        "upload complete",
        JSON.stringify({ 
            project: project,
            version: version,
            timestamp: Date.now(),
            permissions: { 
                scope: "project",
                read_access: body.read_access, 
                write_access: body.write_access,
                owners: body.owners,
                viewers: body.viewers
            },
            overwrite_permissions: overwrite
        }),
        master
    );
    let payload = await info.json();

    return utils.jsonResponse({ job_id: payload.number }, 202);
}

export async function queryJobIdHandler(request, bound_bucket, globals, nonblockers) {
    let jid = request.params.jobid;
    let master = globals.gh_master_token;

    let info = await gh.getIssue(jid, master);
    let payload = await info.json();

    let state = "PENDING";
    if (payload.state == "closed") {
        state = "SUCCESS";
    } else if (payload.comments > 0) {
        state = "FAILURE"; // any comments indicates failure, otherwise it would just be closed.
    }

    return utils.jsonResponse({ 
        status: state,
        job_url: gh.createIssueUrl(jid)
    }, 200);
}

/**************** Abort upload ***************/

export async function abortUploadHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let version = request.params.version;

    let master = globals.gh_master_token;
    let user = await auth.findUser(request, master, nonblockers);
    await lock.checkLock(project, version, bound_bucket, user);

    // Doesn't actually do anything, as we already have an purge job running as
    // soon as the upload is started; this endpoint is just for compliance with
    // the reference API.
    return new Response(null, { status: 202 });
}
