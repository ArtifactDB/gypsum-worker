import * as utils from "./utils.js";
import * as auth from "./auth.js";

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
            throw new utils.HttpError("probational version does not exist", 400);
        }

        let info = JSON.parse(raw_info);
        if (!("on_probation" in info) || !info.on_probation) {
            throw new utils.HttpError("cannot approve probation for non-probational version", 400);
        }
        delete info.on_probation;

        let summary_update = utils.quickUploadJson(sumpath, info);
        if ((await summary_update) == null) {
            throw new utils.HttpError("failed to update version summary", 500);
        }
    } finally {
        await bound_bucket.delete(pkeys.lock(project, asset));
    }

    return new Response(null, { status: 200 });
}

export async function rejectProbationHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    let token = auth.extractBearerToken(request);
    let { status, user } = await auth.checkProjectUploadPermissions(project, asset, version, token, nonblockers);

    let bound_bucket = s3.getR2Binding();
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, version, session_key);

    try {
        let sumpath = pkeys.versionSummary(project, asset, version);
        let raw_info = await bound_bucket.get(sumpath);
        if (raw_info == null) {
            throw new utils.HttpError("probational version does not exist", 400);
        }

        let info = JSON.parse(raw_info);
        if (!("on_probation" in info) || !info.on_probation) {
            throw new utils.HttpError("cannot reject probation for non-probational version", 400);
        }

        if (status !== "owner" && user.login !== info.upload_user_id) {
            throw new utils.HttpError("cannot reject probation for different user", 400);
        }

        await utils.quickRecursiveDelete(project + "/" + asset + "/" + version + "/");
    } finally {
        await bound_bucket.delete(pkeys.lock(project, asset));
    }

    return new Response(null, { status: 200 });
}
