import * as utils from "./utils.js";
import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";

export async function lockProject(project, version, user_name, misc={}) {
    let bound_bucket = s3.getR2Binding();
    let lck = pkeys.lock(project, version);

    let h = await bound_bucket.head(lck);
    if (h !== null) {
        throw new utils.HttpError("project version has already been locked", 403);
    }

    await bound_bucket.put(lck, JSON.stringify({ user_name: user_name, misc: misc }));
    return;
}

export async function checkLock(project, version, user_name) {
    let bound_bucket = s3.getR2Binding();
    let lck = pkeys.lock(project, version);

    let g = await bound_bucket.get(lck);
    if (g == null) {
        throw new utils.HttpError("project version has not been previously locked for upload", 403);
    }

    let body = await g.json();
    if (body.user_name !== user_name) {
        throw new utils.HttpError("project version was locked for upload by a different user", 403);
    }

    return;
}

export async function isLocked(project, version) {
    let bound_bucket = s3.getR2Binding();
    let locked = await bound_bucket.head(pkeys.lock(project, version));
    return (locked !== null);
}
