import { Router } from 'itty-router'
const router = Router()

/*** CORS-related shenanigans ***/

function handleOptions(request) {
    let headers = request.headers;
    if (headers.get('Origin') !== null &&
        headers.get('Access-Control-Request-Method') !== null &&
        headers.get('Access-Control-Request-Headers') !== null) 
    {
        // Handle CORS pre-flight request.
        let respHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
            'Access-Control-Max-Age': '86400',
            'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers'),
        };
        return new Response(null, { headers: respHeaders });
    } else {
        // Handle standard OPTIONS request.
        return new Response(null, {
            headers: {
                Allow: 'GET, HEAD, POST, OPTIONS',
            },
        });
    }
}

/*** Miscellaneous functions ***/

function unpackId(id) {
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

function errorResponse(reason, code) {
    return new Response(
        JSON.stringify({ 
            "status": "error", 
            "reason": reason
        }),
        { 
            status: code, 
            headers: {
                "Content-Type": "application/json"
            }
        }
    );
}

async function forwarder(project, path, version) {
    let r2path = project + "/" + version + "/" + path;
    let res = await GYPSUM_BUCKET.get(r2path);
    if (res === null) {
        return errorResponse("key '" + id + "' does not exist", 404);
    }

    let { readable, writable } = new TransformStream();
    res.body.pipeTo(writable);
    return new Response(readable, res);
}

/*** Setting up the routes ***/

router.get("/files/:id/metadata", async ({params}) => {
    let id = decodeURIComponent(params.id);

    let unpacked;
    try {
        unpacked = unpackId(id);
    } catch (e) {
        return errorResponse(e.message, 400);
    }

    if (!unpacked.path.endsWith(".json")) {
        unpacked.path += ".json";
    }
    return forwarder(unpacked.project, unpacked.path, unpacked.version);
})

router.get("/files/:id", async({params}) => {
    let id = decodeURIComponent(params.id);
    let unpacked;
    try {
        unpacked = unpackId(id);
    } catch (e) {
        return errorResponse(e.message, 400);
    }
    return forwarder(unpacked.project, unpacked.path, unpacked.version);
})

/*** Setting up the listener ***/

addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
        // Handle CORS preflight requests
        event.respondWith(handleOptions(request));
    } else {
        event.respondWith(
            router
                .handle(request)
                .catch(error => new Response(error.message || 'Server Error', { status: error.status || 500 }))
        )
    }
})
