import * as utils from "./utils.js";
import * as gh from "./github.js";

export async function identifyUser(request) {
    if (!("Authentication" in request.headers)) {
        return null;
    }

    let auth = request.headers["Authentication"];
    if (!auth.startsWith("Bearer ")) {
        return null;
    }

    let token = auth.slice(7);

    const tokenCache = caches.open("token:cache");
    let check = await tokenCache.match(token);
    if (check) {
        let info = await check.json();
        return info.login;
    } else {
        let info = await gh.identifyUser(token);
        let expiry = new Date(Date.now() + 60 * 60 * 1000);
        info.headers["Expires"] = expiry.toISOString();
        tokenCache.put(token, info.clone()); // need to store a clone.
        return (await info.json()).login;
    }
}

export async function isAllowedUploader(request) {
    let user = await identifyUser(request);
    if (user == null) {
        return utils.errorResponse("expected a GitHub PAT in the Authorization header", 401);
    }

    let allowed = new Set(["LTLA", "lelongs", "jkanche", "PeteHaitch", "vjcitn"]);
    if (!allowed.has(user)) {
        return utils.errorResponse("user '" + user + "' is not in the list of allowed uploaders", 401);
    }

    return null;
}
