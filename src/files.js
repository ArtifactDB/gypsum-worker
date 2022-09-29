import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as pkeys from "./internal.js";
import * as latest from "./latest.js";

export async function getVersionMetadataOrNull(project, version, bound_bucket, nonblockers) {
    const versionCache = await caches.open("version:cache");

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

export async function getVersionMetadata(project, version, bound_bucket, nonblockers) {
    let out = getVersionMetadataOrNull(project, version, bound_bucket, nonblockers);
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

export async function getFileMetadataHandler(request, bound_bucket, globals, nonblockers) {
    let id = decodeURIComponent(request.params.id);
    let follow_link = request.query.follow_link == "true";
    let master = globals.gh_master_token;

    let previous = new Set;
    let allowed = {};
    let unpacked;
    let original;
    let pure_meta;
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
                user: auth.findUserNoThrow(request, master, nonblockers),
                permissions: auth.getPermissions(unpacked.project, bound_bucket, nonblockers)
            });
            let perm = resolved.permissions;
            auth.checkReadPermissions(perm, resolved.user, unpacked.project);
            allowed[unpacked.project] = perm;
        } 

        let file_res;
        let file_meta_fun = v => bound_bucket.get(unpacked.project + "/" + v + "/" + unpacked.path);
        if (unpacked.version == "latest") {
            let attempt = await latest.attemptOnLatest(unpacked.project, bound_bucket, file_meta_fun, res => res == null);
            file_res = attempt.result;
            unpacked.version = attempt.version;
        } else {
            file_res = await file_meta_fun(unpacked.version);
        }
        if (file_res === null) {
            throw new utils.HttpError("no metadata available for '" + id + "'", 404);
        }

        file_meta = await file_res.json();

        // Handling redirection if the retrieved document says so.
        if (follow_link && file_meta["$schema"].startsWith("redirection/")) {
            let type = file_meta["redirection"]["type"];
            let loc = file_meta["redirection"]["location"];
            let next;
            if (type == "local") {
                next = unpacked.project + ":" + loc + "@" + unpacked.version;
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
        version_metadata: getVersionMetadata(unpacked.project, unpacked.version, bound_bucket, nonblockers),
    };
    if (!pure_meta) {
        let ogpath = unpacked.project + "/" + unpacked.version + "/" + original;
        more_promises.file_header = bound_bucket.head(ogpath);
    }

    let resolved = await utils.namedResolve(more_promises);
    file_meta["_extra"] = createExtraMetadata(id, unpacked, file_meta, resolved.version_metadata, allowed[unpacked.project]);

    if (!pure_meta) {
        let file_header = resolved.file_header;
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

    let master = globals.gh_master_token;
    let bucket_name = globals.r2_bucket_name;
    let s3obj = globals.s3_binding;

    let previous = new Set;
    let allowed = new Set;
    let unpacked;

    while (1) {
        unpacked = utils.unpackId(id);
        let res = bound_bucket.head(unpacked.project + "/" + unpacked.version + "/" + unpacked.path);

        // Checking a function-local cache for auth, to avoid paying the cost of hitting Cloudflare's cache.
        if (!allowed.has(unpacked.project)) {
            let resolved = await utils.namedResolve({
                user: auth.findUserNoThrow(request, master, nonblockers),
                permissions: auth.getPermissions(unpacked.project, bound_bucket, nonblockers),
            });
            auth.checkReadPermissions(resolved.permissions, resolved.user, unpacked.project);
            allowed.add(unpacked.project);
        }

        let header;
        let file_header_fun = v => bound_bucket.head(unpacked.project + "/" + v + "/" + unpacked.path);
        if (unpacked.version == "latest") {
            let attempt = await latest.attemptOnLatest(unpacked.project, bound_bucket, file_header_fun, res => res == null);
            header = attempt.result;
            unpacked.version = attempt.version;
        } else {
            header = await file_header_fun(unpacked.version);
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
