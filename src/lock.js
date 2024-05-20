import * as auth from "./utils/permissions.js";
import * as lock from "./utils/lock.js";

export async function unlockProjectHandler(request, env, nonblockers) {
    let token = auth.extractBearerToken(request);
    await auth.checkAdminPermissions(token, env, nonblockers);
    let project = decodeURIComponent(request.params.project);
    await lock.unlockProject(project, env);
    return new Response(null, { status: 200 });
}
