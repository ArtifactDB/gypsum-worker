import * as http from "./utils/http.js";
import * as s3 from "./utils/s3.js";

export function downloadHandler(request, env, nonblockers) {
    const payload = await env.BOUND_BUCKET.get(request.params.key);
    if (payload === null) {
        throw new http.HttpError("object not found", 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Last-Modified', object.uploaded.toUTCString());
    return new Response(object.body, { headers });
}

export function listHandler(request, env, nonblockers) {
    const params = request.query;
    let prefix = null;
    if ("prefix" in params) {
        path = params.prefix;
    }
    let recursive = false;
    if ("recursive" in params) {
        recursive = params.recursive == "true";
    }
    let collected = [];
    await s3.listApply(prefix, x => collected.push(x), env, { trimPrefix: false, local: !recursive });
    return new http.jsonResponse(collected, 200);
}
