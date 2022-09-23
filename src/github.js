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
        "body": JSON.stringify({ title: "upload complete", "body": body })
    });

    if (!res.ok) {
        throw new Error("failed to trigger GitHub Actions for indexing");
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
        throw new Error("failed to query GitHub for indexing status");
    }

    return res;
}

export async function identifyUser(token) {
    let URL = api + "/user";

    let res = await fetch(URL, {
        headers: {
            "Authorization": "Bearer " + master,
            "User-Agent": agent
        }
    });

    if (!res.ok) {
        throw new Error("failed to query GitHub for user identity");
    }

    return res.json();
}

export function createIssueUrl(id) {
    return "https://github.com/" + ci_repo + "/issues/" + id;
}

