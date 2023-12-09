export function isJsonObject(x) {
    return (typeof x == "object") && !(x instanceof Array) && (x !== null)
}

export function isInternalPath(x) {
    return x.startsWith("..") || x.indexOf("/..") >= 0;
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

export async function hashToken(token) {
    // This creates a hash of a token for storage at rest. Upon seeing a new
    // token, we hash it and compare it to the stored one to determine whether
    // they match. We need to hash the token as the stored one could be public,
    // either from a cache leak or because the R2 bucket is generally public.
    // It is expected that tokens are machine-generated and have high enough
    // entropy that we don't need salting or iterations, see commentary at:
    // https://security.stackexchange.com/questions/151257/what-kind-of-hashing-to-use-for-storing-rest-api-tokens-in-the-database
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    let digest = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)));
}
