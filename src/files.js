import * as auth from "./auth.js";
import * as utils from "./utils.js";

export async function getVersionMetadata(project, version, bound_bucket, nonblockers) {
    const versionCache = await caches.open("version:cache");

    // Key needs to be a URL.
    const key = "https://github.com/ArtifactDB/gypsum-worker/" + project + "/version/" + version + "/metadata";

    let check = await versionCache.match(key);
    if (check) {
        return await check.json();
    }

    let stuff = await bound_bucket.get(project + "/" + version + "/..revision.json");
    if (stuff == null) {
        throw new utils.HttpError("failed to retrieve metadata for project '" + project + "', version '" + version + "'", 404);
    }

    let data = await stuff.text();
    nonblockers.push(utils.quickCacheJsonText(versionCache, key, data, utils.hoursFromNow(2)));
    return JSON.parse(data);
}

export async function getLatestVersion(project, bound_bucket, nonblockers) {
    const latestCache = await caches.open("latest:cache");

    // Key needs to be a URL.
    const key = "https://github.com/ArtifactDB/gypsum-worker/latest" + project;

    let check = await latestCache.match(key);
    if (check) {
        return await check.json();
    }

    let stuff = await bound_bucket.get(project + "/..latest.json");
    if (stuff == null) {
        throw new utils.HttpError("failed to retrieve latest information for project '" + project + "'", 404);
    }

    let data = await stuff.text();
    nonblockers.push(utils.quickCacheJsonText(latestCache, key, data, utils.minutesFromNow(5)));
    return JSON.parse(data);
}

export function createExtraMetadata(id, unpacked, file_meta, version_meta, permissions) {
    return {
        "$schema": file_meta["$schema"],
        id: id,
        project_id: unpacked.project,
        version: unpacked.version,
        metapath: file_meta.path,
        meta_indexed: version_meta.index_time,
        meta_uploaded: version_meta.upload_time,
        uploaded: version_meta.upload_time,
        permissions: permissions
    };
}

export async function getFileMetadataHandler(request, bound_bucket, globals, nonblockers) {
    let id = decodeURIComponent(request.params.id);
    let master = globals.gh_master_token;

    let unpacked = utils.unpackId(id);
    let original = unpacked.path;
    let pure_meta = unpacked.path.endsWith(".json")
    if (!pure_meta) {
        unpacked.path += ".json";
    }

    // Loading up on the promises.
    let all_promises = {
        user: auth.findUser(request, master, nonblockers).catch(error => null),
        permissions: auth.getPermissions(unpacked.project, bound_bucket, nonblockers),
        version_metadata: getVersionMetadata(unpacked.project, unpacked.version, bound_bucket, nonblockers)
    };

    let r2path = unpacked.project + "/" + unpacked.version + "/" + unpacked.path;
    all_promises.file_metadata = bound_bucket.get(r2path);

    if (!pure_meta) {
        let ogpath = unpacked.project + "/" + unpacked.version + "/" + original;
        all_promises.file_header = bound_bucket.head(ogpath);
    }

    // Resolving them all at once for concurrency.
    let resolved = await utils.namedResolve(all_promises);
    let user = resolved.user;
    let perm = resolved.permissions;

    auth.checkReadPermissions(perm, user, unpacked.project);

    let file_res = resolved.file_metadata;
    if (file_res === null) {
        throw new utils.HttpError("key '" + id + "' does not exist", 404);
    }

    let ver_meta = resolved.version_metadata;
    let file_meta = await file_res.json();
    file_meta["_extra"] = createExtraMetadata(id, unpacked, file_meta, ver_meta, perm);

    if (!pure_meta) {
        let file_header = await resolved.file_header;
        if (file_header == null) {
            throw new utils.HttpError("failed to retrieve header for '" + id + "'", 500);
        }
        if ("artifactdb_id" in file_header.customMetadata) {
            file_meta["_extra"].link = { "id": file_header.customMetadata.artifactdb_id };
        }
    }

    return utils.jsonResponse(file_meta, 200);
}

export async function getFileHandler(request, bound_bucket, globals, nonblockers) {
    let id = decodeURIComponent(request.params.id);
    let unpacked = utils.unpackId(id);

    let master = globals.gh_master_token;
    let bucket_name = globals.r2_bucket_name;
    let s3obj = globals.s3_binding;

    let previous = new Set;
    let allowed = new Set;

    while (1) {
        let res = bound_bucket.head(unpacked.project + "/" + unpacked.version + "/" + unpacked.path);
        let header;

        // Checking a function-local cache to avoid paying the cost of hitting Cloudflare's cache.
        if (!allowed.has(unpacked.project)) {
            let resolved = await utils.namedResolve({
                user: auth.findUser(request, master, nonblockers).catch(error => null),
                permissions: auth.getPermissions(unpacked.project, bound_bucket, nonblockers),
                header: res
            });

            auth.checkReadPermissions(resolved.permissions, resolved.user, unpacked.project);
            allowed.add(unpacked.project);
            header = resolved.header;
            console.log(header);
        } else {
            header = await res;
        }

        if (header == null) {
            throw new utils.HttpError("failed to retrieve header for '" + id + "'", 500);
        }

        // Following the next link until we get to a non-linked resource.
        if ("artifactdb_id" in header.customMetadata) {
            let next = header.customMetadata.artifactdb_id;
            if (previous.has(next)) {
                throw new utils.HttpError("detected circular links from '" + id + "' to '" + next + "'", 500);
            }
            id = next;
            unpacked = utils.unpackId(id);
            previous.add(id);
        } else {
            break;
        }
    }

    // Finally, creating the presigned URL.
    let expiry = request.query.expires_in;
    if (typeof expiry !== "number") {
        expiry = 120;
    }

    let key = unpacked.project + "/" + unpacked.version + "/" + unpacked.path;
    let target = await s3obj.getSignedUrlPromise('getObject', { Bucket: bucket_name, Key: key, Expires: expiry });
    return Response.redirect(target, 302);
}
