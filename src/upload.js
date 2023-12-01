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

async function getVersionManifest(project, asset, version, bound_bucket, manifest_cache) {
    let key = project + "/" + asset + "/" + version;
    if (key in manifest_cache) {
        return manifest_cache[key];
    }

    let raw_manifest = await bound_bucket.get(pkeys.versionManifest(project, asset, lres));
    let manifest = JSON.parse(raw_manifest);
    manifest_cache[key] = manifest;
    return manifest;
}

async function attemptMd5Deduplication(simple, md5able, linked, project, asset, bound_bucket, manifest_cache) {
    let lres = await bound_bucket.get(pkeys.latestVersion(project, asset));
    if (lres == null) {
        for (const f of md5able) {
            simple.push(f);
        }
    } else {
        let last = JSON.parse(lres).version;
        let manifest = await getVersionManifest(project, asset, last, bound_bucket, manifest_cache);

        let by_sum_and_size = {};
        for (const [k, v] of Object.entries(manifest)) {
            let new_key = v.md5sum + "_" + String(v.size);
            by_sum_and_size[new_key] = k;
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

async function checkLinks(linked, project, asset, version, bound_bucket, manifest_cache) {
    let all_manifests = {};
    let all_targets = [];

    for (const f of linked) {
        let key = f.target.project + "/" + f.target.asset + "/" + f.target.version;
        if (!(key in all_manifests)) {
            all_manifests[key] = getVersionManifest(project, asset, version, bound_bucket, manifest_cache);
            all_targets[key] = [];
        }
        all_targets[key].push({ from: f.path, to: f.target });
    }

    let resolved_manifests = await utils.namedResolve(all_manifests);
    let linked_details = [];
    for (const [k, v] of Object.entries(all_targets)) {
        let target_manifest = resolved_manifest[k];
        for (const { from, to } of v) {
            if (!(to.path in target_manifest)) {
                throw new utils.HttpError("failed to link from '" + from + "' to '" + k + "/" + to.path + "'", 400);
            }
            let details = target_manifest[to.path];
            linked_details.push({ path: from, size: details.size, md5sum: details.md5sum, target: to });
        }
    }

    return linked_details;
}

export async function initializeUploadHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
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

    let uploading_user;
    let probation;
    let token = auth.extractBearerToken(request);
    if (token.startsWith("gypsum.")) {
        let scope = probation.extractTokenScope(token);
        if (scope.expires_in > Date.now()) {
            throw new utils.HttpError("probational token has expired", 403);
        }
        if (scope.project !== project) {
            throw new utils.HttpError("probational token was generated for a different project '" + scope.project + "'", 403);
        }
        if ("asset" in scope && scope.asset !== asset) {
            throw new utils.HttpError("probational token was generated for a different asset '" + scope.asset + "'", 403);
        }
        if ("version" in scope && scope.version !== version) {
            throw new utils.HttpError("probational token was generated for a different version '" + scope.version + "'", 403);
        }
        uploading_user = scope.user_id;
        probation = true;
    } else {
        let user = await auth.checkProjectManagementPermissions(project, token, nonblockers);
        uploading_user = user.login;
        probation = false;
    }

    let bound_bucket = s3.getR2Binding();
    let preparation = [];
    {
        let sumpath = pkeys.versionSummary(project, assset, version);
        let ver_meta = await bound_bucket.head(sumpath);
        if (ver_meta != null) {
            throw new utils.HttpError("version '" + version + "' already exists for asset '" + asset + "' in project '" + project + "'", 400);
        }
        preparation.push(utils.quickUploadJson(sumpath, { 
            "upload_user_id": uploading_user, 
            "upload_started": (new Date).toISOString(), 
            "on_probation": probation
        }));
    }

    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, version, session_key);

    // Now scanning through the files.
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

    let manifest_cache = {};
    if (split.md5.length) {
        await attemptMd5Deduplication(split.md5, split.simple, split.linked, project, asset, bound_bucket, manifest_cache);
    }
    let link_details = await checkLinks(split.linked, project, asset, version, bound_bucket, manifest_cache);

    // Build a manifest for inspection.
    let manifest = {};
    for (const s of split.simple) {
        manifest[s.path] = { size: s.size, md5sum: s.md5sum };
    }
    for (const l of link_details) {
        manifest[l.path] = { size: l.size, md5sum: l.md5sum, link: l.target };
    }
    preparation.push(utils.quickUploadJson(pkeys.versionManifest(project, asset, version), manifest));

    // Create link structures within each subdirectory for bulk consumers.
    let linkable = {};
    for (const l of split.linked) {
        let i = l.path.lastIndexOf("/");
        let hostdir = "";
        if (i >= 0) {
            hostdir = l.path.slice(0, i + 1); // include the trailing slash, see below.
        }
        if (!(hostdir in linkable)) {
            linkable[hostdir] = {};
        }
        linkable[hostdir][l.path.slice(i)] = l.target;
    }
    for (const [k, v] of Object.entries(linkable)) {
        // Either 'k' already has a trailing slash or is an empty string, so we can just add it to the file name.
        preparation.push(utils.quickUploadJson(project + "/" + asset + "/" + version + "/" + k + "..links", v));
    }

    // Creating the upload URLs; this could, in theory, switch logic depending on size.
    let upload_urls = [];
    for (const s of split.simple) {
        let dump = btoa(JSON.stringify([project, asset, version, s.path, s.md5sum]));
        upload_urls.push({ 
            path: s.path, 
            url: "/upload/presigned-file/" + dump,
            method: "presigned" 
        });
    }

    // Checking that everything was uploaded correctly.
    let resolved = await Promise.all(preparation);
    for (const r of resolved) {
        if (r == null) {
            throw new utils.HttpError("failed to upload manifest and/or link files to the bucket", 500);
        }
    }

    return utils.jsonResponse({ 
        upload_urls: upload_urls,
        completion_url: "/upload/complete/" + project + "/" + asset + "/" + version,
        abort_url: "/upload/abort/" + project + "/" + asset + "/" + version,
        session_key: session_key,
    }, 200);
}

/**************** Per-file upload ***************/

export async function uploadPresignedFileHandler(request, nonblockers) {
    try {
        var [ project, asset, version, path, md5sum ] = JSON.parse(atob(request.params.slug));
    } catch (e) {
        throw new utils.HttpError("invalid slug ('" + request.params.slug + "') for the presigned URL endpoint; " + String(e), 400);
    }
    await lock.checkLock(project, asset, version, auth.extractBearerToken(request));

    // Convert hex to base64 to keep S3 happy.
    let hits = md5sum.match(/\w{2}/g);
    let converted = hits.map(a => String.fromCharCode(parseInt(a, 16)));
    let md5_64 = btoa(converted.join(""));

    let bucket_name = s3.getBucketName();
    let params = { Bucket: bucket_name, Key: project + "/" + asset + "/" + version + "/" + path, Expires: 3600, ContentMD5: md5_64 };
    if (path.endsWith(".json")) {
        params.ContentType = "application/json";
    } else if (path.endsWith(".html")) {
        params.ContentType = "text/html";
    }

    let s3obj = s3.getS3Object();
    return utils.jsonResponse({
        url: await s3obj.getSignedUrlPromise('putObject', params),
        md5sum_base64: md5_64
    }, 200);
}

/**************** Complete uploads ***************/

export async function completeUploadHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.project);
    let version = decodeURIComponent(request.params.version);
    await lock.checkLock(project, asset, version, auth.extractBearerToken(request));

    let sumpath = pkeys.versionSummary(project, asset, version);
    let raw_info = await bound_bucket.get(sumpath);
    let info = JSON.parse(raw_info);

    let bound_bucket = s3.getR2Binding();
    let latest_update = true;
    if (!info.on_probation) {
        latest_update = utils.quickUploadJson(pkeys.latestVersion(project, asset), { "version": version });
        delete info.on_probation; 
    }

    info.upload_finished = (new Date).toISOString();
    let summary_update = utils.quickUploadJson(sumpath, info);

    // Await these so that we can handle the prior async'ness concurrently.
    if ((await summary_update) == null) {
        throw new utils.HttpError("failed to update version summary", 500);
    }
    if ((await latest_update) === null) {
        throw new utils.HttpError("failed to update latest version of project's assets", 500);
    }

    // Release lock once we're clear.
    await bound_bucket.delete(pkeys.lock(project, asset));
    return new Response(null, { status: 200 });
}

/**************** Abort upload ***************/

export async function abortUploadHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);
    await lock.checkLock(project, asset, version, auth.extractBearerToken(request));

    // Loop through all resources and delete them all. Make sure to add the trailing
    // slash to ensure that we don't delete a version that starts with 'version'.
    await utils.quickRecursiveDelete(project + "/" + asset + "/" + version + "/");

    // Release lock once we're clear.
    await bound_bucket.delete(pkeys.lock(project, asset));
    return new Response(null, { status: 200 });
}
