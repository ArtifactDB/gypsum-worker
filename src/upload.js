import * as misc from "./utils/misc.js";
import * as auth from "./utils/permissions.js";
import * as quot from "./utils/quota.js";
import * as http from "./utils/http.js";
import * as gh from "./utils/github.js";
import * as lock from "./utils/lock.js";
import * as pkeys from "./utils/internal.js";
import * as s3 from "./utils/s3.js";

/**************** Initialize uploads ***************/

function splitByUploadType(files) {
    let simple = [];
    let dedup = [];
    let linked = [];

    let all_paths = new Set;
    for (const f of files) {
        if (!misc.isJsonObject(f)) {
            throw new http.HttpError("'files' should be an array of objects", 400);
        }

        if (!("path" in f) || typeof f.path != "string") {
            throw new http.HttpError("'files.path' should be a string", 400);
        }
        let fname = f.path;
        if (misc.isInternalPath(fname)) {
            throw new http.HttpError("components of 'files.path' cannot start with '..'", 400);
        }
        if (all_paths.has(fname)) {
            throw new http.HttpError("duplicated value '" + fname + "' in 'files.path'", 400);
        }
        all_paths.add(fname);

        if (!("type" in f) || typeof f.type != "string") {
            throw new http.HttpError("'files.type' should be a string", 400);
        }

        if (f.type === "simple" || f.type == "dedup") {
            if (!("md5sum" in f) || typeof f.md5sum != "string") {
                throw new http.HttpError("'files.md5sum' should be a string", 400);
            }
            if (!("size" in f) || typeof f.size != "number" || f.size < 0 || !Number.isInteger(f.size)) {
                throw new http.HttpError("'files.size' should be a non-negative integer", 400);
            }
            if (f.type === "simple") {
                simple.push(f);
            } else {
                dedup.push(f);
            }

        } else if (f.type == "link") {
            if (!("link" in f) || !misc.isJsonObject(f.link)) {
                throw new http.HttpError("'files.link' should be an object", 400);
            }
            let target = f.link;
            if (!("project" in target) || typeof target.project != "string") {
                throw new http.HttpError("'files.link.project' should be a string", 400);
            }
            if (!("asset" in target) || typeof target.asset != "string") {
                throw new http.HttpError("'files.link.asset' should be a string", 400);
            }
            if (!("version" in target) || typeof target.version != "string") {
                throw new http.HttpError("'files.link.version' should be a string", 400);
            }
            if (!("path" in target) || typeof target.path != "string") {
                throw new http.HttpError("'files.link.path' should be a string", 400);
            }
            linked.push(f);

        } else {
            throw new http.HttpError("invalid 'files.type'", 400);
        }
    }

    return { 
        simple: simple, 
        dedup: dedup, 
        link: linked 
    };
}

async function getVersionManifest(project, asset, version, bound_bucket, manifest_cache) {
    let key = project + "/" + asset + "/" + version;
    if (key in manifest_cache) {
        return manifest_cache[key];
    }


    let raw_manifest = await bound_bucket.get(pkeys.versionManifest(project, asset, version));
    if (raw_manifest == null) {
        throw new http.HttpError("no manifest available for link target inside '" + key + "'", 400);
    }

    let manifest = await raw_manifest.json();
    manifest_cache[key] = manifest;
    return manifest;
}

