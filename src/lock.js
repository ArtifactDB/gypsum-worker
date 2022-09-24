function getLockPath(project, version) {
    return project + "/" + version + "/..LOCK";
}

export async function lockProject(project, version, user, misc={}) {
    let lck = getLockPath(project, version);
    let h = await GYPSUM_BUCKET.head(lck);
    if (h !== null) {
        throw new Error("project version has already been locked");
    }
    await GYPSUM_BUCKET.put(lck, JSON.stringify({ user: user, misc: misc }));
    return;
}

export async function checkLock(project, version, user) {
    let lck = getLockPath(project, version);

    let g = await GYPSUM_BUCKET.get(lck);
    if (g == null) {
        throw new Error("project version has not been previously locked for upload");
    }

    let body = await g.json();
    if (body.user !== user) {
        throw new Error("project version was locked for upload by a different user");
    }

    return;
}

