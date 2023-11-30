import * as utils from "./utils.js";
import * as gh from "./github.js";
import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";

var encrypt_key = null;

export function getGlobalEncryptKey() {
    return encrypt_key;
}

export function setGlobalEncryptKey(x) {
    encrypt_key = x;
}

/******************************************
 ******************************************/

export function extractBearerToken(request, nonblockers) {
    let auth = request.headers.get("Authorization");
    if (auth == null || !auth.startsWith("Bearer ")) {
        throw new utils.HttpError("no user identity supplied", 401);
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
    nonblockers.push(utils.quickCacheJson(userCache, key, val, 2 * 3600));
    return val;
}

export async function findUserHandler(request, nonblockers) {
    let token = extractBearerToken(request);
    let user = await findUser(token, nonblockers);
    return utils.jsonResponse(user, 200);
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
        return null;
    }

    let data = await res.text();
    nonblockers.push(utils.quickCacheJsonText(permCache, key, data, 5 * 60));
    return JSON.parse(data);
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
    if (!(body instanceof Object)) {
        throw new utils.HttpError("expected permissions to be a JSON object", 400);
    }
    if (!("owners" in body) || !(body.owners instanceof Array)) {
        throw new utils.HttpError("expected 'owners' to be an array", 400);
    }
    for (const j of body.owners) {
        if (typeof j != "string") {
            throw new utils.HttpError("expected 'owners' to be an array of strings", 400);
        }
    }
}

export async function checkProjectManagementPermissions(project, token, nonblockers) {
    let resolved = await utils.namedResolve({
        user: findUser(token, nonblockers),
        permissions: getPermissions(project, nonblockers),
    });
    let user = resolved.user;
    let perms = resolved.permissions;
    if (!isOneOf(user, perms.owners) && !isOneOf(user, getAdmins())) {
        throw new utils.HttpError("user is not an owner of project '" + project + "'", 403);
    }
    return user;
}
