import * as http from "./utils/http.js";
import * as auth from "./utils/permissions.js";
import * as quot from "./utils/quota.js";
import * as vers from "./utils/version.js";
import * as lock from "./utils/lock.js";
import * as pkeys from "./utils/internal.js";
import * as s3 from "./utils/s3.js";
import * as change from "./utils/changelog.js";

export async function removeProjectHandler(request, env, nonblockers) {
    let project = decodeURIComponent(request.params.project);

    let token = auth.extractBearerToken(request);
    await auth.checkAdminPermissions(token, env, nonblockers);

    // Locking the project to avoid simultaneous uploads that compete with the delete.
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, "", "", session_key, env);

    try {
        // Add trailing slash to avoid deleting a project that starts with 'project'.
        await s3.quickRecursiveDelete(project + "/", env);
    } finally {
        await lock.unlockProject(project, env);
    }

    await change.addChangelog({ type: "delete-project", project }, env);
    return new Response(null, { status: 200 });
}

export async function removeProjectAssetHandler(request, env, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);

    let token = auth.extractBearerToken(request);
    await auth.checkAdminPermissions(token, env, nonblockers);

    // Locking the project to avoid simultaneous uploads that compete with the
    // delete. Also need to lock it to update '..usage'.
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, "", session_key, env);

    try {
        // Add trailing slash to avoid deleting an asset that starts with 'asset'.
        let freed = await s3.quickRecursiveDelete(project + "/" + asset + "/", env);
        await quot.updateQuotaOnDeletion(project, freed, env);
    } finally {
        await lock.unlockProject(project, env);
    }

    await change.addChangelog({ type: "delete-asset", project, asset }, env);
    return new Response(null, { status: 200 });
}

export async function removeProjectAssetVersionHandler(request, env, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    let token = auth.extractBearerToken(request);
    await auth.checkAdminPermissions(token, env, nonblockers);

    // Locking the project to avoid simultaneous uploads that compete with the
    // delete. Also need to lock it to update '..latest'.
    let session_key = crypto.randomUUID();
    await lock.lockProject(project, asset, version, session_key, env);

    try {
        // Add trailing slash to avoid deleting a version that starts with 'version'.
        let freed = await s3.quickRecursiveDelete(project + "/" + asset + "/" + version + "/", env);
        await quot.updateQuotaOnDeletion(project, freed, env);

        // Need to go through and update the latest version of the asset, in case
        // we just deleted the latest version.
        let linfo = await s3.quickFetchJson(pkeys.latestVersion(project, asset), env, { mustWork: false });
        var was_latest = (linfo !== null && linfo.version == version);
        if (was_latest) {
            await vers.updateLatestVersion(project, asset, env);
        }

    } finally {
        await lock.unlockProject(project, env);
    }

    await change.addChangelog({ type: "delete-version", project, asset, version, latest: was_latest }, env);
    return new Response(null, { status: 200 });
}
