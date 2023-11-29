import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as gh from "./github.js";
import * as lock from "./lock.js";
import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";

/**************** Initialize uploads ***************/

    function add_presigned_url(f, md5) {
        // Convert hex to base64 to keep S3 happy.
        let hits = md5.match(/\w{2}/g);
        let converted = hits.map(a => String.fromCharCode(parseInt(a, 16)));
        let md5_64 = btoa(converted.join(""));

        let params = { Bucket: bucket, Key: project + "/" + asset + "/" + version + "/" + f, Expires: 3600, ContentMD5: md5_64 };
        if (f.endsWith(".json")) {
            params.ContentType = "application/json";
        }
        precollected.push(s3obj.getSignedUrlPromise('putObject', params));
        prenames.push(f);
        premd5.push(md5_64);
    }


/**************** Initialize uploads ***************/

export async function initializeUploadHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.package);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    if (project.indexOf("/") >= 0) {
        throw new utils.HttpError("project name cannot contain '/'", 400);
    }
    if (asset.indexOf("/") >= 0) {
        throw new utils.HttpError("asset name cannot contain '/'", 400);
    }
    if (version.indexOf("/") >= 0) {
        throw new utils.HttpError("version name cannot contain '/'", 400);
    }
    if (project.startsWith("..") || asset.startsWith("..") || version.startsWith("..")) {
        throw new utils.HttpError("project, asset and version names cannot start with the reserved '..'", 400);
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
        await auth.checkNewUploadPermissions(user, request, nonblockers);
    }

    let ver_meta = await bound_bucket.head(pkeys.versionSummary(project, assset, version));
    if (ver_meta != null) {
        throw new utils.HttpError("version '" + version + "' already exists for asset '" + asset + "' in project '" + project + "'", 400);
    }

    await lock.lockProject(project, asset, user.login);
    let body;
    try {
        body = await request.json();
    } catch (e) {
        throw new utils.HttpError("failed to parse JSON body; " + String(err), 400);
    }

    let precollected = [];
    let prenames = [];
    let premd5 = [];
    function add_presigned_url(f, md5) {
        // Convert hex to base64 to keep S3 happy.
        let hits = md5.match(/\w{2}/g);
        let converted = hits.map(a => String.fromCharCode(parseInt(a, 16)));
        let md5_64 = btoa(converted.join(""));

        let params = { Bucket: bucket, Key: project + "/" + asset + "/" + version + "/" + f, Expires: 3600, ContentMD5: md5_64 };
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

    if (!("files" in body) || !(body.files instanceof Array)) {
        throw new utils.HttpError("expected 'files' to be an array");
    }

    for (const f of body.files) {
        if (typeof f != "object") {
            throw new utils.HttpError("each entry of 'files' should be an object", 400);
        }

        if (!("path" in f) || typeof f.path != "string") {
            throw new utils.HttpError("'path' property in entries of 'files' should be a string", 400);
        }
        let fname = f.path;
        if (fname.startsWith("..") || fname.includes("/..")) {
            throw new utils.HttpError("'path' property in entries of 'files' cannot start with the reserved '..' pattern", 400);
        }

        if (!("check" in f) || typeof f.check != "string") {
            throw new utils.HttpError("'check' property in entries of 'files' should be a string", 400);
        }

        if (f.check === "simple") {
            if (!("md5sum" in f) || typeof f.md5sum != "string") {
                throw new utils.HttpError("'md5sum' property in entries of 'files' should be a string", 400);
            }
            add_presigned_url(fname, f.md5sum);
        } else if (f.check === "md5") {
            if (!("md5sum" in f) || typeof f.md5sum != "string") {
                throw new utils.HttpError("'md5sum' property in entries of 'files' should be a string", 400);
            }
            md5able.push(f);
        } else if (f.check == "link") {
            if (!("project" in f) || typeof f.project != "string") {
                throw new utils.HttpError("'project' property in entries of 'files' should be a string", 400);
            }
            if (!("asset" in f) || typeof f.asset != "string") {
                throw new utils.HttpError("'asset' property in entries of 'files' should be a string", 400);
            }
            if (!("version" in f) || typeof f.version != "string") {
                throw new utils.HttpError("'version' property in entries of 'files' should be a string", 400);
            }
            linked.push(f);
            let id = project + "/" + asset + "/" + version + "/" + path;
            if (!(id in link_dest_exists)) {
                link_dest_exists[id] = bound_bucket.head(id);
            }
        } else {
            throw new utils.HttpError("invalid 'check' in the entries of 'files'", 400);
        }
    }

    // Resolving the MD5sums against the current latest version. 
    if (md5able.length) {
        let lres = await bound_bucket.get(pkeys.latestVersion(project, asset));
        if (lres == null) {
            for (const f of md5able) {
                add_presigned_url(f.filename, f.value.md5sum);
            }
        } else {
            let last = lres.version;
            let manifest = await bound_bucket.get(pkeys.versionManifest(project, asset));
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
