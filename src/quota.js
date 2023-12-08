import * as pkeys from "./utils/internal.js";
import * as http from "./utils/http.js";
import * as misc from "./utils/misc.js";
import * as auth from "./utils/permissions.js";
import * as s3 from "./utils/s3.js";
import * as quot from "./utils/quota.js";
import * as lock from "./utils/lock.js";

export async function setQuotaHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins())) {
        throw new http.HttpError("user is not an administrator", 403);
    }

    let qpath = pkeys.quota(project);
    let qdata = await s3.quickFetchJson(qpath, false);
    if (qdata == null) {
        throw new http.HttpError("project does not exist", 400);
    }

    let new_quota = await http.bodyToJson(request);
    quot.validateQuota(new_quota);
    for (const x of Object.keys(qdata)) {
        if (x in new_quota) {
            qdata[x] = new_quota[x];
        }
    }

    await s3.quickUploadJson(qpath, qdata);
    return new Response(null, { status: 200 });
}

export async function refreshQuotaUsageHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins())) {
        throw new http.HttpError("user is not an administrator", 403);
    }

    let upath = pkeys.usage(project);
    let udata = await s3.quickFetchJson(upath, false);
    if (udata == null) {
        throw new http.HttpError("project does not exist", 400);
    }

    // If we want to get the usage, we need to wait until the lock has been acquired.
    // Otherwise, the count will include the in-progress upload.
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, "placeholder", "placeholder", session_key);

    try {
        udata.total = await quot.getProjectUsage(project);
        await s3.quickUploadJson(upath, udata);
    } finally {
        await lock.unlockProject(project);
    }

    return new http.jsonResponse(udata, 200);
}
