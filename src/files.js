import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as pkeys from "./internal.js";
import * as latest from "./latest.js";
import * as s3 from "./s3.js";

export async function getVersionMetadataOrNull(project, version, nonblockers) {
    const versionCache = await caches.open("version:cache");
    let bound_bucket = s3.getR2Binding();

    // Key needs to be a URL.
    const key = "https://github.com/ArtifactDB/gypsum-worker/" + project + "/version/" + version + "/metadata";

    let check = await versionCache.match(key);
    if (check) {
        return await check.json();
    }

    let stuff = await bound_bucket.get(pkeys.versionMetadata(project, version));
    if (stuff == null) {
        return null;
    }

    let data = await stuff.text();
    nonblockers.push(utils.quickCacheJsonText(versionCache, key, data, utils.hoursFromNow(2)));
    return JSON.parse(data);
}

export async function getVersionMetadata(project, version, nonblockers) {
    let out = getVersionMetadataOrNull(project, version, nonblockers);
    if (out == null) {
        throw new utils.HttpError("failed to retrieve metadata for project '" + project + "', version '" + version + "'", 404);
    }
    return out;
}

export function createExtraMetadata(id, unpacked, file_meta, version_meta, permissions) {
    let output = {
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

    if ("expiry_time" in version_meta) {
        output.transient = {
            expires_in: version_meta.expiry_time,
            expires_job_id: version_meta.expiry_job_id
        };
    }

    return output;
}

export async function getFileMetadataHandler(request, nonblockers) {
    let id = decodeURIComponent(request.params.id);
    let follow_link = request.query.follow_link == "true";
    let bound_bucket = s3.getR2Binding();

    let previous = new Set;
    let allowed = {};
    let unpacked;
    let original;
    let pure_meta;
    let is_redirect;
    let file_meta;

    while (1) {
        unpacked = utils.unpackId(id);
        original = unpacked.path;
        pure_meta = unpacked.path.endsWith(".json")
        if (!pure_meta) {
            unpacked.path += ".json";
        }

        // Checking a function-local cache for auth, to avoid paying the cost
        // of hitting Cloudflare's cache when following links.
        if (!(unpacked.project in allowed)) {
            let resolved = await utils.namedResolve({
                user: auth.findUserNoThrow(request, nonblockers),
                permissions: auth.getPermissions(unpacked.project, nonblockers)
            });
            let perm = resolved.permissions;
            auth.checkReadPermissions(perm, resolved.user, unpacked.project);
            allowed[unpacked.project] = perm;
        } 

        let file_res;
        let file_meta_fun = v => bound_bucket.get(unpacked.project + "/" + v + "/" + unpacked.path);
        if (unpacked.version == "latest") {
            let attempt = await latest.attemptOnLatest(unpacked.project, file_meta_fun, nonblockers);
            file_res = attempt.result;
            unpacked.version = attempt.version;
            id = utils.packId(unpacked.project, original, unpacked.version);
        } else {
            file_res = await file_meta_fun(unpacked.version);
        }
        if (file_res === null) {
            throw new utils.HttpError("no metadata available for '" + id + "'", 404);
        }

        file_meta = await file_res.json();

        // Handling redirection if the retrieved document says so.
        is_redirect = file_meta["$schema"].startsWith("redirection/");
        if (follow_link && is_redirect) {
            let targets = file_meta["redirection"]["targets"];
            if (targets.length == 0) {
                break;
            }

            let next;
            let loc = targets[0]["location"];
            if (targets[0]["type"] == "local") {
                next = utils.packId(unpacked.project, loc, unpacked.version);
            } else {
                next = loc;
            }

            if (previous.has(next)) {
                throw new utils.HttpError("detected circular links from '" + id + "' to '" + next + "'", 500);
            }
            id = next;
            previous.add(id);
        } else {
            break;
        }
    }

    // Adding more information.
    let more_promises = {
        version_metadata: getVersionMetadata(unpacked.project, unpacked.version, nonblockers),
    };
    if (!pure_meta && !is_redirect) {
        let ogpath = unpacked.project + "/" + unpacked.version + "/" + original;
        more_promises.file_header = bound_bucket.head(ogpath);
    }

    let resolved = await utils.namedResolve(more_promises);
    file_meta["_extra"] = createExtraMetadata(id, unpacked, file_meta, resolved.version_metadata, allowed[unpacked.project]);

    if (!pure_meta && !is_redirect) {
        let file_header = resolved.file_header;
        if (file_header == null) {
            throw new utils.HttpError("failed to retrieve header for '" + id + "'", 500);
        }
        if ("artifactdb_id" in file_header.customMetadata) {
            file_meta["_extra"].link = { "artifactdb": file_header.customMetadata.artifactdb_id };
        }
    }

    return utils.jsonResponse(file_meta, 200);
}

export async function getFileHandler(request, nonblockers) {
    let id = decodeURIComponent(request.params.id);
    let bound_bucket = s3.getR2Binding();

    let bucket_name = s3.getBucketName();
    let s3obj = s3.getS3Object();

    let previous = new Set;
    let allowed = new Set;
    let unpacked;

    while (1) {
        unpacked = utils.unpackId(id);
        let res = bound_bucket.head(unpacked.project + "/" + unpacked.version + "/" + unpacked.path);

        // Checking a function-local cache for auth, to avoid paying the cost of hitting Cloudflare's cache.
        if (!allowed.has(unpacked.project)) {
            let resolved = await utils.namedResolve({
                user: auth.findUserNoThrow(request, nonblockers),
                permissions: auth.getPermissions(unpacked.project, nonblockers),
            });
            auth.checkReadPermissions(resolved.permissions, resolved.user, unpacked.project);
            allowed.add(unpacked.project);
        }

        let header;
        let file_header_fun = v => bound_bucket.head(unpacked.project + "/" + v + "/" + unpacked.path);
        if (unpacked.version == "latest") {
            let attempt = await latest.attemptOnLatest(unpacked.project, file_header_fun, nonblockers);
            header = attempt.result;
            unpacked.version = attempt.version;
        } else {
            header = await file_header_fun(unpacked.version);
        }
        if (header == null) {
            throw new utils.HttpError("failed to retrieve header for '" + id + "'", 404);
        }

        // Following the next link until we get to a non-linked resource.
        if ("artifactdb_id" in header.customMetadata) {
            let next = header.customMetadata.artifactdb_id;
            if (previous.has(next)) {
                throw new utils.HttpError("detected circular links from '" + id + "' to '" + next + "'", 500);
            }
            id = next;
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
