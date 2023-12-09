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
        throw new HttpError("failed to parse JSON body; " + e.message, 400);
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
