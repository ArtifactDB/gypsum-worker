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
        "body": JSON.stringify({ title: "upload complete", "body": body })
    });

    if (!res.ok) {
        throw new Error("failed to post a GitHub issue");
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
        throw new Error("failed to query GitHub issues");
    }

    return res;
}

export async function identifyUser(token, secret, afterwards) {
    let URL = api + "/user";

    // Hashing the token with HMAC to avoid problems if the cache leaks. The
    // identity now depends on two unknowns - the user-supplied token, and the
    // server-side secret, which should be good enough.
    let key;
    {
        let enc = new TextEncoder();
        let ckey = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [ "sign" ]);
        let secured = await crypto.subtle.sign({ name: "HMAC" }, ckey, enc.encode(token));
        key = URL + "/" + btoa(secured); // A pretend URL for caching purposes: this should not get called.
    }

    const tokenCache = await caches.open("token:cache");
    let check = await tokenCache.match(key);

    if (!check) {
        let res = await fetch(URL, { 
            headers: {
                "Authorization": "Bearer " + token,
                "User-Agent": agent
            }
        });
        if (!res.ok) {
            throw new Error("failed to query GitHub for user identity");
        }

        let data = await res.text();
        check = new Response(data, { 
            headers: {
                "Content-Type": "application/json",
                "Expires": utils.hoursFromNow(1)
            }
        });

        afterwards.push(tokenCache.put(key, check));
        return JSON.parse(data).login;
    } else {
        let info = await check.json();
        return info.login;
    }
}

export function createIssueUrl(id) {
    return "https://github.com/" + ci_repo + "/issues/" + id;
}

