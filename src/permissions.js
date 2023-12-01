import * as utils from "./utils.js";
import * as auth from "./auth.js";
import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";

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
    if (!auth.isOneOf(user, res.owners) && !auth.isOneOf(user, auth.getAdmins())) {
        throw new utils.HttpError("user does not own project '" + project + "'", 403);
    }

    // Checking validity of request body. 
    let new_perms;
    try {
        new_perms = await request.json();
    } catch (e) {
        throw new utils.HttpError("failed to parse JSON body; " + String(err), 400);
    }
    validatePermissions(new_perms);

    // Updating everything on top of the existing permissions.
    for (const x of Object.keys(perms)) {
        if (x in new_perms) {
            perms[x] = new_perms[x];
        }
    }
    let perm_promise = bound_bucket.put(path, JSON.stringify(perms));

    // Clearing the cached permissions to trigger a reload on the next getPermissions() call.
    const permCache = await permissions_cache();
    nonblockers.push(permCache.delete(permissions_cache_key(project)));

    if ((await perm_promise) == null) {
        throw new utils.HttpError("failed to upload new permissions to the bucket", 500);
    }
    return new Response(null, { status: 200 });
}
