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

async function forwarder(id) {
    let res = await GYPSUM_BUCKET.get(id);
    if (res === null) {
        return new Response(
            JSON.stringify({ "error": "key '" + id + "' does not exist"}), 
            { 
                status: 404, 
                headers: { 
                    "Content-Type": "application/json"
                }
            }
        );
    }

    let { readable, writable } = new TransformStream();
    res.body.pipeTo(writable);
    return new Response(readable, res);
}

/*** Setting up the routes ***/

router.get("/files/:id/metadata", async ({params}) => {
    let id = decodeURIComponent(params.id);
    if (!id.endsWith(".json")) {
        id += ".json";
    }
    return forwarder(id);
})

router.get("/files/:id", async({params}) => {
    let id = decodeURIComponent(params.id);
    return forwarder(id);
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
