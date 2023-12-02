import * as utils from "./utils.js";
import * as s3 from "./s3.js";
import * as auth from "./auth.js";
import * as pkeys from "./internal.js";

export async function createProjectHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins())) {
        throw new utils.HttpError("user does not have the right to create projects", 403);
    }

    if (project.indexOf("/") >= 0) {
        throw new utils.HttpError("project name cannot contain '/'", 400);
    }

    let bound_bucket = s3.getR2Binding();
    let permpath = pkeys.permissions(project);
    if ((await bound_bucket.head(permpath)) !== null) {
        throw new utils.HttpError("project '" + project + "' already exists", 400);
    }

    let new_perms = await utils.bodyToJson(request);
    auth.validatePermissions(new_perms);

    let info = await utils.quickUploadJson(permpath, new_perms)
    if (info == null) {
        throw new utils.HttpError("failed to upload permissions for project '" + project + "'", 500);
    }

    return new Response(null, { status: 200 });
}
