import * as utils from "./utils.js";
import * as gh from "./github.js";

export async function identifyUser(request) {
    let auth = request.headers.get("Authorization");
    if (auth == null || !auth.startsWith("Bearer ")) {
        return null;
    }

    let token = auth.slice(7);

    const tokenCache = await caches.open("token:cache");
    let check = await tokenCache.match(token);
    if (check) {
        let info = await check.json();
        return info.login;
    } else {
        let info = await gh.identifyUser(token);
        let expiry = new Date(Date.now() + 60 * 60 * 1000);
        info.headers["Expires"] = expiry.toISOString();
        tokenCache.put(info.url, info.clone()); // need to store a clone.
        return (await info.json()).login;
    }
}

export async function isAllowedUploader(request) {
    let user = await identifyUser(request);
    if (user == null) {
        return utils.errorResponse("failed to determine user from the GitHub token", 401);
    }

    let allowed = new Set(["LTLA", "lelongs", "jkanche", "PeteHaitch", "vjcitn"]);
    if (!allowed.has(user)) {
        return utils.errorResponse("user '" + user + "' is not in the list of allowed uploaders", 401);
    }

    return null;
}
