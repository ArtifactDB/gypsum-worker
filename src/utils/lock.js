import * as http from "./http.js";
import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";

async function hashToken(session_token) {
    // We need to hash the token as the LOCK is publicly viewable.  Our tokens
    // are UUIDs and these should have high enough entropy that we don't need
    // salting or iterations, see commentary at:
    // https://security.stackexchange.com/questions/151257/what-kind-of-hashing-to-use-for-storing-rest-api-tokens-in-the-database
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

    /* 
     * Previously, we used a UUID to distinguish between multiple user uploads
     * to the same project, different assets and same version; if we just
     * stored the user name, it was possible for two uploads for different
     * assets to interfere with each other. This is no longer relevant as we
     * only allow one upload per project, and the LOCK file stores the asset
     * name. Now, we use a UUID as a session token so that the user doesn't
     * need to re-authenticate via GitHub during the remainder of the upload
     * process (which might get rate limited). It's no slower as the GitHub
     * token needs to be hashed for local caching anyway.
     */
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
