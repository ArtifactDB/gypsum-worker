import * as utils from "./utils.js";
import * as auth from "./auth.js";

async function sign(value) {
    let enc = new TextEncoder();
    let secret = auth.getGlobalEncryptKey();
    let ckey = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [ "sign" ]);
    let sig = await crypto.subtle.sign("HMAC", ckey, enc.encode(value));
    return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

export async function requestTokenHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let token = auth.extractBearerToken(request);
    await auth.checkProjectManagementPermissions(project, token, nonblockers);

    let body;
    try {
        body = await request.json();
    } catch (e) {
        throw new utils.HttpError("failed to parse JSON body; " + String(err), 400);
    }
    if (!(body instanceof Object)) {
        throw new utils.HttpError("expected request body to be a JSON object");
    }

    let payload = { project };
    if (!("user_id" in body) || typeof body.user_id != "string")) {
        throw new utils.HttpError("expected 'user_id' property to be a string");
    }
    payload.user_id = body.user_id;

    // TODO: Check that this is a valid GitHub ID.

    if (!("expires_in" in body) || typeof body.user_id != "number")) {
        throw new utils.HttpError("expected 'expires_in' property to be a number");
    }
    payload.expires_in = Date.now() + body.expires_in * 60 * 60 * 1000;

    if ("asset" in body) {
        if (typeof body.asset != "string") {
            throw new utils.HttpError("expected 'asset' property to be a string");
        }
        payload.asset = asset;
    }

    if ("version" in body) {
        if (typeof body.version != "string") {
            throw new utils.HttpError("expected 'version' property to be a string");
        }
        payload.version = version;
    }

    let payload_str = JSON.stringify(payload);
    let signature = await sign(payload_str);
    return utils.jsonResponse("gypsum." + btoa(payload_str) + "." + signature, 200);
}

export async function extractTokenScope(token) {
    let i = token.lastIndexOf(".");
    if (!token.startsWith("gypsum.") || i < 0) {
        throw new utils.HttpError("invalid probational token", 401);
    }

    let payload_str = atob(token.slice(7, i));
    let signature = token.slice(i + 1);
    let expected = sign(payload_str);
    if (signature != expected) {
        throw new utils.HttpError("probational token signature does not match", 403);
    }

    return JSON.parse(payload_str);
}

export async function approveProbationHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    let token = auth.extractBearerToken(request);
    await auth.checkProjectManagementPermissions(project, token, nonblockers);

    let bound_bucket = s3.getR2Binding();
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, version, session_key);

    try {
        let sumpath = pkeys.versionSummary(project, asset, version);
        let raw_info = await bound_bucket.get(sumpath);
        if (raw_info == null) {
            throw new utils.HttpError("probational version does not exist", 400);
        }

        let info = JSON.parse(raw_info);
        if (!("on_probation" in info) || !info.on_probation) {
            throw new utils.HttpError("cannot approve probation for non-probational version", 400);
        }
        delete info.on_probation;

        let summary_update = utils.quickUploadJson(sumpath, info);
        if ((await summary_update) == null) {
            throw new utils.HttpError("failed to update version summary", 500);
        }
    } finally {
        await bound_bucket.delete(pkeys.lock(project, asset));
    }

    return new Response(null, { status: 200 });
}

export async function rejectProbationHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    let token = auth.extractBearerToken(request);
    await auth.checkProjectManagementPermissions(project, token, nonblockers);

    let bound_bucket = s3.getR2Binding();
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, version, session_key);

    try {
        let sumpath = pkeys.versionSummary(project, asset, version);
        let raw_info = await bound_bucket.get(sumpath);
        if (raw_info == null) {
            throw new utils.HttpError("probational version does not exist", 400);
        }

        let info = JSON.parse(raw_info);
        if (!("on_probation" in info) || !info.on_probation) {
            throw new utils.HttpError("cannot reject probation for non-probational version", 400);
        }

        await utils.quickRecursiveDelete(project + "/" + asset + "/" + version + "/");
    } finally {
        await bound_bucket.delete(pkeys.lock(project, asset));
    }

    return new Response(null, { status: 200 });
}
