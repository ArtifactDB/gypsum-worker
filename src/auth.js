import * as utils from "./utils.js";
import * as gh from "./github.js";
import * as pkeys from "./internal.js";

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
        key = "https://github.com/ArtifactDB/gypsum-actions/user/" + btoa(secured); // A pretend URL for caching purposes: this should not get called.
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

export async function findUserNoThrow(request, master, nonblockers) {
    try {
        return findUser(request, master, nonblockers);
    } catch (e) {
        console.warn(e.message);
        return null;
    }
}

export async function findUserHandler(request, bound_bucket, globals, nonblockers) {
    let master = globals.gh_master_token;
    let user = await findUser(request, master, nonblockers);
    if (user === null) {
        throw new utils.HttpError("no user identity supplied", 401);
    }
    return new Response(user, { status: 200, "Content-Type": "text" });
}

export async function getPermissions(project, bound_bucket, nonblockers) {
    const permCache = await caches.open("permission:cache");

    // Key needs to be a URL.
    const key = "https://github.com/ArtifactDB/gypsum-worker/permissions/" + project;

    let check = await permCache.match(key);
    if (check) {
        return await check.json();
    }

    let path = pkeys.permissions(project);
    let res = await bound_bucket.get(path);
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

export async function getPermissionsHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let master = globals.gh_master_token;

    let perms = await getPermissions(project, bound_bucket, nonblockers);
    if (perms == null) {
        throw new utils.HttpError("requested project does not exist", 404);
    }

    let user = await findUserNoThrow(request, master, nonblockers);
    if (determinePrivileges(perms, user) == "none") {
        throw new utils.HttpError("user does not have access to the requested project", 403);
    }

    return utils.jsonResponse(perms, 200);
}


export function checkReadPermissions(perm, user, project) {
    if (perm == null) {
        throw new utils.HttpError("failed to load permissions for project '" + project + "'", 500);
    }

    let level = determinePrivileges(perm, user);
    if (level == "none") {
        if (user !== null) {
            throw new utils.HttpError("user does not have read access to project '" + project + "'", 403);
        } else {
            throw new utils.HttpError("user credentials not supplied to access project '" + project + "'", 401);
        }
    }

    return null;
}

export function validateNewPermissions(perm) {
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

export async function setPermissionsHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let master = globals.gh_master_token;

    // Making sure the user identifies themselves first.
    let user = await findUser(request, master, nonblockers);

    // Don't use the cache: get the file from storage again.
    let path = pkeys.permissions(project);
    let res = await bound_bucket.get(path);
    if (res == null) {
        throw new utils.HttpError("requested project does not exist", 404);
    }

    let perms = await res.json();
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
    validateNewPermissions(perms);

    nonblockers.push(bound_bucket.put(path, JSON.stringify(perms)));
    return new Response(null, { status: 202 });
}
