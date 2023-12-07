import * as http from "./utils/http.js";
import * as auth from "./utils/permissions.js";
import * as s3 from "./utils/s3.js";
import * as pkeys from "./utils/internal.js";
import * as lock from "./utils/lock.js";

export async function approveProbationHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    let token = auth.extractBearerToken(request);
    await auth.checkProjectManagementPermissions(project, token, nonblockers);

    let bound_bucket = s3.getR2Binding();
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, version, session_key);

    try {
        let sumpath = pkeys.versionSummary(project, asset, version);
        let raw_info = await bound_bucket.get(sumpath);
        if (raw_info == null) {
            throw new http.HttpError("probational version does not exist", 400);
        }

        let info = await raw_info.json();
        if (!("on_probation" in info) || !info.on_probation) {
            throw new http.HttpError("cannot approve probation for non-probational version", 400);
        }
        delete info.on_probation;

        let summary_update = s3.quickUploadJson(sumpath, info);
        if ((await summary_update) == null) {
            throw new http.HttpError("failed to update version summary", 500);
        }
    } finally {
        await lock.unlockProject(project, asset);
    }

    return new Response(null, { status: 200 });
}

export async function rejectProbationHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    let token = auth.extractBearerToken(request);
    let { can_manage, is_trusted, user } = await auth.checkProjectUploadPermissions(project, asset, version, token, nonblockers);

    let bound_bucket = s3.getR2Binding();
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, version, session_key);

    try {
        let sumpath = pkeys.versionSummary(project, asset, version);
        let raw_info = await bound_bucket.get(sumpath);
        if (raw_info == null) {
            throw new http.HttpError("probational version does not exist", 400);
        }

        let info = await raw_info.json();
        if (!("on_probation" in info) || !info.on_probation) {
            throw new http.HttpError("cannot reject probation for non-probational version", 400);
        }

        if (!can_manage && user.login !== info.upload_user_id) {
            throw new http.HttpError("cannot reject probation for different user", 400);
        }

        await s3.quickRecursiveDelete(project + "/" + asset + "/" + version + "/");
    } finally {
        await lock.unlockProject(project, asset);
    }

    return new Response(null, { status: 200 });
}
