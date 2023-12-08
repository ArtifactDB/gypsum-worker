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

export function splitPath(x) {
    let i = x.lastIndexOf("/");
    if (i < 0) {
        return ["", x];
    } else {
        return [x.slice(0, i), x.slice(i + 1)];
    }
}
