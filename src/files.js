import * as auth from "./auth.js";
import * as utils from "./utils.js";

export async function getVersionMetadata(project, version) {
    const versionCache = await caches.open("version:cache");

    // Key needs to be a URL.
    const key = "https://github.com/ArtifactDB/gypsum-worker/" + project + "/version/" + version + "/metadata";

    let check = await versionCache.match(key);
    if (check) {
        return await check.json();
    }

    let stuff = await GYPSUM_BUCKET.get(project + "/" + version + "/..revision.json");
    if (stuff == null) {
        throw new Error("failed to retrieve metadata for project '" + project + "' (version '" + version + "')");
    }

    let data = await stuff.text();
    let info = new Response(data, { 
        headers: { 
            "Content-Type": "application/json",
            "Expires": utils.hoursFromNow(2)
        } 
    });
    await versionCache.put(key, info);
    return JSON.parse(data);
}

export async function getLatestVersion(project) {
    const latestCache = await caches.open("latest:cache");

    // Key needs to be a URL.
    const key = "https://github.com/ArtifactDB/gypsum-worker/latest" + project;

    let check = await latestCache.match(key);
    if (check) {
        return await check.json();
    }

    let stuff = await GYPSUM_BUCKET.get(project + "/..latest.json");
    if (stuff == null) {
        throw new Error("failed to retrieve latest information for project '" + project + "'");
    }

    let data = await stuff.text();
    let info = new Response(data, { 
        headers: { 
            "Content-Type": "application/json", 
            "Expires": utils.minutesFromNow(1)
        }
    });

    await latestCache.put(key, info);
    return JSON.parse(data);
}

function checkPermissions(perm, user, project) {
    if (perm == null) {
        return utils.errorResponse("failed to load permissions for project '" + project + "'", 500);
    }
    
    if (auth.determinePrivileges(perm, user) == "none") {
        if (user !== null) {
            return utils.errorResponse("user does not have access to project '" + project + "'", 403);
        } else {
            return utils.errorResponse("user credentials not supplied to access project '" + project + "'", 401);
        }
    }

    return null;
}
    
export async function getFileMetadataHandler(request, master) {
    let id = decodeURIComponent(request.params.id);

    let unpacked;
    try {
        unpacked = utils.unpackId(id);
    } catch (e) {
        return utils.errorResponse(e.message, 400);
    }

    if (!unpacked.path.endsWith(".json")) {
        unpacked.path += ".json";
    }

    // Loading up on the promises.
    let all_promises = [];
    all_promises.push(auth.findUser(request, master).catch(error => null));
    all_promises.push(auth.getPermissions(unpacked.project));
    all_promises.push(getVersionMetadata(unpacked.project, unpacked.version));
    all_promises.push(getLatestVersion(unpacked.project));

    let r2path = unpacked.project + "/" + unpacked.version + "/" + unpacked.path;
    all_promises.push(GYPSUM_BUCKET.get(r2path));

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
        return utils.errorResponse("key '" + id + "' does not exist", 404);
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

export async function getFileHandler(request, bucket_name, s3obj, master) {
    let id = decodeURIComponent(request.params.id);
    let unpacked;
    try {
        unpacked = utils.unpackId(id);
    } catch (e) {
        return utils.errorResponse(e.message, 400);
    }

    // Loading up on the promises.
    let all_promises = [];
    all_promises.push(auth.findUser(request, master).catch(error => null));
    all_promises.push(auth.getPermissions(unpacked.project));

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

