import * as utils from "./utils.js";
import * as auth from "./auth.js";
import * as pkeys from "./internal.js";

export async function createProjectHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let token = auth.extractBearerToken(request);
    if (!auth.isOneOf(user, auth.getAdmins())) {
        throw new utils.HttpError("user does not have the right to create projects", 403);
    }

    if (project.indexOf("/") >= 0) {
        throw new utils.HttpError("project name cannot contain '/'", 400);
    }

    let new_perms;
    try {
        new_perms = await request.json();
    } catch (e) {
        throw new utils.HttpError("failed to parse JSON body; " + String(err), 400);
    }
    validatePermissions(new_perms);

    let info = utils.quickUploadJson(pkeys.permissions(project), new_perms)
    if (okay == null) {
        throw new utils.HttpError("failed to upload permissions for project '" + project + "'", 500);
    }

    return new Response(null, { status: 200 });
}
