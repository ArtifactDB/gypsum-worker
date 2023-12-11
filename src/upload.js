import * as misc from "./utils/misc.js";
import * as auth from "./utils/permissions.js";
import * as quot from "./utils/quota.js";
import * as http from "./utils/http.js";
import * as gh from "./utils/github.js";
import * as lock from "./utils/lock.js";
import * as pkeys from "./utils/internal.js";
import * as s3 from "./utils/s3.js";
import * as change from "./utils/changelog.js";

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

async function getVersionManifest(project, asset, version, env, manifest_cache) {
    let key = project + "/" + asset + "/" + version;
    if (key in manifest_cache) {
        return manifest_cache[key];
    }

    let manifest = await s3.quickFetchJson(pkeys.versionManifest(project, asset, version), env, { mustWork: false });
    if (manifest == null) {
        throw new http.HttpError("no manifest available for link target inside '" + key + "'", 400);
    }
    manifest_cache[key] = manifest;
    return manifest;
}

async function attemptMd5Deduplication(simple, dedup, linked, project, asset, env, manifest_cache) {
    let last = await s3.quickFetchJson(pkeys.latestVersion(project, asset), env, { mustWork: false });
    if (last == null) {
        for (const f of dedup) {
            simple.push(f);
        }
    } else {
        let manifest = await getVersionManifest(project, asset, last.version, env, manifest_cache);

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
                        version: last.version,
                        path: by_sum_and_size[key]
                    } 
                });
            } else {
                simple.push(f);
            }
        }
    }
}

async function checkLinks(linked, project, asset, version, env, manifest_cache) {
    let all_manifests = {};
    let all_targets = [];

    for (const f of linked) {
        let key = f.link.project + "/" + f.link.asset + "/" + f.link.version;
        if (f.link.project == project && f.link.asset == asset && f.link.version == version) {
            throw new http.HttpError("detected circular link from '" + f.path + "' to '" + key + "/" + f.link.path + "'", 400);
        }

        if (!(key in all_manifests)) {
            let summary = await s3.quickFetchJson(pkeys.versionSummary(f.link.project, f.link.asset, f.link.version), env, { mustWork: false });
            if (summary == null) {
                throw new http.HttpError("cannot find version summary for link from '" + f.path + "' to '" + key + "/" + f.link.path + "'", 400);
            }
            if ("on_probation" in summary && summary.on_probation) {
                throw new http.HttpError("cannot refer to probational version for link from '" + f.path + "' to '" + key + "/" + f.link.path + "'", 400);
            }
            if (!("upload_finish" in summary)) {
                throw new http.HttpError("cannot refer to incomplete upload for link from '" + f.path + "' to '" + key + "/" + f.link.path + "'", 400);
            }

            all_manifests[key] = getVersionManifest(f.link.project, f.link.asset, f.link.version, env, manifest_cache);
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
            if ("link" in details) { // store grand-parents for easier tracing.
                if ("ancestor" in details.link) {
                    to.ancestor = details.link.ancestor;
                } else {
                    to.ancestor = details.link;
                }
            }

            linked_details.push({ path: from, size: details.size, md5sum: details.md5sum, link: to });
        }
    }

    return linked_details;
}

function isBadName(name) {
    return name.indexOf("/") >= 0 || name.startsWith("..") || name.length == 0;
}

export async function initializeUploadHandler(request, env, nonblockers) {
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
    let { can_manage, is_trusted, user } = await auth.checkProjectUploadPermissions(project, asset, version, token, env, nonblockers);
    let uploading_user = user.login;
    if (!is_trusted) {
        probation = true;
    }

    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, version, session_key, env);

    let bucket_writes = [];
    let output;

    try {
        let sumpath = pkeys.versionSummary(project, asset, version);
        let ver_meta = await env.BOUND_BUCKET.head(sumpath);
        if (ver_meta != null) {
            throw new http.HttpError("project-asset-version already exists", 400);
        }
        bucket_writes.push(s3.quickUploadJson(
            sumpath, 
            { 
                "upload_user_id": uploading_user, 
                "upload_start": (new Date).toISOString(), 
                "on_probation": probation
            },
            env
        ));

        // Now scanning through the files.
        if (!("files" in body) || !(body.files instanceof Array)) {
            throw new http.HttpError("expected the 'files' property to be an array", 400);
        }
        let split = splitByUploadType(body.files);

        let manifest_cache = {};
        if (split.dedup.length) {
            await attemptMd5Deduplication(split.simple, split.dedup, split.link, project, asset, env, manifest_cache);
        }
        let link_details = await checkLinks(split.link, project, asset, version, env, manifest_cache);

        // Checking that the quota isn't exceeded. Note that 'pending_on_complete_only' 
        // should only EVER be used by completeUploadHandler, so even if it's non-zero here, 
        // we just ignore it.
        let current_usage = 0;
        for (const s of split.simple) {
            current_usage += s.size;
        }

        let upath = pkeys.usage(project);
        let usage = await s3.quickFetchJson(upath, env);
        if (usage.total + current_usage >= (await quot.computeQuota(project, env))) {
            throw new http.HttpError("upload exceeds the storage quota for this project", 400);
        }

        usage.pending_on_complete_only = current_usage;
        bucket_writes.push(s3.quickUploadJson(upath, usage, env));

        // Build a manifest for inspection.
        let manifest = {};
        for (const s of split.simple) {
            manifest[s.path] = { size: s.size, md5sum: s.md5sum };
        }
        for (const l of link_details) {
            manifest[l.path] = { size: l.size, md5sum: l.md5sum, link: l.link };
        }
        bucket_writes.push(s3.quickUploadJson(pkeys.versionManifest(project, asset, version), manifest, env));

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
        await Promise.allSettled(bucket_writes);

        // Unlocking the project if the upload init failed, then users can try again without penalty.
        await s3.quickRecursiveDelete(project + "/" + asset + "/" + version + "/", env);
        await lock.unlockProject(project, env);
        throw e;
    }

    // Again, just wait for everything to finish.
    await Promise.all(bucket_writes);

    return output;
}

