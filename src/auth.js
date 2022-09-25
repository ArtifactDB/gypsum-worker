import * as utils from "./utils.js";
import * as gh from "./github.js";

export async function findUser(request, master, nonblockers) {
    let auth = request.headers.get("Authorization");
    if (auth == null || !auth.startsWith("Bearer ")) {
        return null;
    }

    let token = auth.slice(7);

    // Hashing the token with HMAC to avoid problems if the cache leaks. The
    // identity now depends on two unknowns - the user-supplied token, and the
    // server-side secret, which should be good enough.
    let key;
    {
        let enc = new TextEncoder();
        let ckey = await crypto.subtle.importKey("raw", enc.encode(master), { name: "HMAC", hash: "SHA-256" }, false, [ "sign" ]);
        let secured = await crypto.subtle.sign({ name: "HMAC" }, ckey, enc.encode(token));
        key = URL + "/" + btoa(secured); // A pretend URL for caching purposes: this should not get called.
    }

    const userCache = await caches.open("user:cache");
    let check = await userCache.match(key);
    if (check) {
        let info = await check.json();
        return info.login;
    }

    let res = await gh.identifyUser(token);
    let user = (await res.json()).login;
    nonblockers.push(utils.quickCacheJson(userCache, key, { login: user }, utils.hoursFromNow(2)));
    return user;
}

export async function findUserHandler(request, master, nonblockers) {
    let user = await findUser(request, master, nonblockers);
    if (user === null) {
        throw new utils.HttpError("no user identity supplied", 401);
    }
    return new Response(user, { status: 200, "Content-Type": "text" });
}

function getPermissionsPath(project) {
    return project + "/..permissions.json";
}

export async function getPermissions(project, nonblockers) {
    const permCache = await caches.open("permission:cache");

    // Key needs to be a URL.
    const key = "https://github.com/ArtifactDB/gypsum-worker/permissions/" + project;

    let check = await permCache.match(key);
    if (check) {
        return await check.json();
    }

    let path = getPermissionsPath(project);
    let res = await GYPSUM_BUCKET.get(path);
    if (res == null) {
        return null;
    }

    let data = await res.text();
    nonblockers.push(utils.quickCacheJsonText(permCache, key, data, utils.minutesFromNow(5)));
    return JSON.parse(data);
}

export function determinePrivileges(perm, user) {
    if (user !== null && perm.owners.indexOf(user) >= 0) {
        return "owner";
    }

    if (perm.read_access == "public") {
        return "viewer";
    }

    if (perm.read_access == "viewers" && user !== null && perm.viewers.indexOf(user) >= 0) {
        return "viewer";
    }

    return "none";
}

export const uploaders = new Set([
    "ArtifactDB-bot", 
    "LTLA", 
    "lelongs", 
    "jkanche", 
    "PeteHaitch", 
    "vjcitn"
]);

export async function getPermissionsHandler(request, master, nonblockers) {
    let project = request.params.project;

    let perms = await getPermissions(project, nonblockers);
    if (perms == null) {
        throw new utils.HttpError("requested project does not exist", 404);
    }

    let user = null;
    try { // just ignore invalid tokens.
        user = await findUser(request, master, nonblockers);
    } catch {}

    if (determinePrivileges(perms, user) == "none") {
        throw new utils.HttpError("user does not have access to the requested project", 403);
    }

    return utils.jsonResponse(perms, 200);
}

export function checkPermissions(perm) {
    let allowed = ["public", "viewers", "none"];
    if (typeof perm.read_access != "string" || allowed.indexOf(perm.read_access) == -1) {
        throw new utils.HttpError("'read_access' for permissions must be one of public, viewers or none", 400);
    }

    for (const v of perm.viewers) {
        if (typeof v != "string" || v.length == 0) {
            throw new utils.HttpError("'viewers' should be an array of non-empty strings", 400);
        }
    }

    for (const v of perm.owners) {
        if (typeof v != "string" || v.length == 0) {
            throw new utils.HttpError("'owners' should be an array of non-empty strings", 400);
        }
    }
}

export async function setPermissionsHandler(request, master, nonblockers) {
    let project = request.params.project;

    let perms = await getPermissions(project, nonblockers);
    if (perms == null) {
        throw new utils.HttpError("requested project does not exist", 404);
    }

    let user = await findUser(request, master, nonblockers);
    if (determinePrivileges(perms, user) == "owner") {
        throw new utils.HttpError("user does not own the requested project", 403);
    }

    // Updating everything on top of the existing permissions.
    let new_perms = await request.json();
    for (const x of Object.keys(perms)) {
        if (x in new_perms) {
            perms[x] = new_perms[x];
        }
    }
    checkPermissions(perms);

    nonblockers.push(GYPSUM_BUCKET.put(getPermissionsPath(project), JSON.stringify(perms)));
    return new Response(null, { status: 202 });
}
