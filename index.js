import { Router } from 'itty-router'
import S3 from 'aws-sdk/clients/s3.js';

import * as gh from "./src/github.js";
import * as files from "./src/files.js";
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

router.get("/files/:id/metadata", request => files.getFileMetadataHandler(request, GITHUB_PAT));

router.get("/files/:id", request => files.getFileHandler(request, bucket_name, s3, GITHUB_PAT));

router.post("/projects/:project/version/:version/upload", request => upload.initializeUploadHandler(request, bucket_name, s3, GITHUB_PAT));

router.put("/projects/:project/version/:version/complete", request => upload.completeUploadHandler(request, GITHUB_PAT));

router.get("/jobs/:jobid", request => upload.queryJobIdHandler(request, GITHUB_PAT));

router.get("/projects/:project/permissions", request => auth.getPermissionsHandler(request, GITHUB_PAT));

router.post("/projects/:project/permissions", (request, event) => auth.setPermissionsHandler(request, GITHUB_PAT, event));

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
