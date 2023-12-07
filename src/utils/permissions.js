import * as misc from "./misc.js";
import * as http from "./http.js";
import * as gh from "./github.js";
import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";

/******************************************
 ******************************************/

export function extractBearerToken(request) {
    let auth = request.headers.get("Authorization");
    if (auth == null || !auth.startsWith("Bearer ")) {
        throw new http.HttpError("no user identity supplied", 401);
    }
    return auth.slice(7);
}

export async function findUser(token, nonblockers) {
    // Some cursory hashing of the token to avoid problems if the cache leaks.
    // Github's tokens should have high enough entropy that we don't need
    // salting or iterations, see commentary at:
    // https://security.stackexchange.com/questions/151257/what-kind-of-hashing-to-use-for-storing-rest-api-tokens-in-the-database
    let hash;
    {
        const encoder = new TextEncoder();
        const data = encoder.encode(token);
        let digest = await crypto.subtle.digest("SHA-256", data);
        hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
    }
    let key = "https://github.com/ArtifactDB/gypsum-actions/user/" + hash;

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
        let raw_orgs = await (await org_prom).json();
        for (const x of raw_orgs) {
            if (typeof x.login == "string") {
                orgs.push(x.login);
            }
        }
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
    nonblockers.push(http.quickCacheJson(userCache, key, val, 2 * 3600));
    return val;
}

/******************************************
 ******************************************/

function permissions_cache() {
    return caches.open("permissions:cache");
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
        throw new http.HttpError("no existing permissions for project '" + project + "'", 400);
    }

    let data = await res.text();
    nonblockers.push(http.quickCacheJsonText(permCache, key, data, 5 * 60));
    return JSON.parse(data);
}

export async function flushCachedPermissions(project, nonblockers) {
    const permCache = await permissions_cache();
    nonblockers.push(permCache.delete(permissions_cache_key(project)));
    return;
}

/******************************************
 ******************************************/

export function isOneOf(user, allowed) {
    // TODO: cache the return value to avoid having to recompute
    // this on subsequent requests? Not sure if it's worth it,
    // unless the permission structure is very complicated.
    if (user.organizations.length == 0) {
        return allowed.indexOf(user.login) >= 0;
    }

    let all = new Set(allowed);
    let present = all.has(user.login);
    if (present) {
        return true;
    }

    for (const o of user.organizations) {
        if (all.has(o)) {
            return true;
        }
    }

    return false;
}

var admins = [];

export function setAdmins(x) {
    admins = x;
    return;
}

export function getAdmins() {
    return admins;
}

/******************************************
 ******************************************/

export function validatePermissions(body) {
    if (!misc.isJsonObject(body)) {
        throw new http.HttpError("expected permissions to be a JSON object", 400);
    }

    if ("owners" in body) {
        let owners = body.owners;
        if (!(owners instanceof Array)) {
            throw new http.HttpError("expected 'owners' to be an array", 400);
        }
        for (const j of owners) {
            if (typeof j != "string") {
                throw new http.HttpError("expected 'owners' to be an array of strings", 400);
            }
        }
    }

    if ("uploaders" in body) {
        let uploaders = body.uploaders;
        if (!(uploaders instanceof Array)) {
            throw new http.HttpError("expected 'uploaders' to be an array", 400);
        }
        for (const entry of uploaders) {
            if (!misc.isJsonObject(entry)) {
                throw new http.HttpError("expected 'uploaders' to be an array of objects", 400);
            }

            if (!("id" in entry) || typeof entry.id != "string") {
                throw new http.HttpError("expected 'uploaders.id' property to be a string", 400);
            }

            if ("until" in entry) {
                if (typeof entry.until != "string") {
                    throw new http.HttpError("expected 'uploaders.until' property to be a date/time-formatted string", 400);
                }
                if (!entry.until.match(/^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
                    throw new http.HttpError("expected 'uploaders.until' property to be a date/time-formatted string", 400);
                }
                let parsed = Date.parse(entry.until);
                if (Number.isNaN(parsed)) {
                    throw new http.HttpError("expected 'uploaders.until' property to be a date/time-formatted string", 400);
                }
            }

            if ("trusted" in entry) {
                if (typeof entry.trusted != "boolean") {
                    throw new http.HttpError("expected 'uploaders.trusted' property to be a boolean", 400);
                }
            }

            if ("asset" in entry) {
                if (typeof entry.asset != "string") {
                    throw new http.HttpError("expected 'asset' property to be a string");
                }
            }

            if ("version" in entry) {
                if (typeof entry.version != "string") {
                    throw new http.HttpError("expected 'version' property to be a string");
                }
            }
        }
    }
}

export async function checkProjectManagementPermissions(project, token, nonblockers) {
    let resolved = await misc.namedResolve({
        user: findUser(token, nonblockers),
        permissions: getPermissions(project, nonblockers),
    });
    let user = resolved.user;
    let perms = resolved.permissions;
    if (!isOneOf(user, perms.owners) && !isOneOf(user, getAdmins())) {
        throw new http.HttpError("user is not an owner of project '" + project + "'", 403);
    }
    return user;
}

export async function checkProjectUploadPermissions(project, asset, version, token, nonblockers) {
    let resolved = await misc.namedResolve({
        user: findUser(token, nonblockers),
        permissions: getPermissions(project, nonblockers),
    });

    let user = resolved.user;
    let perms = resolved.permissions;
    if (isOneOf(user, perms.owners) || isOneOf(user, getAdmins())) {
        return { can_manage: true, is_trusted: true, user: user };
    }

    let user_orgs = new Set(user.organizations);
    for (const uploader of perms.uploaders) {
        if (uploader.id == user.login || user_orgs.has(uploader.id)) {
            if ("asset" in uploader && uploader.asset != asset) {
                break;
            }
            if ("version" in uploader && uploader.version != version) {
                break;
            }
            if ("until" in uploader && Date.parse(uploader.until) < Date.now()) {
                break;
            }
            let is_trusted = false;
            if ("trusted" in uploader) {
                is_trusted = uploader.trusted;
            }
            return { can_manage: false, is_trusted: is_trusted, user: user };
        }
    }

    throw new http.HttpError("user is not authorized to upload", 403);
}