/**************** Per-file upload ***************/

export async function uploadPresignedFileHandler(request, env, nonblockers) {
    try {
        var [ project, asset, version, path, md5sum ] = JSON.parse(atob(request.params.slug));
    } catch (e) {
        throw new http.HttpError("invalid slug ('" + request.params.slug + "') for the presigned URL endpoint; " + String(e), 400);
    }
    await lock.checkLock(project, asset, version, auth.extractBearerToken(request), env);

    // Convert hex to base64 to keep S3 happy.
    let hits = md5sum.match(/\w{2}/g);
    let converted = hits.map(a => String.fromCharCode(parseInt(a, 16)));
    let md5_64 = btoa(converted.join(""));

    let params = { 
        Bucket: env.R2_BUCKET_NAME, 
        Key: project + "/" + asset + "/" + version + "/" + path, 
        Expires: 3600, 
        ContentMD5: md5_64 
    };
    if (path.endsWith(".json")) {
        params.ContentType = "application/json";
    } else if (path.endsWith(".html")) {
        params.ContentType = "text/html";
    }

    const s3obj = s3.getS3Object(env);
    return http.jsonResponse({
        url: await s3obj.getSignedUrlPromise('putObject', params),
        md5sum_base64: md5_64
    }, 200);
}

/**************** Complete uploads ***************/

export async function completeUploadHandler(request, env, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);
    await lock.checkLock(project, asset, version, auth.extractBearerToken(request), env);

    let list_promise = new Promise(resolve => {
        let all_files = new Map;
        let prefix = project + "/" + asset + "/" + version + "/";
        s3.listApply(
            prefix, 
            f => { all_files.set(f.key.slice(prefix.length), f.size); },
            env,
            { namesOnly: false }
        ).then(x => resolve(all_files));
    });

    let sumpath = pkeys.versionSummary(project, asset, version);
    let assets = await misc.namedResolve({
        manifest: s3.quickFetchJson(pkeys.versionManifest(project, asset, version), env),
        summary: s3.quickFetchJson(sumpath, env),
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

    // Create link structures within each subdirectory for bulk consumers.
    let bucket_writes = [];
    for (const [k, v] of Object.entries(linkable)) {
        // Either 'k' already has a trailing slash or is an empty string, so we can just add it to the file name.
        bucket_writes.push(s3.quickUploadJson(project + "/" + asset + "/" + version + "/" + k + "..links", v, env));
    }

    let info = await assets.summary;
    let is_official = (!info.on_probation);
    if (is_official) {
        bucket_writes.push(s3.quickUploadJson(pkeys.latestVersion(project, asset), { "version": version }, env));
        delete info.on_probation; 
    }
    info.upload_finish = (new Date).toISOString();
    bucket_writes.push(s3.quickUploadJson(sumpath, info, env));

    // Updating the usage file.
    let upath = pkeys.usage(project);
    let usage = await s3.quickFetchJson(upath, env);
    usage.total += usage.pending_on_complete_only;
    delete usage.pending_on_complete_only;
    bucket_writes.push(s3.quickUploadJson(upath, usage, env));

    await Promise.all(bucket_writes);
    await lock.unlockProject(project, env);
    if (is_official) {
        bucket_writes.push(change.addChangelog({ type: "add-version", project, asset, version, latest: true }, env));
    }
    return new Response(null, { status: 200 });
}

/**************** Abort upload ***************/

export async function abortUploadHandler(request, env, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);
    await lock.checkLock(project, asset, version, auth.extractBearerToken(request), env);

    // Loop through all resources and delete them all. Make sure to add the trailing
    // slash to ensure that we don't delete a version that starts with 'version'.
    await s3.quickRecursiveDelete(project + "/" + asset + "/" + version + "/", env);

    // Release lock once we're clear.
    await lock.unlockProject(project, env);
    return new Response(null, { status: 200 });
}
