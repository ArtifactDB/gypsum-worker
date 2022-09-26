import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as gh from "./github.js";
import * as lock from "./lock.js";
import * as expiry from "./expiry.js";

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

    let exp = expiry.expiresInMilliseconds(request);
    await lock.lockProject(project, version, bound_bucket, user, { expiry: exp });

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
                linked[f.filename] = f.value.artifactdb_id;
            } else {
                throw new utils.HttpError("invalid entry in the request 'filenames'", 400);
            }
        } else {
            throw new utils.HttpError("invalid entry in the request 'filenames'", 400);
        }
    }

    // Resolving the MD5sums against the current latest version. Note that we
    // fetch the 'latest' from the bucket rather than relying on the cache, 
    // as we would otherwise do in the /files endpoint.
    if (md5able.length) {
        let lres = await bound_bucket.get(project + "/..latest.json");
        if (lres == null) {
            for (const f of md5able) {
                add_presigned_url(f.filename);
            }
        } else {
            let lmeta = await lres.json();
            let last = lmeta.version;

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

    // If there are any links, save them for later use.
    if (Object.keys(linked).length) {
        nonblockers.push(utils.quickUploadJson(bound_bucket, project + "/" + version + "/..links.json", linked));
    }

    for (const [k, v] of Object.entries(linked)) {
        linked[k] = "/link/" + encodeURIComponent(project + ":" + k + "@" + version) + "/" + encodeURIComponent(v);
    }

    let presigned_vec = await Promise.all(precollected);
    let presigned = {};
    for (var i = 0; i < presigned_vec.length; i++) {
        presigned[prenames[i]] = presigned_vec[i];
    }

    let completer = "/projects/" + project + "/version/" + version + "/complete";
    return utils.jsonResponse({ presigned_urls: presigned, links: linked, completion_url: completer }, 200);
}

/**************** Create links ***************/

export async function createLinkHandler(request, bound_bucket, globals, nonblockers) {
    let from = decodeURIComponent(request.params.from);
    let unpacked = utils.unpackId(from);
    let to = decodeURIComponent(request.params.to);

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
    if (!("owners" in body)) {
        body.owners = [user];
    }
    if (!("viewers" in body)) {
        body.viewers = [];
    }
    auth.checkPermissions(body);

    let overwrite = request.query.overwrite_permissions === "true";
    let info = await gh.postNewIssue(
        "upload complete",
        JSON.stringify({ 
            project: project,
            version: version,
            timestamp: Date.now(),
            permissions: { 
                read_access: body.read_access, 
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
