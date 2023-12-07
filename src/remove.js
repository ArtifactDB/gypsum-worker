import * as http from "./utils/http.js";
import * as auth from "./utils/permissions.js";
import * as pkeys from "./utils/internal.js";
import * as s3 from "./utils/s3.js";

export async function removeProjectHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins())) {
        throw new http.HttpError("user does not have the right to delete", 403);
    }

    // Loop through all resources and delete them all. Make sure to add the trailing
    // slash to ensure that we don't delete a project that starts with 'project'.
    await s3.quickRecursiveDelete(project + "/");
    return new Response(null, { status: 200 });
}

export async function removeProjectAssetHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins())) {
        throw new http.HttpError("user does not have the right to delete", 403);
    }

    // Loop through all resources and delete them all. Make sure to add the trailing
    // slash to ensure that we don't delete an asset that starts with 'asset'.
    await s3.quickRecursiveDelete(project + "/" + asset + "/");
    return new Response(null, { status: 200 });
}

export async function removeProjectAssetVersionHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins())) {
        throw new http.HttpError("user does not have the right to delete", 403);
    }

    // Loop through all resources and delete them all. Make sure to add the trailing
    // slash to ensure that we don't delete a version that starts with 'version'.
    await s3.quickRecursiveDelete(project + "/" + asset + "/" + version + "/");

    // Need to go through and update the latest version of the asset, in case
    // we just deleted the latest version.
    let lpath = pkeys.latestVersion(project, asset);
    let linfo = await s3.quickFetchJson(lpath, false);

    if (linfo !== null && linfo.version == version) {
        let prefix = project + "/" + asset + "/";
        let summaries = [];
        let versions = [];
        await s3.listApply(
            prefix, 
            name => {
                if (!name.startsWith("..")) {
                    summaries.push(s3.quickFetchJson(pkeys.versionSummary(project, asset, name)));
                    versions.push(name);
                }
            }, 
            { local: true }
        );

        let resolved = await Promise.all(summaries);
        let best_version = null, best_time = null;
        for (var i = 0; i < resolved.length; i++) {
            let contents = resolved[i];
            if (!("on_probation" in contents) || !contents.on_probation) {
                let current = Date.parse(contents.upload_finished);
                if (best_time == null || current > best_time) {
                    best_time = current;
                    best_version = versions[i];
                }
            }
        }

        if (best_version == null) {
            // We just deleted the last (non-probational) version, so we'll
            // just clear out the latest specifier.
            let bound_bucket = s3.getR2Binding();
            await bound_bucket.delete(lpath);
        } else {
            linfo.version = best_version;
            await s3.quickUploadJson(lpath, linfo);
        }
    }

    return new Response(null, { status: 200 });
}
