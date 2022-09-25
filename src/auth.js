import * as utils from "./utils.js";
import * as gh from "./github.js";

export async function findUser(request, master) {
    let auth = request.headers.get("Authorization");
    if (auth == null || !auth.startsWith("Bearer ")) {
        return null;
    }

    let token = auth.slice(7);
    let user;
    try {
        user = await gh.identifyUser(token, master);
    } catch (e) {
        throw new Error("failed to determine user from the GitHub token: " + e.message);
    }

    return user;
}

export async function findUserHandler(request, master) {
    let user;
    
    try {
        user = await findUser(request, master);
    } catch (e) {
        throw utils.errorResponse(e.message, 401);        
    }

    if (user !== null) {
        return new Response(user, { status: 200, "Content-Type": "text" });
    } else {
        return utils.errorResponse("no user identity supplied", 401);
    }
}

function getPermissionsPath(project) {
    return project + "/..permissions.json";
}

export async function getPermissions(project) {
    let path = getPermissionsPath(project);
    let res = await GYPSUM_BUCKET.get(path);
    if (res == null) {
        return null;
    }
    return await res.json();
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

export async function getPermissionsHandler(request, master) {
    let project = request.params.project;

    let perms = await getPermissions(project);
    if (perms == null) {
        return utils.errorResponse("requested project does not exist", 404);
    }

    let user = null;
    try {
        user = await findUser(request, master);
    } catch(e) {
        ;
    }
    if (determinePrivileges(perms, user) == "none") {
        return utils.errorResponse("user does not have access to the requested project", 403);
    }

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

    let perms = await getPermissions(project);
    if (perms == null) {
        return utils.errorResponse("requested project does not exist", 404);
    }

    let user = null;
    try {
        user = await findUser(request, master);
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

    event.waitUntil(GYPSUM_BUCKET.put(getPermissionsPath(project), JSON.stringify(perms)));
    return new Response(null, { status: 202 });
}
