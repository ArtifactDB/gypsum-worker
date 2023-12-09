import * as uh from "./http.js";

const api = "https://api.github.com";
var test_rigging = null;

export function enableTestRigging(enable = true) {
    if (enable) {
        test_rigging = { identifyUser: {}, identifyUserOrgs: {} };
    } else {
        test_rigging = null;
    }
    return test_rigging;
}

async function propagate_github_error(res, base_txt, base_code) {
    if (res.ok) {
        return;
    }

    try {
        let body = await res.json();
        if ("message" in body) {
            base_txt += ": " + body.message;
        }
    } catch (e) {}

    throw new uh.HttpError(base_txt, base_code);
}

export async function identifyUser(token, env) {
    if (test_rigging != null) {
        // Fallback for testing purposes.
        return new Response(JSON.stringify(test_rigging.identifyUser[token]));
    }

    let URL = api + "/user";

    let res = await fetch(URL, { 
        headers: {
            "Authorization": "Bearer " + token,
            "User-Agent": env.GITHUB_USER_AGENT
        }
    });

    await propagate_github_error(res, "failed to query GitHub for user identity", 401);

    return res;
}

export async function identifyUserOrgs(token, env) {
    if (test_rigging != null) {
        // Fallback for testing purposes.
        return new Response(JSON.stringify(test_rigging.identifyUserOrgs[token]));
    }

    let URL = api + "/user/orgs";

    let res = await fetch(URL, { 
        headers: {
            "Authorization": "Bearer " + token,
            "User-Agent": env.GITHUB_USER_AGENT
        }
    });

    await propagate_github_error(res, "failed to query GitHub for user organizations", 401);

    return res;
}

export function getGitHubAppCredentials(env) {
    return {
        id: env.GITHUB_APP_ID,
        secret: env.GITHUB_APP_SECRET
    };
}
