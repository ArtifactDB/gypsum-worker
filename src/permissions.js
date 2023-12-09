import * as http from "./utils/http.js";
import * as auth from "./utils/permissions.js";
import * as pkeys from "./utils/internal.js";
import * as s3 from "./utils/s3.js";
import * as gh from "./utils/github.js";

export async function setPermissionsHandler(request, env, nonblockers) {
    let project = decodeURIComponent(request.params.project);

    // Making sure the user identifies themselves first.
    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, env, nonblockers);

    // Don't use the cache: get the file from storage again,
    // just in case it was updated at some point.
    let path = pkeys.permissions(project);
    let perms = await s3.quickFetchJson(path, env, { mustWork: false });
    if (perms == null) {
        throw new http.HttpError("project '" + project + "' does not exist", 404);
    }
    if (!auth.isOneOf(user, perms.owners) && !auth.isOneOf(user, auth.getAdmins(env))) {
        throw new http.HttpError("user does not own project '" + project + "'", 403);
    }

    // Checking validity of request body. 
    let new_perms = await http.bodyToJson(request);
    auth.validatePermissions(new_perms);

    // Updating everything on top of the existing permissions.
    for (const x of Object.keys(perms)) {
        if (x in new_perms) {
            perms[x] = new_perms[x];
        }
    }
    await s3.quickUploadJson(path, perms, env);

    // Clearing the cached permissions to trigger a reload on the next getPermissions() call.
    auth.flushCachedPermissions(project, nonblockers);

    return new Response(null, { status: 200 });
}

export function fetchS3Credentials(request, env, nonblockers) {
    return new http.jsonResponse(s3.getPublicS3Credentials(env), 200, { 'Access-Control-Allow-Origin': '*' }); 
}

export function fetchGitHubCredentials(request, env, nonblockers) {
    return new http.jsonResponse(gh.getGitHubAppCredentials(env), 200, { 'Access-Control-Allow-Origin': '*' });
}
