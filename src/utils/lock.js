import * as http from "./http.js";
import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";

export async function lockProject(project, asset, version, user_name) {
    let bound_bucket = s3.getR2Binding();
    let lck = pkeys.lock(project);

    let h = await bound_bucket.head(lck);
    if (h !== null) {
        throw new http.HttpError("project asset has already been locked", 403);
    }

    await bound_bucket.put(lck, JSON.stringify({ user_name: user_name, asset: asset, version: version }));
    return;
}

export async function unlockProject(project) {
    let bound_bucket = s3.getR2Binding();
    let lck = pkeys.lock(project);
    await bound_bucket.delete(lck);
}

export async function checkLock(project, asset, version, user_name) {
    let bound_bucket = s3.getR2Binding();
    let lck = pkeys.lock(project);

    let g = await bound_bucket.get(lck);
    if (g == null) {
        throw new http.HttpError("project has not been previously locked for upload", 403);
    }

    let body = await g.json();
    if (body.user_name !== user_name) {
        throw new http.HttpError("project was locked for upload by a different user", 403);
    }
    if (body.asset !== asset) {
        throw new http.HttpError("project was locked for upload of a different asset", 403);
    }
    if (body.version !== version) {
        throw new http.HttpError("project was locked for upload of a different version", 403);
    }

    return;
}

export async function isLocked(project) {
    let bound_bucket = s3.getR2Binding();
    let locked = await bound_bucket.head(pkeys.lock(project));
    return (locked !== null);
}
