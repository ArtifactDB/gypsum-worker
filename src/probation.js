import * as http from "./utils/http.js";
import * as auth from "./utils/permissions.js";
import * as quot from "./utils/quota.js";
import * as s3 from "./utils/s3.js";
import * as pkeys from "./utils/internal.js";
import * as lock from "./utils/lock.js";

export async function approveProbationHandler(request, env, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    let token = auth.extractBearerToken(request);
    await auth.checkProjectManagementPermissions(project, token, env, nonblockers);

    // Need to lock the project to update '..latest', just in case another
    // upload is happening at the same time. Also lock it for '..summary' just
    // in case someone tries to hit the rejection handler simultaneously.
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, version, session_key, env);

    try {
        let sumpath = pkeys.versionSummary(project, asset, version);
        let info = await s3.quickFetchJson(sumpath, env, { mustWork: false });
        if (info == null) {
            throw new http.HttpError("version does not exist", 400);
        }
        if (!("on_probation" in info) || !info.on_probation) {
            throw new http.HttpError("cannot approve probation for non-probational version", 400);
        }
        delete info.on_probation;
        await s3.quickUploadJson(sumpath, info, env);

        let latpath = pkeys.latestVersion(project, asset);
        let latest = await s3.quickFetchJson(latpath, env, { mustWork: false });
        let is_latest = true;
        if (latest !== null) {
            let latest_info = await s3.quickFetchJson(pkeys.versionSummary(project, asset, latest.version), env);
            let my_finish = Date.parse(info.upload_finished);
            let latest_finish = Date.parse(latest_info.upload_finished);
            is_latest = (my_finish > latest_finish);
        }
        if (is_latest) {
            await s3.quickUploadJson(latpath, { version: version }, env);
        }

    } finally {
        await lock.unlockProject(project, env);
    }

    return new Response(null, { status: 200 });
}

export async function rejectProbationHandler(request, env, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    let token = auth.extractBearerToken(request);
    let { can_manage, is_trusted, user } = await auth.checkProjectUploadPermissions(project, asset, version, token, env, nonblockers);

    // Need to lock the project to update '..usage', just in case another
    // upload is happening at the same time. Also lock it for the delete, just
    // in case someone tries to hit the approve handler simultaneously.
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, version, session_key, env);

    try {
        let sumpath = pkeys.versionSummary(project, asset, version);
        let info = await s3.quickFetchJson(sumpath, env, { mustWork: false });
        if (info == null) {
            throw new http.HttpError("version does not exist", 400);
        }
        if (!("on_probation" in info) || !info.on_probation) {
            throw new http.HttpError("cannot reject probation for non-probational version", 400);
        }

        if (!can_manage && user.login !== info.upload_user_id) {
            throw new http.HttpError("cannot reject probation for different user", 400);
        }

        let freed = await s3.quickRecursiveDelete(project + "/" + asset + "/" + version + "/", env);
        await quot.updateQuotaOnDeletion(project, freed, env);
    } finally {
        await lock.unlockProject(project, env);
    }

    return new Response(null, { status: 200 });
}
