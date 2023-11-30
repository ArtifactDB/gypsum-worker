import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as gh from "./github.js";
import * as lock from "./lock.js";
import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";

/**************** Initialize uploads ***************/

function splitByUploadType(files) {
    let simple = [];
    let md5able = [];
    let linked = [];

    for (const f of files) {
        if (typeof f != "object") {
            throw new utils.HttpError("each entry of 'files' should be an object", 400);
        }

        if (!("path" in f) || typeof f.path != "string") {
            throw new utils.HttpError("'path' property in entries of 'files' should be a string", 400);
        }
        let fname = f.path;
        if (fname.startsWith("..") || fname.includes("/..")) {
            throw new utils.HttpError("'path' property in entries of 'files' cannot contain the reserved '..' pattern", 400);
        }

        if (!("check" in f) || typeof f.check != "string") {
            throw new utils.HttpError("'check' property in entries of 'files' should be a string", 400);
        }

        if (f.check === "simple" || f.check == "md5") {
            if (!("md5sum" in f) || typeof f.md5sum != "string") {
                throw new utils.HttpError("'md5sum' property in entries of 'files' should be a string", 400);
            }
            if (!("size" in f) || typeof f.size != "number" || f.size <= 0) {
                throw new utils.HttpError("'size' property in entries of 'files' should be a positive integer", 400);
            }
            if (f.check === "simple") {
                simple.push(f);
            } else {
                md5able.push(f);
            }

        } else if (f.check == "link") {
            if (!("target" in f) || !(f.target instanceof Object)) {
                throw new utils.HttpError("'target' property in entries of 'files' should be an object", 400);
            }
            let target = f.target;
            if (!("project" in target) || typeof target.project != "string") {
                throw new utils.HttpError("'target.project' property in entries of 'files' should be a string", 400);
            }
            if (!("asset" in target) || typeof target.asset != "string") {
                throw new utils.HttpError("'target.asset' property in entries of 'files' should be a string", 400);
            }
            if (!("version" in target) || typeof target.version != "string") {
                throw new utils.HttpError("'target.version' property in entries of 'files' should be a string", 400);
            }
            if (!("path" in target) || typeof target.path != "string") {
                throw new utils.HttpError("'target.path' property in entries of 'files' should be a string", 400);
            }
            linked.push(f);

        } else {
            throw new utils.HttpError("invalid 'check' in the entries of 'files'", 400);
        }
    }

    return { 
        simple: simple, 
        md5: md5able, 
        link: linked 
    };
}

async function attemptMd5Deduplication(project, asset, md5able, simple, linked) {
    let lres = await bound_bucket.get(pkeys.latestVersion(project, asset));
    if (lres == null) {
        for (const f of md5able) {
            simple.push(f);
        }
    } else {
        let last = JSON.parse(lres).version;
        let manifest = await bound_bucket.get(pkeys.versionManifest(project, asset, lres));

        let by_sum_and_size = {};
        for (const x of manifest) {
            let key = x.md5sum + "_" + String(x.size);
            by_sum_and_size[key] = x.path;
        }

        let promises = [];
        for (const f of md5able) {
            let key = f.md5sum + "_" + String(f.size);
            if (key in by_sum_and_size) {
                linked.append({ 
                    path: f.path, 
                    target: { 
                        project: project, 
                        asset: asset, 
                        version: last,
                        path: by_sum_and_size[key]
                    } 
                });
            } else {
                simple.push(f);
            }
        }
    }
}

function preparePresignedUrls(simple, project, asset, version, bucket, s3obj) {
    let precollected = [];
    let prenames = [];
    let premd5 = [];

    for (const f of simple) {
        // Convert hex to base64 to keep S3 happy.
        let hits = f.md5sum.match(/\w{2}/g);
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

    return {
        paths: prenames,
        hashes: premd5,
        presigned_urls: precollected,
    };
}

async function createLinks(linked, project, asset, version, bucket) {
    let is_present = [];
    for (const f of linked) {
        let res = bucket.head(f.target.project + "/" + f.target.asset + "/" + f.target.version + "/" + f.target.path);
        is_present.push(res);
    }

    let resolved = await Promise.all(is_present);
    for (var i = 0; i < resolved.length; i++) {
        if (resolved[i] == null) {
            let f = linked[i];
            let target = f.target.project + "/" + f.target.asset + "/" + f.target.version + "/" + f.target.path;
            throw new utils.HttpError("failed to link to '" + target + "'", 400);
        }
    }

    // TODO: add linking structures.
    return;
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
    if (!(body instanceof Object)) {
        throw new utils.HttpError("expected request body to be a JSON object");
    }

    if (!("files" in body) || !(body.files instanceof Array)) {
        throw new utils.HttpError("expected 'files' to be an array");
    }
    let split = splitByUploadType(body.files);

    if (split.md5.length) {
        await attemptMd5Deduplication(project, asset, split.md5, split.simple, split.linked);
    }

    let prepped = preparePresignedUrls(split.simple, project, asset, version, bucket, s3obj);
    await createLinks(split.linked, project, asset, version, bucket);




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

    let presigned = [];
    {
        let resolved_urls = await prepped.presigned_urls;
        for (var i = 0; i < prepped.urls.length; i++) {
            presigned.push({ path: prepped.paths[i], url: resolved_urls[i], hash: prepped.hashes[i] });
        }
    }

    // Build a manifest.
    nonblockers.push(utils.quickUploadJson(pkeys.versionManifest(project, version), all_files));

    return utils.jsonResponse({ 
        presigned_urls: presigned, 
        completion_url: "/projects/" + project + "/asset/" + asset + "/version/" + version + "/complete",
        abort_url: "/projects/" + project + "/asset/" + asset + "/version/" + version + "/abort",
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
