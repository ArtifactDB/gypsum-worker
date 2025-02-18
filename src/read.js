import * as http from "./utils/http.js";
import * as s3 from "./utils/s3.js";

function createHeaders(payload) {
    const headers = new Headers();
    payload.writeHttpMetadata(headers);
    headers.set('etag', payload.httpEtag);
    headers.set('Last-Modified', payload.uploaded.toUTCString());
    headers.set("Content-Length", payload.size);
    headers.set("Access-Control-Allow-Origin", "*");
    return headers;
}

export async function headFileHandler(request, env, nonblockers) {
    const payload = await env.BOUND_BUCKET.head(decodeURIComponent(request.params.key));
    if (payload === null) {
        throw new http.HttpError("object not found", 404);
    }
    const headers = createHeaders(payload);
    return new Response(null, { headers });
}

export async function downloadFileHandler(request, env, nonblockers) {
    const payload = await env.BOUND_BUCKET.get(decodeURIComponent(request.params.key));
    if (payload === null) {
        throw new http.HttpError("object not found", 404);
    }
    const headers = createHeaders(payload);
    return new Response(payload.body, { headers });
}

export async function listFilesHandler(request, env, nonblockers) {
    const params = request.query;
    let prefix = null;
    if ("prefix" in params) {
        prefix = decodeURIComponent(params.prefix);
    }
    let recursive = false;
    if ("recursive" in params) {
        recursive = params.recursive == "true";
    }
    let collected = [];
    await s3.listApply(prefix, x => collected.push(x), env, { trimPrefix: false, stripTrailingSlash: false, local: !recursive });
    return new http.jsonResponse(collected, 200, { "Access-Control-Allow-Origin": "*" });
}
