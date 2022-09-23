import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as gh from "./github.js";

export async function initializeUploadHandler(request, bucket, s3obj) {
    let id = request.params.id;
    let version = request.params.version;

    let id_err = await auth.isAllowedUploader(request);
    if (id_err !== null) {
        return id_err;
    }

    let body = await request.json();
    let files = body.filenames;

    let precollected = [];
    let prenames = []
    for (const f of files) {
        if (typeof f == "string") {
            let params = { Bucket: bucket, Key: id + "/" + version + "/" + f, Expires: 3600 };
            if (f.endsWith(".json")) {
                params.ContentType = "application/json";
            }
            precollected.push(s3obj.getSignedUrlPromise('putObject', params));
            prenames.push(f);
        } else {
            return utils.errorResponse("non-string file uploads are not yet supported", 400);
        }
    }

    let presigned_vec = await Promise.all(precollected);
    let presigned = {};
    for (var i = 0; i < presigned_vec.length; i++) {
        presigned[prenames[i]] = presigned_vec[i];
    }

    let completer = "/projects/" + id + "/version/" + version + "/complete";
    return utils.jsonResponse({ presigned_urls: presigned, completion_url: completer }, 200);
}

export async function completeUploadHandler(request, master) {
    let id = request.params.id;
    let version = request.params.version;

    let id_err = await auth.isAllowedUploader(request);
    console.log(id_err);
    if (id_err !== null) {
        return id_err;
    }

    // Permissions are handled by the indexer.
    let perms = await request.json();

    let payload;
    try {
        let info = await gh.postNewIssue(
            "upload complete",
            JSON.stringify({ 
                id: id,
                version: version,
                timestamp: Date.now(),
                permissions: perms
            }),
            master
        );
        payload = await info.json();
    } catch (e) {
        return utils.errorResponse(e.message, 500);
    }

    console.log(payload.number);
    return utils.jsonResponse({ job_id: payload.number }, 202);
}

export async function queryJobIdHandler(request, master) {
    let jid = request.params.jobid;

    let payload;
    try {
        let info = await gh.getIssue(jid, master);
        payload = await info.json();
    } catch (e) {
        return utils.errorResponse(e.message, 404);
    }

    let state = "PENDING";
    if (payload.state == "closed") {
        state = "SUCCESS";
    } else if (payload.comments > 0) {
        state = "FAILURE"; // any comments indicates failure, otherwise it would just be closed.
    }

    return utils.jsonResponse({ 
        status: state,
        job_url: gh.createIssueUrl(jid)
    }, 200);
}
