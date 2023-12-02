import * as utils from "./utils.js";
import * as auth from "./auth.js";
import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";

export async function removeProjectHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins())) {
        throw new utils.HttpError("user does not have the right to delete", 403);
    }

    // Loop through all resources and delete them all. Make sure to add the trailing
    // slash to ensure that we don't delete a project that starts with 'project'.
    await utils.quickRecursiveDelete(project + "/");
    return new Response(null, { status: 200 });
}

export async function removeProjectAssetHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins())) {
        throw new utils.HttpError("user does not have the right to delete", 403);
    }

    // Loop through all resources and delete them all. Make sure to add the trailing
    // slash to ensure that we don't delete an asset that starts with 'asset'.
    await utils.quickRecursiveDelete(project + "/" + asset + "/");
    return new Response(null, { status: 200 });
}

export async function removeProjectAssetVersionHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);
    let version = decodeURIComponent(request.params.version);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins())) {
        throw new utils.HttpError("user does not have the right to delete", 403);
    }

    // Loop through all resources and delete them all. Make sure to add the trailing
    // slash to ensure that we don't delete a version that starts with 'version'.
    await utils.quickRecursiveDelete(project + "/" + asset + "/" + version + "/");

    // Need to go through and update the latest version of the asset, in case
    // we just deleted the latest version.
    let bound_bucket = s3.getR2Binding();
    let lpath = pkeys.latestVersion(project, asset);
    let lres = await bound_bucket.get(lpath);
    let linfo = await lres.json();

    if (linfo.version == version) {
        let prefix = project + "/" + asset + "/";
        let list_options = { prefix: prefix, delimiter: "/" };
        let truncated = true;
        let summaries = [];
        let versions = [];

        while (true) {
            let listing = await bound_bucket.list(list_options);
            for (const f of listing.delimitedPrefixes) {
                let basename = f.slice(prefix.length, f.length - 1); 
                if (!basename.startsWith("..")) {
                    summaries.push(bound_bucket.get(pkeys.versionSummary(project, asset, basename)));
                    versions.push(basename);
                }
            }
            truncated = listing.truncated;
            if (truncated) {
                list_options.cursor = listing.cursor;
            } else {
                break;
            }
        }

        let resolved = await Promise.all(summaries);
        let best_version = null, best_time = null;
        for (var i = 0; i < resolved.length; i++) {
            let contents = await resolved[i].json();
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
            await bound_bucket.delete(lpath);
        } else {
            if ((await utils.quickUploadJson(lpath, { "version": best_version })) == null) {
                throw new utils.HttpError("failed to update the latest version", 500);
            }
        }
    }

    return new Response(null, { status: 200 });
}
