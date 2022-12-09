import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as gh from "./github.js";
import * as lock from "./lock.js";
import * as expiry from "./expiry.js";
import * as pkeys from "./internal.js";
import * as latest from "./latest.js";
import * as s3 from "./s3.js";
import { complete_project_version, upload_project_version } from "./validators.js";

/**************** Initialize uploads ***************/

export async function initializeUploadHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let version = decodeURIComponent(request.params.version);

    if (project.indexOf("/") >= 0 || project.indexOf(":") >= 0) {
        throw new utils.HttpError("project name cannot contain '/' or ':'", 400);
    }
    if (version.indexOf("/") >= 0 || version.indexOf("@") >= 0) {
        throw new utils.HttpError("version name cannot contain '/' or 'a'", 400);
    }
    if (project.startsWith("..") || version.startsWith("..")) {
        throw new utils.HttpError("project and version name cannot start with the reserved '..' pattern", 400);
    }

    let bucket = s3.getBucketName();
    let s3obj = s3.getS3Object();
    let bound_bucket = s3.getR2Binding();

    let resolved = await utils.namedResolve({
        user: auth.findUser(request, nonblockers),
        permissions: auth.getPermissions(project, nonblockers)
    });
    let user = resolved.user;
    let perms = resolved.permissions;
    if (perms !== null) {
        auth.checkWritePermissions(perms, user, project);
    } else {
        auth.checkNewUploadPermissions(user);
    }

    let ver_meta = await bound_bucket.head(pkeys.versionMetadata(project, version));
    if (ver_meta != null) {
        throw new utils.HttpError("version '" + version + "' already exists for project '" + project + "'", 400);
    }

    await lock.lockProject(project, version, user.login);
    let body = await request.json();
    if (!upload_project_version(body)) {
        throw new utils.HttpError("invalid request body: " + upload_project_version.errors[0].message + " (" + upload_project_version.errors[0].schemaPath + ")", 400);
    }

    let precollected = [];
    let prenames = [];
    let premd5 = [];
    function add_presigned_url(f, md5) {
        // Convert hex to base64 to keep S3 happy.
        let hits = md5.match(/\w{2}/g);
        let converted = hits.map(a => String.fromCharCode(parseInt(a, 16)));
        let md5_64 = btoa(converted.join(""));

        let params = { Bucket: bucket, Key: project + "/" + version + "/" + f, Expires: 3600, ContentMD5: md5_64 };
        if (f.endsWith(".json")) {
            params.ContentType = "application/json";
        }
        precollected.push(s3obj.getSignedUrlPromise('putObject', params));
        prenames.push(f);
        premd5.push(md5_64);
    }

    let md5able = [];
    let linked = [];
    let link_dest_exists = {};
    let link_expiry_checks = new Set;
    let link_projects = new Set;

    for (const f of body.filenames) {
        if (typeof f != "object") {
            throw new utils.HttpError("invalid entry in the request 'filenames'", 400);
        }

        let fname = f.filename;
        if (fname.startsWith("..") || fname.includes("/..")) {
            throw new utils.HttpError("'filenames' path elements cannot start with the reserved '..' pattern", 400);
        }

        if (f.check === "simple") {
            add_presigned_url(fname, f.value.md5sum);
        } else if (f.check === "md5") {
            md5able.push(f);
        } else if (f.check == "link") {
            let id = f.value.artifactdb_id;
            let upack = utils.unpackId(id);
            if (upack.version == "latest") {
                throw new utils.HttpError("cannot link to a 'latest' alias in 'filenames'", 400);
            }

            link_projects.add(upack.project);
            link_expiry_checks.add(pkeys.expiry(upack.project, upack.version));
            linked.push({ filename: fname, target: id });

            if (!(id in link_dest_exists)) {
                link_dest_exists[id] = bound_bucket.head(upack.project + "/" + upack.version + "/" + upack.path);
            }
        } else {
            throw new utils.HttpError("invalid entry in the request 'filenames'", 400);
        }
    }

    // Resolving the MD5sums against the current latest version. 
    if (md5able.length) {
        let lres = await latest.getLatestPersistentVersionOrNull(project);
        if (lres == null || lres.index_time < 0) {
            for (const f of md5able) {
                add_presigned_url(f.filename, f.value.md5sum);
            }
        } else {
            let last = lres.version;
            async function check_md5(filename, field, md5sum) {
                let res = await bound_bucket.get(project + "/" + last + "/" + filename + ".json");
                if (res !== null) {
                    let meta = await res.json();
                    if (meta[field] == md5sum) {
                        linked.push({ filename: filename, target: utils.packId(project, filename, last) });
                        return;
                    }
                } 
                add_presigned_url(filename, md5sum);
            }

            let promises = [];
            for (const f of md5able) {
                promises.push(check_md5(f.filename, f.value.field, f.value.md5sum));
            }
            await Promise.all(promises);
        }
    }
    
    // Checking if the linked versions have appropriate permissions, and any expiry date.
    {
        let links = Array.from(link_expiry_checks);
        let bad_links = await Promise.all(links.map(k => bound_bucket.head(k)));
        for (var i = 0; i < bad_links.length; i++) {
            if (bad_links[i] !== null) {
                let details = links[i].split("/");
                throw new utils.HttpError("detected links to a transient project '" + details[0] + "' (version '" + details[1] + "')", 400);
            }
        }

        let projects = Array.from(link_projects);
        let project_perms = await Promise.all(projects.map(p => auth.getPermissions(p, nonblockers)));
        for (var i = 0; i < project_perms.length; i++) {
            try {
                auth.checkReadPermissions(project_perms[i], user, projects[i]);
            } catch (e) {
                e.message = "failed to create a link; " + e.message;
                throw e;
            }
        }

        for (const [k, v] of Object.entries(link_dest_exists)) {
            if ((await v) == null) {
                throw new utils.HttpError("link target '" + k + "' does not exist");
            }
        }
    }

    // If there are any links, save them for later use.
    if (linked.length) {
        let link_targets = {};
        for (const l of linked) {
            link_targets[l.filename] = l.target;
        }
        nonblockers.push(utils.quickUploadJson(pkeys.links(project, version), link_targets));
    }

    for (var i = 0; i < linked.length; i++) {
        let current = linked[i];
        let src = utils.packId(project, current.filename, version);
        current.url = "/link/" + btoa(src) + "/to/" + btoa(current.target);
        delete current.target;
    }

    // Saving expiry information. We used to store this in the lock file, but
    // that gets deleted on completion, and we want to make sure that indexing
    // is idempotent; so we make sure it survives until expiration.
    if ("expires_in" in body) {
        let exp = expiry.expiresInMilliseconds(body.expires_in);
        nonblockers.push(utils.quickUploadJson(pkeys.expiry(project, version), { "expires_in": exp }));
    }

    let presigned_vec = await Promise.all(precollected);
    let presigned = [];
    for (var i = 0; i < presigned_vec.length; i++) {
        presigned.push({ filename: prenames[i], url: presigned_vec[i], md5sum: premd5[i] });
    }

    let all_files = [];
    for (const p of presigned) {
        all_files.push(p.filename);
    }
    for (const l of linked) {
        all_files.push(l.filename);
    }
    nonblockers.push(utils.quickUploadJson(pkeys.versionManifest(project, version), all_files));

    nonblockers.push(gh.postNewIssue("purge project",
        JSON.stringify({ 
            project: project,
            version: version,
            mode: "incomplete",
            delete_after: Date.now() + 2 * 3600 * 1000 
        })
    ));

    return utils.jsonResponse({ 
        presigned_urls: presigned, 
        links: linked, 
        completion_url: "/projects/" + project + "/version/" + version + "/complete",
        abort_url: "/projects/" + project + "/version/" + version + "/abort"
    }, 200);
}

