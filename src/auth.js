import * as utils from "./utils.js";
import * as gh from "./github.js";

export async function findUser(request, master, afterwards) {
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

    let user;
    try {
        let res = await gh.identifyUser(token, master, afterwards);
        user = (await res.json()).login;
    } catch (e) {
        throw new Error("failed to determine user from the GitHub token: " + e.message);
    }

    check = new Response(JSON.stringify({ login: user }), { 
        headers: {
            "Content-Type": "application/json",
            "Expires": utils.hoursFromNow(1)
        }
    });
    afterwards.push(userCache.put(key, check));

    return user;
}

export async function findUserHandler(request, master, event) {
    let user;
    let cache_waits = [];

    try {
        user = await findUser(request, master, cache_waits);
    } catch (e) {
        throw utils.errorResponse(e.message, 401);        
    }

    event.waitUntil(Promise.all(cache_waits));
    if (user !== null) {
        return new Response(user, { status: 200, "Content-Type": "text" });
    } else {
        return utils.errorResponse("no user identity supplied", 401);
    }
}

function getPermissionsPath(project) {
    return project + "/..permissions.json";
}

export async function getPermissions(project, afterwards) {
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
    let info = new Response(data, {
        headers: {
            "Content-Type": "application/json",
            "Expires": utils.minutesFromNow(1)
        }
    });

    afterwards.push(permCache.put(key, info));
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

export async function getPermissionsHandler(request, master, event) {
    let project = request.params.project;

    let cache_waits = [];
    let perms = await getPermissions(project, cache_waits);
    if (perms == null) {
        return utils.errorResponse("requested project does not exist", 404);
    }

    let user = null;
    try {
        user = await findUser(request, master, cache_waits);
    } catch(e) {
        ;
    }
    if (determinePrivileges(perms, user) == "none") {
        return utils.errorResponse("user does not have access to the requested project", 403);
    }

    event.waitUntil(Promise.all(cache_waits));
    return utils.jsonResponse(perms, 200);
}

export function checkPermissions(perm) {
    let allowed = ["public", "viewers", "none"];
    if (typeof perm.read_access != "string" || allowed.indexOf(perm.read_access) == -1) {
        throw new Error("'read_access' for permissions must be one of public, viewers or none");
    }

    for (const v of perm.viewers) {
        if (typeof v != "string" || v.length == 0) {
            throw new Error("'viewers' should be an array of non-empty strings");
        }
    }

    for (const v of perm.owners) {
        if (typeof v != "string" || v.length == 0) {
            throw new Error("'owners' should be an array of non-empty strings");
        }
    }
}

export async function setPermissionsHandler(request, master, event) {
    let project = request.params.project;

    let cache_waits = [];
    let perms = await getPermissions(project, cache_waits);
    if (perms == null) {
        return utils.errorResponse("requested project does not exist", 404);
    }

    let user = null;
    try {
        user = await findUser(request, master, cache_waits);
    } catch(e) {
        ;
    }
    if (determinePrivileges(perms, user) == "owner") {
        return utils.errorResponse("user does not own the requested project", 403);
    }

    // Updating everything on top of the existing permissions.
    let new_perms = await request.json();
    for (const x of Object.keys(perms)) {
        if (x in new_perms) {
            perms[x] = new_perms[x];
        }
    }

    try {
        checkPermissions(perms);
    } catch (e) {
        return utils.errorResponse(e.message, 400);
    }

    cache_waits.push(GYPSUM_BUCKET.put(getPermissionsPath(project), JSON.stringify(perms)));
    event.waitUntil(Promise.all(cache_waits));
    return new Response(null, { status: 202 });
}
