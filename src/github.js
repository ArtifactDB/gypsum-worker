import * as utils from "./utils.js";

const api = "https://api.github.com";
var repository = "placeholder";
var user_agent = "placeholder";
var master_token = "placeholder";
var test_rigging = null;

export function setRepository(repo) {
    repository = repo;
    return;
}

export function setUserAgent(agent) {
    user_agent = agent;
    return;
}

export function setToken(token) {
    master_token = token;
    return;
}

export function getToken() {
    return master_token;
}

export function enableTestRigging(enable = true) {
    if (enable) {
        test_rigging = { postNewIssue: [], getIssue: {}, identifyUser: {}, identifyUserOrgs: {} };
    } else {
        test_rigging = null;
    }
    return test_rigging;
}

export async function postNewIssue(title, body) {
    if (test_rigging != null) {
        // Fallback for testing purposes.
        let stub = { number: -1, title: title, body: body };
        test_rigging.postNewIssue.push(stub);
        return new Response(JSON.stringify(stub));
    }

    let URL = api + "/repos/" + repository + "/issues";

    let res = await fetch(URL, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            "Authorization": "Bearer " + master_token,
            "User-Agent": user_agent
        },
        "body": JSON.stringify({ title: title, "body": body })
    });

    if (!res.ok) {
        throw new utils.HttpError("failed to post a GitHub issue on the CI repository", 500);
    }

    return res;
}

export async function getIssue(id) {
    if (test_rigging != null) {
        // Fallback for testing purposes.
        return new Response(JSON.stringify(test_rigging.getIssue[id]));
    }

    let URL = api + "/repos/" + repository + "/issues/" + id;

    let res = await fetch(URL, {
        headers: {
            "Authorization": "Bearer " + master_token,
            "User-Agent": user_agent
        }
    });

    if (!res.ok) {
        throw new utils.HttpError("failed to query GitHub issues on the CI repository", 500);
    }

    return res;
}

export async function identifyUser(token) {
    if (test_rigging != null) {
        // Fallback for testing purposes.
        return new Response(JSON.stringify(test_rigging.identifyUser[token]));
    }

    let URL = api + "/user";

    let res = await fetch(URL, { 
        headers: {
            "Authorization": "Bearer " + token,
            "User-Agent": user_agent
        }
    });

    if (!res.ok) {
        throw new utils.HttpError("failed to query GitHub for user identity", 401);
    }

    return res;
}

export async function identifyUserOrgs(token) {
    if (test_rigging != null) {
        // Fallback for testing purposes.
        return new Response(JSON.stringify(test_rigging.identifyUserOrgs[token]));
    }

    let URL = api + "/user/orgs";

    let res = await fetch(URL, { 
        headers: {
            "Authorization": "Bearer " + token,
            "User-Agent": user_agent
        }
    });

    if (!res.ok) {
        throw new utils.HttpError("failed to query GitHub for user organizations", 401);
    }

    return res;
}

export function createIssueUrl(id) {
    return "https://github.com/" + repository + "/issues/" + id;
}

