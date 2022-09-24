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

export async function getPermissions(project) {
    let path = project + "/..permissions.json";
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

export async function getPermissionsHandler(request, master) {
    let project = request.params.id;

    let perms = await getPermissions(project);
    console.log(["Perms is ", perms]);
    if (perms == null) {
        return utils.errorResponse("requested project does not exist", 404);
    }

    let user = null;
    try {
        user = await findUser(request, master);
    } catch(e) {
        ;
    }
    console.log(user);
    if (determinePrivileges(perms, user) == "none") {
        return utils.errorResponse("user does not have access to the requested project", 403);
    }

    return utils.jsonResponse(perms, 200);
}
