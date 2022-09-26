import * as utils from "./utils.js";

const api = "https://api.github.com";
const ci_repo = "ArtifactDB/gypsum-actions";
const agent = "gypsum-test-worker";

export async function postNewIssue(title, body, master) {
    let URL = api + "/repos/" + ci_repo + "/issues";

    let res = await fetch(URL, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            "Authorization": "Bearer " + master,
            "User-Agent": agent
        },
        "body": JSON.stringify({ title: title, "body": body })
    });

    if (!res.ok) {
        throw new utils.HttpError("failed to post a GitHub issue on the CI repository", 500);
    }

    return res;
}

export async function getIssue(id, master) {
    let URL = api + "/repos/" + ci_repo + "/issues/" + id;

    let res = await fetch(URL, {
        headers: {
            "Authorization": "Bearer " + master,
            "User-Agent": agent
        }
    });

    if (!res.ok) {
        throw new utils.HttpError("failed to query GitHub issues on the CI repository", 500);
    }

    return res;
}

export async function identifyUser(token, secret) {
    let URL = api + "/user";

    let res = await fetch(URL, { 
        headers: {
            "Authorization": "Bearer " + token,
            "User-Agent": agent
        }
    });

    if (!res.ok) {
        throw new utils.HttpError("failed to query GitHub for user identity", 401);
    }

    return res;
}

export function createIssueUrl(id) {
    return "https://github.com/" + ci_repo + "/issues/" + id;
}

