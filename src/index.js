import { Router } from 'itty-router'
import S3 from 'aws-sdk/clients/s3.js';

import * as gh from "./github.js";
import * as files from "./files.js";
import * as project from "./project.js";
import * as auth from "./auth.js";
import * as upload from "./upload.js";
import * as utils from "./utils.js";

const router = Router();

const globals = {
    gh_master_token: GITHUB_PAT,
    r2_bucket_name: "gypsum-test",
    s3_binding: new S3({
        endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
        accessKeyId: `${ACCESS_KEY_ID}`,
        secretAccessKey: `${SECRET_ACCESS_KEY}`,
        signatureVersion: 'v4',
    })
};

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

router.get("/files/:id/metadata", (request, bucket, nonblockers) => files.getFileMetadataHandler(request, bucket, globals, nonblockers));

router.get("/files/:id", (request, bucket, nonblockers) => files.getFileHandler(request, bucket, globals, nonblockers));

router.post("/projects/:project/version/:version/upload", (request, bucket, nonblockers) => upload.initializeUploadHandler(request, bucket, globals, nonblockers));

router.put("/link/:source/to/:target", (request, bucket, nonblockers) => upload.createLinkHandler(request, bucket, globals, nonblockers));

router.put("/projects/:project/version/:version/complete", (request, bucket, nonblockers) => upload.completeUploadHandler(request, bucket, globals, nonblockers));

router.get("/jobs/:jobid", (request, bucket, nonblockers) => upload.queryJobIdHandler(request, bucket, globals, nonblockers));

router.get("/projects", (request, bucket, nonblockers) => project.listProjectsHandler(request, bucket, globals, nonblockers));

router.get("/projects/:project/metadata", (request, bucket, nonblockers) => project.getProjectMetadataHandler(request, bucket, globals, nonblockers));

router.get("/projects/:project/version/:version/metadata", (request, bucket, nonblockers) => project.getProjectVersionMetadataHandler(request, bucket, globals, nonblockers));

router.get("/projects/:project/version/:version/info", (request, bucket, nonblockers) => project.getProjectVersionInfoHandler(request, bucket, globals, nonblockers));

router.get("/projects/:project/versions", (request, bucket, nonblockers) => project.listProjectVersionsHandler(request, bucket, globals, nonblockers));

router.get("/projects/:project/permissions", (request, bucket, nonblockers) => auth.getPermissionsHandler(request, bucket, globals, nonblockers));

router.put("/projects/:project/permissions", (request, bucket, nonblockers) => auth.setPermissionsHandler(request, bucket, globals, nonblockers));

/*** Non-standard endpoints, for testing only ***/

router.get("/user", (request, bucket, nonblockers) => auth.findUserHandler(request, bucket, globals, nonblockers));

/*** Setting up the listener ***/

addEventListener('fetch', event => {
    let request = event.request;

    if (request.method === 'OPTIONS') {
        // Handle CORS preflight requests
        event.respondWith(handleOptions(request));
        return;
    }

    let nonblockers = [];
    let resp = router
        .handle(request, GYPSUM_BUCKET, nonblockers)
        .catch(error => {
            if (error instanceof utils.HttpError) {
                return utils.errorResponse(error.message, error.statusCode);
            } else {
                return utils.errorResponse(error.message, 500);
            }
        });

    // Need to make sure 'nonblockers' is filled before returning.
    // This requires the handler to run to completion, hence the 'then'.
    event.waitUntil(resp.then(x => Promise.all(nonblockers)));

    event.respondWith(resp);
});
