import { Router } from 'itty-router'

import * as upload from "./upload.js";
import * as create from "./create.js";
import * as remove from "./remove.js";
import * as permissions from "./permissions.js";
import * as quota from "./quota.js";
import * as probation from "./probation.js";
import * as version from "./version.js";
import * as change from "./changelog.js";
import * as gh from "./utils/github.js";
import * as auth from "./utils/permissions.js";
import * as http from "./utils/http.js";
import * as s3 from "./utils/s3.js";

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

router.put("/quota/:project", quota.setQuotaHandler);

router.get("/credentials/s3-api", permissions.fetchS3Credentials);

router.get("/credentials/github-app", permissions.fetchGitHubCredentials);

/*** Probation ***/

router.post("/probation/approve/:project/:asset/:version", probation.approveProbationHandler);

router.post("/probation/reject/:project/:asset/:version", probation.rejectProbationHandler);

/*** Refresh ***/

router.post("/refresh/latest/:project/:asset", version.refreshLatestVersionHandler);

router.post("/refresh/usage/:project", quota.refreshQuotaUsageHandler);

/*** Setting up the listener ***/

router.get("/", () => {
    return new Response(null, { headers: { "Location": "https://artifactdb.github.io/gypsum-worker" }, status: 301 })
})

router.all('*', request => { 
    const u = request.url;
    const pattern = /([^:])(\/\/+)/g;
    if (u.match(pattern)) {
        return new Response(null, { headers: { "Location": u.replace(pattern, "$1/") }, status: 301 })
    }
    return http.errorResponse("no such endpoint", 404);
})

export default {

fetch(request, env, context) {
    // Handle CORS preflight requests.
    if (request.method === 'OPTIONS') {
        return handleOptions(request);
    }

    let nonblockers = [];
    let resp = router
        .handle(request, env, nonblockers)
        .catch(error => {
            if (error instanceof http.HttpError) {
                return http.errorResponse(error.message, error.statusCode);
            } else {
                return http.errorResponse(error.message, 500);
            }
        });

    // Non-blockers are strictly used for local caching only.
    context.waitUntil(resp.then(x => Promise.all(nonblockers)));
    return resp;
},

scheduled(event, env, context) {
    context.waitUntil(change.flushOldChangelogsHandler(event, env));
},

}
