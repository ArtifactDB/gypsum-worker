import * as http from "./http.js";
import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";

async function hashToken(session_token) {
    // See reasoning in permissions.js about hashing the token.
    const encoder = new TextEncoder();
    const data = encoder.encode(session_token);
    let digest = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

export async function lockProject(project, asset, version, session_token) {
    let bound_bucket = s3.getR2Binding();
    let lck = pkeys.lock(project);

    let h = await bound_bucket.head(lck);
    if (h !== null) {
        throw new http.HttpError("project asset has already been locked", 403);
    }

    let hash = await hashToken(session_token);
    await bound_bucket.put(lck, JSON.stringify({ session_hash: hash, asset: asset, version: version }));
    return;
}

export async function unlockProject(project) {
    let bound_bucket = s3.getR2Binding();
    let lck = pkeys.lock(project);
    await bound_bucket.delete(lck);
}

export async function checkLock(project, asset, version, session_token) {
    let bound_bucket = s3.getR2Binding();
    let lck = pkeys.lock(project);

    let g = await bound_bucket.get(lck);
    if (g == null) {
        throw new http.HttpError("project has not been previously locked for upload", 403);
    }

    if (!session_token.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
        throw new http.HttpError("session token does not look like a v4 UUID", 403);
    }
    let hash = await hashToken(session_token);

    let body = await g.json();
    if (body.session_hash !== hash) {
        throw new http.HttpError("project was locked for a different upload session", 403);
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