async function attemptMd5Deduplication(simple, dedup, linked, project, asset, bound_bucket, manifest_cache) {
    let lres = await bound_bucket.get(pkeys.latestVersion(project, asset));
    if (lres == null) {
        for (const f of dedup) {
            simple.push(f);
        }
    } else {
        let last = (await lres.json()).version;
        let manifest = await getVersionManifest(project, asset, last, bound_bucket, manifest_cache);

        let by_sum_and_size = {};
        for (const [k, v] of Object.entries(manifest)) {
            let new_key = v.md5sum + "_" + String(v.size);
            by_sum_and_size[new_key] = k;
        }

        let promises = [];
        for (const f of dedup) {
            let key = f.md5sum + "_" + String(f.size);
            if (key in by_sum_and_size) {
                linked.push({ 
                    path: f.path, 
                    link: { 
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
        let key = f.link.project + "/" + f.link.asset + "/" + f.link.version;
        if (f.link.project == project && f.link.asset == asset && f.link.version == version) {
            throw new http.HttpError("detected circular link from '" + f.path + "' to '" + key + "/" + f.link.path + "'", 400);
        }

        if (!(key in all_manifests)) {
            all_manifests[key] = getVersionManifest(f.link.project, f.link.asset, f.link.version, bound_bucket, manifest_cache);
            all_targets[key] = [];
        }
        all_targets[key].push({ from: f.path, to: f.link });
    }

    let resolved_manifests = await misc.namedResolve(all_manifests);
    let linked_details = [];
    for (const [k, v] of Object.entries(all_targets)) {
        let target_manifest = resolved_manifests[k];
        for (const { from, to } of v) {
            if (!(to.path in target_manifest)) {
                throw new http.HttpError("failed to link from '" + from + "' to '" + k + "/" + to.path + "'", 400);
            }
            let details = target_manifest[to.path];
            linked_details.push({ path: from, size: details.size, md5sum: details.md5sum, link: to });
        }
    }

    return linked_details;
}

function isBadName(name) {
    return name.indexOf("/") >= 0 || name.startsWith("..") || name.length == 0;
}

export async function initializeUploadHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    if (isBadName(project)) {
        throw new http.HttpError("project name cannot contain '/', start with '..', or be empty", 400);
    }
    if (isBadName(asset)) {
        throw new http.HttpError("asset name cannot contain '/', start with '..', or be empty", 400);
    }
    if (isBadName(version)) {
        throw new http.HttpError("version name cannot contain '/', start with '..', or be empty", 400);
    }

    let body = await http.bodyToJson(request);
    if (!misc.isJsonObject(body)) {
        throw new http.HttpError("expected request body to be a JSON object", 400);
    }
    let probation = false;
    if ("on_probation" in body) {
        if (typeof body.on_probation != "boolean") {
            throw new http.HttpError("expected the 'on_probation' property to be a boolean", 400);
        }
        probation = body.on_probation;
    }

    let token = auth.extractBearerToken(request);
    let { can_manage, is_trusted, user } = await auth.checkProjectUploadPermissions(project, asset, version, token, nonblockers);
    let uploading_user = user.login;
    if (!is_trusted) {
        probation = true;
    }

    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, version, session_key);

    let bound_bucket = s3.getR2Binding();
    let preparation = [];
    let output;

    try {
        let sumpath = pkeys.versionSummary(project, asset, version);
        let ver_meta = await bound_bucket.head(sumpath);
        if (ver_meta != null) {
            throw new http.HttpError("project-asset-version already exists", 400);
        }
        preparation.push(s3.quickUploadJson(sumpath, { 
            "upload_user_id": uploading_user, 
            "upload_start": (new Date).toISOString(), 
            "on_probation": probation
        }));

        // Now scanning through the files.
        if (!("files" in body) || !(body.files instanceof Array)) {
            throw new http.HttpError("expected the 'files' property to be an array", 400);
        }
        let split = splitByUploadType(body.files);

        let manifest_cache = {};
        if (split.dedup.length) {
            await attemptMd5Deduplication(split.simple, split.dedup, split.link, project, asset, bound_bucket, manifest_cache);
        }
        let link_details = await checkLinks(split.link, project, asset, version, bound_bucket, manifest_cache);

        // Checking that the quota isn't exceeded. Note that 'pending_on_complete_only' 
        // should only EVER be used by completeUploadHandler, so even if it's non-zero here, 
        // we just ignore it.
        let current_usage = 0;
        for (const s of split.simple) {
            current_usage += s.size;
        }

        let upath = pkeys.usage(project);
        let usage = await s3.quickFetchJson(upath);
        if (usage.total + current_usage >= (await quot.computeQuota(project))) {
            throw new http.HttpError("upload exceeds the storage quota for this project", 400);
        }

        usage.pending_on_complete_only = current_usage;
        preparation.push(s3.quickUploadJson(upath, usage));

        // Build a manifest for inspection.
        let manifest = {};
        for (const s of split.simple) {
            manifest[s.path] = { size: s.size, md5sum: s.md5sum };
        }
        for (const l of link_details) {
            manifest[l.path] = { size: l.size, md5sum: l.md5sum, link: l.link };
        }
        preparation.push(s3.quickUploadJson(pkeys.versionManifest(project, asset, version), manifest));

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

        output = http.jsonResponse({ 
            file_urls: upload_urls,
            complete_url: "/upload/complete/" + project + "/" + asset + "/" + version,
            abort_url: "/upload/abort/" + project + "/" + asset + "/" + version,
            session_token: session_key,
        }, 200);

    } catch (e) {
        // Wait for everything to finish so that deletion catches everything.
        // We don't mind if it fails, just that it was settled.
        await Promise.allSettled(preparation);

        // Unlocking the project if the upload init failed, then users can try again without penalty.
        await s3.quickRecursiveDelete(project + "/" + asset + "/" + version + "/");
        await lock.unlockProject(project);
        throw e;
    }

    // Again, just wait for everything to finish.
    await Promise.all(preparation);

    return output;
}

/**************** Per-file upload ***************/

export async function uploadPresignedFileHandler(request, nonblockers) {
    try {
        var [ project, asset, version, path, md5sum ] = JSON.parse(atob(request.params.slug));
    } catch (e) {
        throw new http.HttpError("invalid slug ('" + request.params.slug + "') for the presigned URL endpoint; " + String(e), 400);
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
    return http.jsonResponse({
        url: await s3obj.getSignedUrlPromise('putObject', params),
        md5sum_base64: md5_64
    }, 200);
}

/**************** Complete uploads ***************/

export async function completeUploadHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);
    await lock.checkLock(project, asset, version, auth.extractBearerToken(request));

    let list_promise = new Promise(resolve => {
        let all_files = new Map;
        let prefix = project + "/" + asset + "/" + version + "/";
        s3.listApply(
            prefix, 
            f => { all_files.set(f.key.slice(prefix.length), f.size); },
            { namesOnly: false }
        ).then(x => resolve(all_files));
    });

    let bound_bucket = s3.getR2Binding();
    let sumpath = pkeys.versionSummary(project, asset, version);
    let assets = await misc.namedResolve({
        manifest: s3.quickFetchJson(pkeys.versionManifest(project, asset, version)),
        summary: s3.quickFetchJson(sumpath),
        listing: list_promise,
    });

    // We scan the manifest to check that all files were uploaded. We also
    // collect links for some more work later.
    let manifest = await assets.manifest;
    let linkable = {};
    for (const [k, v] of Object.entries(manifest)) {
        let s = assets.listing.get(k);
        let found = (typeof s != "undefined");

        if ("link" in v) {
            if (found) {
                throw new http.HttpError("linked-from path '" + k + "' in manifest should not have a file", 500);
            }
            let i = k.lastIndexOf("/");
            let hostdir = "";
            let fname = k;
            if (i >= 0) {
                hostdir = k.slice(0, i + 1); // include the trailing slash, see below.
                fname = k.slice(i + 1);
            }
            if (!(hostdir in linkable)) {
                linkable[hostdir] = {};
            }
            linkable[hostdir][fname] = v.link;

        } else {
            if (!found) {
                throw new http.HttpError("path '" + k + "' in manifest should have a file", 400);
            } else if (s != v.size) {
                throw new http.HttpError("actual size of '" + k + "' does not match its reported size in the manifest", 400);
            }
        }
    }

    let info = await assets.summary;
    let preparation = [];
    try {
        // Create link structures within each subdirectory for bulk consumers.
        for (const [k, v] of Object.entries(linkable)) {
            // Either 'k' already has a trailing slash or is an empty string, so we can just add it to the file name.
            preparation.push(s3.quickUploadJson(project + "/" + asset + "/" + version + "/" + k + "..links", v));
        }

        if (!info.on_probation) {
            preparation.push(s3.quickUploadJson(pkeys.latestVersion(project, asset), { "version": version }));
            delete info.on_probation; 
        }

        info.upload_finish = (new Date).toISOString();
        preparation.push(s3.quickUploadJson(sumpath, info));

        // Updating the usage file.
        let upath = pkeys.usage(project);
        let usage = await s3.quickFetchJson(upath);
        usage.total += usage.pending_on_complete_only;
        delete usage.pending_on_complete_only;
        preparation.push(s3.quickUploadJson(upath, usage));

    } finally {
        await Promise.all(preparation);
    }

    // Release lock once we're clear.
    await lock.unlockProject(project);
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
    await s3.quickRecursiveDelete(project + "/" + asset + "/" + version + "/");

    // Release lock once we're clear.
    await lock.unlockProject(project);
    return new Response(null, { status: 200 });
}
