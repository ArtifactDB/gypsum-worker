import { Router } from 'itty-router'
import S3 from 'aws-sdk/clients/s3.js';

const s3 = new S3({
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  accessKeyId: `${ACCESS_KEY_ID}`,
  secretAccessKey: `${SECRET_ACCESS_KEY}`,
  signatureVersion: 'v4',
});

const bucket_name = "gypsum-test";
const router = Router()

const github_api = "https://api.github.com";
const github_repo = "ArtifactDB/gypsum-actions";
const github_agent = "gypsum-test-worker";

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

async function forwarder(project, path, version, content_type) {
    let r2path = project + "/" + version + "/" + path;
    let res = await GYPSUM_BUCKET.get(r2path);
    if (res === null) {
        return errorResponse("key '" + id + "' does not exist", 404);
    }

    let { readable, writable } = new TransformStream();
    res.body.pipeTo(writable);

    let output = new Response(readable, res);
    output.headers.set("Content-Type", content_type);
    return output;
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
    return forwarder(unpacked.project, unpacked.path, unpacked.version, "application/json");
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

router.post("/projects/:id/version/:version/upload", async request => {
    let id = request.params.id;
    let version = request.params.version;

    let body = await request.json();
    let files = body.filenames;

    let precollected = [];
    let prenames = []
    for (const f of files) {
        if (typeof f == "string") {
            let params = { Bucket: bucket_name, Key: id + "/" + version + "/" + f, Expires: 3600 };
            if (f.endsWith(".json")) {
                params.ContentType = "application/json";
            }
            precollected.push(s3.getSignedUrlPromise('putObject', params));
            prenames.push(f);
        } else {
            return errorResponse("non-string file uploads are not yet supported", 400);
        }
    }

    let presigned_vec = await Promise.all(precollected);
    let presigned = {};
    for (var i = 0; i < presigned_vec.length; i++) {
        presigned[prenames[i]] = presigned_vec[i];
    }

    return new Response(
        JSON.stringify({ 
            presigned_urls: presigned,
            completion_url: "/projects/" + id + "/version/" + version + "/complete"
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "application/json"
            }
        }
    );
})

router.put("/projects/:id/version/:version/complete", async request => {
    let id = request.params.id;
    let version = request.params.version;

    // Permissions are handled by the indexer.
    let perms = await request.json();

    let URL = github_api + "/repos/" + github_repo + "/issues";

    let res = await fetch(URL, {
        method: "POST",
        headers: {
            'Content-Type': 'application/json',
            "Authorization": "Bearer " + GITHUB_PAT,
            "User-Agent": github_agent
        },
        body: JSON.stringify({
            title: "upload complete",
            body: JSON.stringify({ 
                id: id,
                version: version,
                timestamp: Date.now(),
                permissions: perms
            })
        })
    });
    if (!res.ok) {
        return new errorReponse("failed to trigger GitHub Actions for indexing", { status: 500 });
    }

    let payload = await res.json();
    return new Reponse({ job_id: payload.id }, { status: 204 });
})

router.get("/jobs/:jobid", async ({params}) => {
    let jid = params.jobid;
    let URL = github_api + "/repos/" + github_repo + "/issues/" + jid;

    let res = await fetch(URL, {
        headers: {
            "Authorization": "Bearer " + GITHUB_PAT,
            "User-Agent": github_agent
        }
    });
    if (!res.ok) {
        return errorResponse("failed to query GitHub for indexing status", 404);
    }

    let info = await res.json();
    let state = "PENDING";
    if (info.state == "closed") {
        state = "SUCCESS";
    } else if (info.comments > 0) {
        state = "FAILURE"; // any comments indicates failure, otherwise it would just be closed.
    }

    return new Response(
        JSON.stringify({ status: state }),
        {
            status: 200,
            headers: { "Content-Type": "application/json" }
        }
    );
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
