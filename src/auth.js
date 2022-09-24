import * as utils from "./utils.js";
import * as gh from "./github.js";

export async function isAllowedUploader(request, master) {
    let auth = request.headers.get("Authorization");
    if (auth == null || !auth.startsWith("Bearer ")) {
        return utils.errorResponse("no token detected in the Authorization header", 400);
    }

    let token = auth.slice(7);
    let user;
    try {
        user = await gh.identifyUser(token, master);
    } catch (e) {
        return utils.errorResponse("failed to determine user from the GitHub token: " + e.message, 401);
    }

    let allowed = new Set(["ArtifactDB-bot", "LTLA", "lelongs", "jkanche", "PeteHaitch", "vjcitn"]);
    if (!allowed.has(user)) {
        return utils.errorResponse("user '" + user + "' is not in the list of allowed uploaders", 401);
    }

    return null;
}

export async function isAllowedUploaderHandler(request, master) {
    let resp = await isAllowedUploader(request, master);
    if (resp === null) {
        return new Response(null, { status: 204 });
    } else {
        return resp;
    }
}
