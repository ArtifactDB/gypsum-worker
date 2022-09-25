import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as gh from "./github.js";
import * as lock from "./lock.js";
import * as expiry from "./expiry.js";

/**************** Initialize uploads ***************/

export async function initializeUploadHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let version = request.params.version;

    let bucket = globals.r2_bucket_name;
    let master = globals.gh_master_token;
    let s3obj = globals.s3_binding;

    let user = await auth.findUser(request, master, nonblockers);
    if (user == null) {
        throw new utils.HttpError("no user identity supplied", 401);
    } else if (!auth.uploaders.has(user)) {
        throw new utils.HttpError("user is not registered as an uploader", 403);
    } else {
        let perms = await auth.getPermissions(project, bound_bucket, nonblockers);
        if (perms !== null && auth.determinePrivileges(perms, user) != "owner") {
            throw new utils.HttpError("user is not registered as an owner of the project", 403);
        }
    }

    let exp = expiry.expiresInMilliseconds(request);
    await lock.lockProject(project, version, bound_bucket, user, { expiry: exp });

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
            throw new utils.HttpError("non-string file uploads are not yet supported", 400);
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

export async function completeUploadHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let version = request.params.version;

    let master = globals.gh_master_token;
    let user = await auth.findUser(request, master, nonblockers);
    await lock.checkLock(project, version, bound_bucket, user);

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
    auth.checkPermissions(body);

    let overwrite = request.query.overwrite_permissions === "true";
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
    let payload = await info.json();

    return utils.jsonResponse({ job_id: payload.number }, 202);
}

export async function queryJobIdHandler(request, bound_bucket, globals, nonblockers) {
    let jid = request.params.jobid;
    let master = globals.gh_master_token;

    let info = await gh.getIssue(jid, master);
    let payload = await info.json();

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
