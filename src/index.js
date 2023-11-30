import { Router } from 'itty-router'

import * as gh from "./github.js";
import * as auth from "./auth.js";
import * as upload from "./upload.js";
import * as manage from "./manage.js";
import * as utils from "./utils.js";
import * as s3 from "./s3.js";

// Variables in the wrangler.toml.
if (ADMIN_ACCOUNTS !== "") {
    auth.setAdmins(ADMIN_ACCOUNTS.split(","));
}
gh.setUserAgent(GITHUB_USER_AGENT);
s3.setBucketName(R2_BUCKET_NAME);

s3.setR2Binding(BOUND_BUCKET);

// Secret variables.
if (typeof ACCESS_KEY_ID !== "undefined" && typeof SECRET_ACCESS_KEY != "undefined") {
    s3.setS3Object(CF_ACCOUNT_ID, ACCESS_KEY_ID, SECRET_ACCESS_KEY);
} else {
    console.warn("missing the ACCESS_KEY_ID or SECRET_ACCESS_KEY secrets");
}
if (typeof ENCRYPT_SECRET !== "undefined") {
    auth.setGlobalEncryptKey(ENCRYPT_SECRET);
} else {
    console.warn("missing the ENCRYPT_SECRET secret");
}

const router = Router();

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

router.post("/project/:project/create", manage.createProjectHandler);

router.delete("/project/:project/delete", manage.deleteProjectHandler);

router.delete("/project/:project/asset/:asset/delete", manage.deleteProjectAssetHandler);

router.delete("/project/:project/asset/:asset/version/:version/delete", manage.deleteProjectAssetVersionHandler);

router.post("/project/:project/asset/:asset/version/:version/upload/start", upload.initializeUploadHandler);

router.post("/project/:project/asset/:asset/version/:version/upload/presigned-file/:parameters", upload.uploadPresignedFileHandler);

router.put("/project/:project/asset/:asset/version/:version/upload/complete", upload.completeUploadHandler);

router.put("/project/:project/asset/:asset/version/:version/upload/abort", upload.abortUploadHandler);

router.put("/project/:project/permissions", manage.setPermissionsHandler);

router.post("/project/:project/probation/request-token", probation.requestTokenHandler);

router.post("/project/:project/probation/approve", probation.approveProbationHandler);

router.post("/project/:project/probation/reject", probation.rejectProbationHandler);

/*** Non-standard endpoints, for testing and other things ***/

router.get("/custom/user", auth.findUserHandler);

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
        .handle(request, nonblockers)
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
