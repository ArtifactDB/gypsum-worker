import * as utils from "./utils.js";

function getLockPath(project, version) {
    return project + "/" + version + "/..LOCK";
}

export async function lockProject(project, version, bound_bucket, user, misc={}) {
    let lck = getLockPath(project, version);
    let h = await bound_bucket.head(lck);
    if (h !== null) {
        throw new utils.HttpError("project version has already been locked", 403);
    }
    await bound_bucket.put(lck, JSON.stringify({ user: user, misc: misc }));
    return;
}

export async function checkLock(project, version, bound_bucket, user) {
    let lck = getLockPath(project, version);

    let g = await bound_bucket.get(lck);
    if (g == null) {
        throw new utils.HttpError("project version has not been previously locked for upload", 403);
    }

    let body = await g.json();
    if (body.user !== user) {
        throw new utils.HttpError("project version was locked for upload by a different user", 403);
    }

    return;
}

export async function isLocked(project, version, bound_bucket) {
    let locked = await bound_bucket.head(project + "/" + version + "/..LOCK");
    return (locked !== null);
}
