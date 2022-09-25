import { Router } from 'itty-router'
import S3 from 'aws-sdk/clients/s3.js';

import * as gh from "./src/github.js";
import * as auth from "./src/auth.js";
import * as upload from "./src/upload.js";
import * as utils from "./src/utils.js";

const s3 = new S3({
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  accessKeyId: `${ACCESS_KEY_ID}`,
  secretAccessKey: `${SECRET_ACCESS_KEY}`,
  signatureVersion: 'v4',
});

const bucket_name = "gypsum-test";
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

    let r2path = project + "/" + version + "/" + path;
    let res = await GYPSUM_BUCKET.get(r2path);
    if (res === null) {
        return errorResponse("key '" + id + "' does not exist", 404);
    }

    let { readable, writable } = new TransformStream();
    res.body.pipeTo(writable);

    let output = new Response(readable, res);
    output.headers.set("Content-Type", "application/json");
    return output;
})

router.get("/files/:id", async({params, query}) => {
    let id = decodeURIComponent(params.id);
    let unpacked;
    try {
        unpacked = unpackId(id);
    } catch (e) {
        return errorResponse(e.message, 400);
    }

    let expiry = query.expires_in;
    if (typeof expiry !== "number") {
        expiry = 120;
    }

    let key = unpacked.project + "/" + unpacked.version + "/" + unpacked.path;
    let target = await s3.getSignedUrlPromise('getObject', { Bucket: bucket_name, Key: key, Expires: expiry })
    return Response.redirect(target, 302);
})

router.post("/projects/:id/version/:version/upload", request => upload.initializeUploadHandler(request, bucket_name, s3, GITHUB_PAT));

router.put("/projects/:id/version/:version/complete", request => upload.completeUploadHandler(request, GITHUB_PAT));

router.get("/jobs/:jobid", request => upload.queryJobIdHandler(request, GITHUB_PAT));

router.get("/projects/:id/permissions", request => auth.getPermissionsHandler(request, GITHUB_PAT));

router.post("/projects/:id/permissions", (request, event) => auth.setPermissionsHandler(request, GITHUB_PAT, event));

/*** Non-standard endpoints, for testing only ***/

router.get("/user", request => auth.findUserHandler(request, GITHUB_PAT));

/*** Setting up the listener ***/

addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
        // Handle CORS preflight requests
        event.respondWith(handleOptions(request));
    } else {
        let resp = router
            .handle(request, event)
            .catch(error => utils.jsonResponse(error.message || 'Server Error', error.status || 500));
        event.respondWith(resp);
    }
})
