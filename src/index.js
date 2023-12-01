import { Router } from 'itty-router'

import * as gh from "./github.js";
import * as auth from "./auth.js";
import * as upload from "./upload.js";
import * as create from "./create.js";
import * as remove from "./remove.js";
import * as permissions from "./permissions.js";
import * as probation from "./probation.js";
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

/*** Setting up admin routes ***/

router.post("/create/:project", create.createProjectHandler);

router.delete("/remove/:project", remove.removeProjectHandler);

router.delete("/remove/:project/:asset", remove.removeProjectAssetHandler);

router.delete("/remove/:project/:asset/:version", remove.removeProjectAssetVersionHandler);

/*** Project upload ***/

router.post("/upload/start/:project/:asset/:version", upload.initializeUploadHandler);

router.post("/upload/presigned-file/:slug", upload.uploadPresignedFileHandler);

router.put("/upload/complete/:project/:asset/:version", upload.completeUploadHandler);

router.put("/upload/abort/:project/:asset/:version", upload.abortUploadHandler);

/*** Permission handling ***/

router.put("/permissions/:project", permissions.setPermissionsHandler);

/*** Probation ***/

router.post("/probation/request-token/:project", probation.requestTokenHandler);

router.post("/probation/approve/:project", probation.approveProbationHandler);

router.post("/probation/reject/:project", probation.rejectProbationHandler);

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
