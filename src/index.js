import { Router } from 'itty-router'

import * as gh from "./github.js";
import * as files from "./files.js";
import * as project from "./project.js";
import * as auth from "./auth.js";
import * as upload from "./upload.js";
import * as utils from "./utils.js";
import * as s3 from "./s3.js";

if (typeof GITHUB_PAT !== "undefined") {
    gh.setToken(GITHUB_PAT);
} else {
    console.warn("missing the GITHUB_PAT secret");
}

if (ADMIN_ACCOUNTS !== "") {
    auth.setAdmins(ADMIN_ACCOUNTS.split(","));
}
if (ALLOWED_UPLOADERS !== "") {
    auth.setUploaders(ALLOWED_UPLOADERS.split(","));
}

gh.setRepository(GITHUB_CI_REPOSITORY);
gh.setUserAgent(GITHUB_USER_AGENT);
s3.setBucketName(R2_BUCKET_NAME);

if (typeof ACCESS_KEY_ID !== "undefined" && typeof SECRET_ACCESS_KEY != "undefined") {
    s3.setS3Object(CF_ACCOUNT_ID, ACCESS_KEY_ID, SECRET_ACCESS_KEY);
} else {
    console.warn("missing the ACCESS_KEY_ID or SECRET_ACCESS_KEY secrets");
}

s3.setR2Binding(BOUND_BUCKET);

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

router.get("/files/:id/metadata", files.getFileMetadataHandler);

router.get("/files/:id", files.getFileHandler);

router.post("/projects/:project/version/:version/upload", upload.initializeUploadHandler);

router.put("/link/:source/to/:target", upload.createLinkHandler);

router.put("/projects/:project/version/:version/complete", upload.completeUploadHandler);

router.put("/projects/:project/version/:version/abort", upload.abortUploadHandler);

router.get("/jobs/:jobid", upload.queryJobIdHandler);

router.get("/projects", project.listProjectsHandler);

router.get("/projects/:project/metadata", project.getProjectMetadataHandler);

router.get("/projects/:project/version/:version/metadata", project.getProjectVersionMetadataHandler);

router.get("/projects/:project/version/:version/info", project.getProjectVersionInfoHandler);

router.get("/projects/:project/versions", project.listProjectVersionsHandler);

router.get("/projects/:project/permissions", auth.getPermissionsHandler);

router.put("/projects/:project/permissions", auth.setPermissionsHandler);

/*** Non-standard endpoints, for testing and other things***/

router.get("/custom/user", auth.findUserHandler);

router.put("/custom/upload-secret", auth.setUploadOverrideHandler);

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
