import * as s3 from "./s3.js";

export class HttpError extends Error {
    constructor(message, code) {
        super(message);
        this.statusCode = code;
    }
}

export function jsonResponse(x, code, headers={}) {
    return new Response(JSON.stringify(x), { "status": code, "headers": { ...headers, "Content-Type": "application/json" } });
}

export function errorResponse(reason, code, headers={}) {
    return jsonResponse({ "status": "error", "reason": reason }, code, headers);
}

export async function bodyToJson(req) {
    try {
        return await req.json();
    } catch (e) {
        throw new HttpError("failed to parse JSON body; " + String(e), 400);
    }
}

export function quickCacheJsonText(cache, key, value, expires) {
    let headers = {
        "Cache-Control": "max-age=" + String(expires),
        "Content-Type": "application/json"
    };
    return cache.put(key, new Response(value, { headers: headers }));
}

export function quickCacheJson(cache, key, value, expires) {
    return quickCacheJsonText(cache, key, JSON.stringify(value), expires);
}

export function quickUploadJson(path, value, custom = null) {
    let meta = {
        httpMetadata: { contentType: "application/json" }
    };

    if (custom !== null) {
        meta.customMetadata = custom;
    }

    let bound_bucket = s3.getR2Binding();
    return bound_bucket.put(path, JSON.stringify(value), meta);
}

export async function namedResolve(x) {
    let entries = Object.entries(x);
    let promises = entries.map(y => y[1]);
    let resolved = await Promise.all(promises);

    let output = {};
    for (var i = 0; i < entries.length; i++) {
        output[entries[i][0]] = resolved[i];
    }

    return output;
}

export async function listApply(prefix, op, list_limit = 1000) {
    let bound_bucket = s3.getR2Binding();
    let list_options = { prefix: prefix, limit: list_limit };
    let truncated = true;

    while (true) {
        let listing = await bound_bucket.list(list_options);
        listing.objects.forEach(op);
        truncated = listing.truncated;
        if (truncated) {
            list_options.cursor = listing.cursor;
        } else {
            break;
        }
    }
}

export async function quickRecursiveDelete(prefix, list_limit = 1000) {
    let bound_bucket = s3.getR2Binding();
    let deletions = [];
    await listApply(prefix, f => { deletions.push(bound_bucket.delete(f.key)); }, /* list_limit = */ list_limit);
    await Promise.all(deletions);
}
