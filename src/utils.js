export function unpackId(id) {
    let i1 = id.indexOf(":");
    if (i1 < 0) {
        throw new Error("could not identify project from 'id'");
    } else if (i1 == 0) {
        throw new Error("'id' should not have an empty project");
    }

    let i2 = id.lastIndexOf("@");
    if (i2 < 0) {
        throw new Error("could not identify version from 'id'");
    } else if (i2 == id.length - 1) {
        throw new Error("'id' should not have an empty version");
    }

    if (i2 < i1) {
        throw new Error("could not identify version from 'id'");
    } else if (i1 +1 == i2){
        throw new Error("'id' should not have an empty path");
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
    return (new Date(Date.now() + n * 60000)).toISOString();
}

export function hoursFromNow(n) {
    return (new Date(Date.now() + n * 3600000)).toISOString();
}
