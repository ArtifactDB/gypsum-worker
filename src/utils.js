import * as s3 from "./s3.js";

export class HttpError extends Error {
    constructor(message, code) {
        super(message);
        this.statusCode = code;
    }
}

export function packId(project, path, version) {
    return project + ":" + path + "@" + version;
}

export function unpackId(id) {
    let i1 = id.indexOf(":");
    if (i1 < 0) {
        throw new HttpError("could not identify project from 'id'", 400);
    } else if (i1 == 0) {
        throw new HttpError("'id' should not have an empty project", 400);
    }

    let i2 = id.lastIndexOf("@");
    if (i2 < 0) {
        throw new HttpError("could not identify version from 'id'", 400);
    } else if (i2 == id.length - 1) {
        throw new HttpError("'id' should not have an empty version", 400);
    }

    if (i2 < i1) {
        throw new HttpError("could not identify path from 'id'", 400);
    } else if (i1 +1 == i2){
        throw new HttpError("'id' should not have an empty path", 400);
    }

    return {
        project: id.slice(0, i1),
        path: id.slice(i1+1, i2),
        version: id.slice(i2+1)
    };
}

export function jsonResponse(x, code, headers={}) {
    return new Response(JSON.stringify(x), { "status": code, "headers": { ...headers, "Content-Type": "application/json" } });
}

export function errorResponse(reason, code, headers={}) {
    return jsonResponse({ "status": "error", "reason": reason }, code, headers);
}

export function minutesFromNow(n) {
    return (new Date(Date.now() + n * 60000)).toUTCString();
}

export function hoursFromNow(n) {
    return (new Date(Date.now() + n * 3600000)).toUTCString();
}

export function quickCacheJsonText(cache, key, value, expires) {
    let headers = {
        "Content-Type": "application/json",
        "Expires": expires
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
