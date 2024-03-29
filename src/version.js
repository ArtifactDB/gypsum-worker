import * as pkeys from "./utils/internal.js";
import * as http from "./utils/http.js";
import * as vers from "./utils/version.js";
import * as auth from "./utils/permissions.js";
import * as s3 from "./utils/s3.js";
import * as lock from "./utils/lock.js";

export async function refreshLatestVersionHandler(request, env, nonblockers) {
    let token = auth.extractBearerToken(request);
    await auth.checkAdminPermissions(token, env, nonblockers);

    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    if ((await env.BOUND_BUCKET.head(pkeys.permissions(project))) == null) {
        throw new http.HttpError("project does not exist", 400);
    }

    // If we want update the version, we need to wait until the lock has been acquired,
    // just to avoid simultaneous attempts to set it from an ongoing upload.
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, "", session_key, env);

    let final_version;
    try {
        final_version = await vers.updateLatestVersion(project, asset, env);
    } finally {
        await lock.unlockProject(project, env);
    }

    let output = {};
    if (final_version != null) {
        output.version = final_version;
    }
    return new http.jsonResponse(output, 200);
}
