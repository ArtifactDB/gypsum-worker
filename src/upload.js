import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as gh from "./github.js";
import * as lock from "./lock.js";
import * as expiry from "./expiry.js";

/**************** Initialize uploads ***************/

export async function initializeUploadHandler(request, bucket, s3obj, master) {
    let project = request.params.project;
    let version = request.params.version;

    let user;
    try {
        user = await auth.findUser(request, master);
    } catch (e) {
        return utils.errorResponse(e.message, 401);
    }
    console.log(user);

    if (!auth.uploaders.has(user)) {
        return utils.errorResponse("user is not registered as an uploader", 403);
    } else {
        let perms = await auth.getPermissions(project);
        console.log(perms);
        if (perms !== null && determinePrivileges(perms, user) != "owner") {
            return utils.errorResponse("user is not registered as an owner of the project", 403);
        }
    }

    let exp;
    try {
        exp = expiry.expiresInMilliseconds(request);
    } catch (e) {
        return utils.errorResponse(e.message, 400);
    }

    try {
        await lock.lockProject(project, version, user, { expiry: exp });
    } catch (e) {
        return utils.errorResponse(e.message, 403);
    }

    let body = await request.json();
    let files = body.filenames;

    let precollected = [];
    let prenames = []
    for (const f of files) {
        if (typeof f == "string") {
            let params = { Bucket: bucket, Key: project + "/" + version + "/" + f, Expires: 3600 };
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

    let completer = "/projects/" + project + "/version/" + version + "/complete";
    return utils.jsonResponse({ presigned_urls: presigned, completion_url: completer }, 200);
}

/**************** Complete uploads ***************/

export async function completeUploadHandler(request, master) {
    let project = request.params.project;
    let version = request.params.version;

    let user;
    try {
        user = await auth.findUser(request, master);
    } catch (e) {
        return utils.errorResponse(e.message, 401);
    }

    try {
        await lock.checkLock(project, version, user);
    } catch (e) {
        return utils.errorResponse(e.message, 403);
    }

    let body = await request.json();
    if (!("read_access" in body)) {
        body.read_access = "public";
    }
    if (!("owners" in body)) {
        body.owners = [user];
    }
    if (!("viewers" in body)) {
        body.viewers = [];
    }
    try {
        auth.checkPermissions(body);
    } catch (e) {
        return utils.errorResponse(e.message, 400);
    }

    let overwrite = request.query.overwrite_permissions === "true";

    let payload;
    try {
        let info = await gh.postNewIssue(
            "upload complete",
            JSON.stringify({ 
                project: project,
                version: version,
                timestamp: Date.now(),
                permissions: { 
                    read_access: body.read_access, 
                    owners: body.owners,
                    viewers: body.viewers
                },
                overwrite_permissions: overwrite
            }),
            master
        );
        payload = await info.json();
    } catch (e) {
        return utils.errorResponse(e.message, 500);
    }

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
