import * as utils from "./utils.js";
import * as gh from "./github.js";
import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";
import { permissions as set_perm_validator } from "./validators.js";

async function find_user(request, nonblockers) {
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
        let master = gh.getToken();
        let enc = new TextEncoder();
        let ckey = await crypto.subtle.importKey("raw", enc.encode(master), { name: "HMAC", hash: "SHA-256" }, false, [ "sign" ]);
        let secured = await crypto.subtle.sign({ name: "HMAC" }, ckey, enc.encode(token));
        key = "https://github.com/ArtifactDB/gypsum-actions/user/" + btoa(secured); // A pretend URL for caching purposes: this should not get called.
    }

    const userCache = await caches.open("user:cache");
    let check = await userCache.match(key);
    if (check) {
        return await check.json();
    }

    let user_prom = gh.identifyUser(token);
    let org_prom = gh.identifyUserOrgs(token);

    // Sometimes the token doesn't provide the appropriate organization-level
    // permissions, so this ends up failing: but let's try to keep going. 
    let orgs = [];
    try {
        orgs = await (await org_prom).json();
    } catch (e) {
        if (e.statusCode == 401) {
            console.warn(e.message);
        } else {
            throw e;
        }
    }

    let val = { 
        login: (await (await user_prom).json()).login,
        organizations: orgs 
    };
    nonblockers.push(utils.quickCacheJson(userCache, key, val, utils.hoursFromNow(2)));
    return val;
}

export async function findUser(request, nonblockers) {
    let user = await find_user(request, nonblockers);
    if (user == null) {
        throw new utils.HttpError("no user identity supplied", 401);
    }
    return user;
}

export async function findUserNoThrow(request, nonblockers) {
    try {
        return find_user(request, nonblockers);
    } catch (e) {
        console.warn(e.message);
        return null;
    }
}

export async function findUserHandler(request, nonblockers) {
    let user = await findUser(request, nonblockers);
    return utils.jsonResponse(user, 200);
}

function permissions_cache() {
    return caches.open("permission:cache");
}

function permissions_cache_key(project) {
    // Key needs to be a URL.
    return "https://github.com/ArtifactDB/gypsum-worker/permissions/" + project;
}

export async function getPermissions(project, nonblockers) {
    const permCache = await permissions_cache();
    let bound_bucket = s3.getR2Binding();

    const key = permissions_cache_key(project);
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

export async function getPermissionsHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let user_prom = findUserNoThrow(request, nonblockers);

    // Non-standard endpoint, provided for testing.
    let perm_prom;
    if (request.query.force_reload === "true") {
        let bound_bucket = s3.getR2Binding();
        let key = pkeys.permissions(project);
        perm_prom = bound_bucket.get(key).then(res => (res == null ? null : res.json()));
    } else {
        perm_prom = getPermissions(project, nonblockers);
    }

    let perms = await perm_prom;
    if (perms == null) {
        throw new utils.HttpError("requested project does not exist", 404);
    }

    let user = await user_prom;
    checkReadPermissions(perms, user, project);

    return utils.jsonResponse(perms, 200);
}

function is_member_of(login, orgs, allowed) {
    // TODO: cache the return value to avoid having to recompute
    // this on subsequent requests? Not sure if it's worth it,
    // unless the permission structure is very complicated.
    if (orgs.length == 0) {
        return allowed.indexOf(login) >= 0;
    }

    let all = new Set(allowed);
    let present = all.has(login);
    if (present) {
        return true;
    }

    for (const o of orgs) {
        if (all.has(o)) {
            return true;
        }
    }

    return false;
}

export function checkReadPermissions(perm, user, project) {
    if (perm == null) {
        throw new utils.HttpError("failed to load permissions for project '" + project + "'", 404);
    }

    if (perm.read_access == "public") {
        return null;
    }

    if (user == null) {
        throw new utils.HttpError("user credentials not supplied to access project '" + project + "'", 401);
    }

    let in_owners = is_member_of(user.login, user.organizations, perm.owners);
    if (perm.read_access == "owners" && in_owners) {
        return null;
    }

    let in_viewers = is_member_of(user.login, user.organizations, perm.viewers);
    if (perm.read_access == "viewers" && (in_owners || in_viewers)) {
        return null;
    }

    throw new utils.HttpError("user does not have read access to project '" + project + "'", 403);
}

export function checkWritePermissions(perm, user, project) {
    if (perm == null) {
        throw new utils.HttpError("failed to load permissions for project '" + project + "'", 404);
    }

    if (user == null) {
        throw new utils.HttpError("user credentials not supplied to write to project '" + project + "'", 401);
    }

    let in_owners = is_member_of(user.login, user.organizations, perm.owners);
    if (perm.write_access == "owners" && in_owners) {
        return null;
    }

    throw new utils.HttpError("user does not have write access to project '" + project + "'", 403);
}

var uploaders = [];

export function setUploaders(x) {
    uploaders = x;
    return;
}

export function checkNewUploadPermissions(user) {
    if (user == null) {
        throw new utils.HttpError("user credentials not supplied to upload new project", 401);
    }

    if (is_member_of(user.login, user.organizations, uploaders)) {
        return null;
    }

    throw new utils.HttpError("user is not authorized to upload a new project", 403);
}

export function validateNewPermissions(perm) {
    let allowed_readers = ["public", "viewers", "owners", "none"];
    if (typeof perm.read_access != "string" || allowed_readers.indexOf(perm.read_access) == -1) {
        throw new utils.HttpError("'read_access' for permissions must be one of public, viewers, owners, or none", 400);
    }

    let allowed_writers = ["owners", "none"];
    if (typeof perm.write_access != "string" || allowed_writers.indexOf(perm.write_access) == -1) {
        throw new utils.HttpError("'write_access' for permissions must be one of owners or none", 400);
    }

    if (perm.scope !== "project") {
        throw new utils.HttpError("'scope' for permissions is currently limited to project", 400);
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

export async function setPermissionsHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let bound_bucket = s3.getR2Binding();

    // Making sure the user identifies themselves first.
    let user = await findUser(request, nonblockers);

    // Don't use the cache: get the file from storage again,
    // just in case it was updated at some point.
    let path = pkeys.permissions(project);
    let res = await bound_bucket.get(path);
    if (res == null) {
        throw new utils.HttpError("requested project does not exist", 404);
    }

    let perms = await res.json();
    checkWritePermissions(perms, user, project);

    let new_perms = await request.json();
    if (!set_perm_validator(new_perms)) {
        throw new utils.HttpError("invalid request body: " + set_perm_validator.errors[0].message + " (" + set_perm_validator.errors[0].schemaPath + ")", 400);
    }

    // Updating everything on top of the existing permissions.
    for (const x of Object.keys(perms)) {
        if (x in new_perms) {
            perms[x] = new_perms[x];
        }
    }
    validateNewPermissions(perms);
    nonblockers.push(bound_bucket.put(path, JSON.stringify(perms)));

    // Clearing the cached permissions to trigger a reload on the next getPermissions() call.
    const permCache = await permissions_cache();
    nonblockers.push(permCache.delete(permissions_cache_key(project)));

    return new Response(null, { status: 202 });
}
