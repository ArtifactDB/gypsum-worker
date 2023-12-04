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
let missed_secrets = [];

let missed_key = (typeof ACCESS_KEY_ID == "undefined");
let missed_secret = (typeof SECRET_ACCESS_KEY == "undefined");
if (!missed_key && !missed_secret) {
    s3.setS3Object(CF_ACCOUNT_ID, ACCESS_KEY_ID, SECRET_ACCESS_KEY);
} else {
    if (missed_key) {
        missed_secrets.push("ACCESS_KEY_ID");
    }
    if (missed_secret) {
        missed_secrets.push("SECRET_ACCESS_KEY");
    }
}

let missed_public_key = (typeof PUBLIC_S3_KEY == "undefined");
let missed_public_secret = (typeof PUBLIC_S3_SECRET == "undefined");
if (!missed_public_key && !missed_public_secret) {
    s3.setPublicS3Credentials(CF_ACCOUNT_ID, R2_BUCKET_NAME, PUBLIC_S3_KEY, PUBLIC_S3_SECRET);
} else {
    if (missed_public_key) {
        missed_secrets.push("PUBLIC_S3_KEY");
    } 
    if (missed_public_secret) {
        missed_secrets.push("PUBLIC_S3_SECRET");
    }
}

let missed_github_key = (typeof GITHUB_APP_ID == "undefined");
let missed_github_secret = (typeof GITHUB_APP_SECRET == "undefined");
if (!missed_github_key && !missed_github_secret) {
    gh.setGitHubAppCredentials(GITHUB_APP_ID, GITHUB_APP_SECRET);
} else {
    if (missed_github_key) {
        missed_secrets.push("GITHUB_APP_ID");
    }
    if (missed_github_secret) {
        missed_secrets.push("GITHUB_APP_SECRET");
    }
}

if (missed_secrets.length) {
    console.warn("missing the following secrets: " + missed_secrets.join(", "))
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

router.post("/upload/complete/:project/:asset/:version", upload.completeUploadHandler);

router.post("/upload/abort/:project/:asset/:version", upload.abortUploadHandler);

/*** Permission handling ***/

router.put("/permissions/:project", permissions.setPermissionsHandler);

router.get("/credentials/s3-api", permissions.fetchS3Credentials);

router.get("/credentials/github-app", permissions.fetchGitHubCredentials);

/*** Probation ***/

router.post("/probation/approve/:project/:asset/:version", probation.approveProbationHandler);

router.post("/probation/reject/:project/:asset/:version", probation.rejectProbationHandler);

/*** Setting up the listener ***/

router.get("/", () => {
    return new Response(null, { headers: { "Location": "https://artifactdb.github.io/gypsum-worker" }, status: 301 })
})

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
