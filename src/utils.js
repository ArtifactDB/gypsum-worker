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

export function isJsonObject(x) {
    return (typeof x == "object") && !(x instanceof Array) && (x !== null)
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

export async function listApply(prefix, op, { namesOnly = true, trimPrefix = true, local = false, list_limit = 1000 } = {}) {
    let list_options = { limit: list_limit };
    if (prefix != null) {
        list_options.prefix = prefix;
    } else {
        trimPrefix = false; // nothing to trim.
    }
    if (local) {
        list_options.delimiter = "/";
    }

    let bound_bucket = s3.getR2Binding();
    let truncated = true;
    while (true) {
        let listing = await bound_bucket.list(list_options);

        if (local) {
            if (trimPrefix) {
                listing.delimitedPrefixes.forEach(p => op(p.slice(prefix.length, p.length - 1))); // remove the prefix and the slash.
            } else {
                listing.delimitedPrefixes.forEach(p => op(p.slice(0, p.length - 1))); // remove the trailing slash.
            }
        } 

        if (namesOnly || local) {
            if (trimPrefix) {
                listing.objects.forEach(f => op(f.key.slice(prefix.length)));
            } else {
                listing.objects.forEach(f => op(f.key));
            }
        } else {
            listing.objects.forEach(op);
        }

        truncated = listing.truncated;
        if (truncated) {
            list_options.cursor = listing.cursor;
        } else {
            break;
        }
    }
}

export async function quickRecursiveDelete(prefix, { list_limit = 1000 } = {}) {
    let bound_bucket = s3.getR2Binding();
    let deletions = [];
    await listApply(
        prefix, 
        fname => deletions.push(bound_bucket.delete(fname), { trimPrefix: false }), 
        { list_limit: list_limit, trimPrefix: false }
    );
    await Promise.all(deletions);
}
