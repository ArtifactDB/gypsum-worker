import * as misc from "./utils/misc.js";
import * as http from "./utils/http.js";
import * as s3 from "./utils/s3.js";
import * as auth from "./utils/permissions.js";
import * as pkeys from "./utils/internal.js";

export async function createProjectHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins())) {
        throw new http.HttpError("user does not have the right to create projects", 403);
    }

    if (project.indexOf("/") >= 0) {
        throw new http.HttpError("project name cannot contain '/'", 400);
    }

    let bound_bucket = s3.getR2Binding();
    let permpath = pkeys.permissions(project);
    if ((await bound_bucket.head(permpath)) !== null) {
        throw new http.HttpError("project '" + project + "' already exists", 400);
    }

    let body = await http.bodyToJson(request);
    if (!misc.isJsonObject(body)) {
        throw new http.HttpError("expected a JSON object in the request body", 400);
    }

    let new_perms = { owners: [], uploaders: [] };
    if ('permissions' in body) {
        let req_perms = body.permissions;
        auth.validatePermissions(req_perms);
        for (const field of Object.keys(new_perms)) {
            if (field in req_perms) {
                new_perms[field] = req_perms[field];
            }
        }
    }

    let info = await s3.quickUploadJson(permpath, new_perms)
    if (info == null) {
        throw new http.HttpError("failed to upload permissions for project '" + project + "'", 500);
    }

    return new Response(null, { status: 200 });
}