/**************** Create links ***************/

export async function createLinkHandler(request, nonblockers) {
    let from = atob(request.params.source);
    let to = atob(request.params.target);
    let unpacked = utils.unpackId(from);

    let user = await auth.findUser(request, nonblockers);
    await lock.checkLock(unpacked.project, unpacked.version, user.login);

    let path = unpacked.project + "/" + unpacked.version + "/" + unpacked.path;
    let details = { "artifactdb_id": to };

    // Store the details both inside the file and as the metadata.
    nonblockers.push(utils.quickUploadJson(path, details, details));

    return new Response(null, { status: 202 });
}

/**************** Complete uploads ***************/

export async function completeUploadHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let version = decodeURIComponent(request.params.version);

    let user = await auth.findUser(request, nonblockers);
    await lock.checkLock(project, version, user.login);

    let body = await request.json();
    if (!complete_project_version(body)) {
        throw new utils.HttpError("invalid request body: " + complete_project_version.errors[0].message + " (" + complete_project_version.errors[0].schemaPath + ")", 400);
    }

    if (!("read_access" in body)) {
        body.read_access = "public";
    }
    if (!("write_access" in body)) {
        body.write_access = "owners";
    }
    if (!("owners" in body)) {
        body.owners = [user.login];
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
        })
    );
    let payload = await info.json();

    return utils.jsonResponse({ job_id: payload.number }, 202);
}

export async function queryJobIdHandler(request, nonblockers) {
    let jid = request.params.jobid;

    let info = await gh.getIssue(jid);
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

export async function abortUploadHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let version = decodeURIComponent(request.params.version);

    let user = await auth.findUser(request, nonblockers);
    await lock.checkLock(project, version, user.login);

    // Doesn't actually do anything, as we already have an purge job running as
    // soon as the upload is started; this endpoint is just for compliance with
    // the reference API.
    return new Response(null, { status: 202 });
}
