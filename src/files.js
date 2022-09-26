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

function checkPermissions(perm, user, project) {
    if (perm == null) {
        throw new utils.HttpError("failed to load permissions for project '" + project + "'", 500);
    }
    
    if (auth.determinePrivileges(perm, user) == "none") {
        if (user !== null) {
            throw new utils.HttpError("user does not have access to project '" + project + "'", 403);
        } else {
            throw new utils.HttpError("user credentials not supplied to access project '" + project + "'", 401);
        }
    }

    return null;
}
    
export async function getFileMetadataHandler(request, bound_bucket, globals, nonblockers) {
    let id = decodeURIComponent(request.params.id);
    let master = globals.gh_master_token;

    let unpacked = utils.unpackId(id);
    if (!unpacked.path.endsWith(".json")) {
        unpacked.path += ".json";
    }

    // Loading up on the promises.
    let all_promises = [];
    all_promises.push(auth.findUser(request, master, nonblockers).catch(error => null));
    all_promises.push(auth.getPermissions(unpacked.project, bound_bucket, nonblockers));
    all_promises.push(getVersionMetadata(unpacked.project, unpacked.version, bound_bucket, nonblockers));
    all_promises.push(getLatestVersion(unpacked.project, bound_bucket, nonblockers));

    let r2path = unpacked.project + "/" + unpacked.version + "/" + unpacked.path;
    all_promises.push(bound_bucket.get(r2path));

    // Resolving them all at once.
    let resolved = await Promise.all(all_promises);
    let user = resolved[0];
    let perm = resolved[1];
    let ver_meta = resolved[2];
    let lat_meta = resolved[3];
    let raw_meta = resolved[4];

    let err = checkPermissions(perm, user, unpacked.project);
    if (err !== null) {
        return err;
    }
    if (raw_meta === null) {
        throw new utils.HttpError("key '" + id + "' does not exist", 404);
    }

    let meta = await raw_meta.json();
    meta["_extra"] = {
        "$schema": meta["$schema"],
        project: unpacked.project,
        version: unpacked.version,
        artifactdb_id: id,
        ...ver_meta,
        latest: (lat_meta.version == unpacked.version)
    };

    return utils.jsonResponse(meta, 200);
}

export async function getFileHandler(request, bound_bucket, globals, nonblockers) {
    let id = decodeURIComponent(request.params.id);
    let unpacked = utils.unpackId(id);

    let master = globals.gh_master_token;
    let bucket_name = globals.r2_bucket_name;
    let s3obj = globals.s3_binding;

    // Loading up on the promises.
    let all_promises = [];
    all_promises.push(auth.findUser(request, master, nonblockers).catch(error => null));
    all_promises.push(auth.getPermissions(unpacked.project, bound_bucket, nonblockers));

    let expiry = request.query.expires_in;
    if (typeof expiry !== "number") {
        expiry = 120;
    }

    let key = unpacked.project + "/" + unpacked.version + "/" + unpacked.path;
    all_promises.push(s3obj.getSignedUrlPromise('getObject', { Bucket: bucket_name, Key: key, Expires: expiry }));

    // Resolving them all at once.
    let resolved = await Promise.all(all_promises);
    let user = resolved[0];
    let perm = resolved[1];

    let err = checkPermissions(perm, user, unpacked.project);
    if (err !== null) {
        return err;
    }

    let target = resolved[2];
    return Response.redirect(target, 302);
}

