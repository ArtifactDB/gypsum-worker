import * as pkeys from "./internal.js";
import * as s3 from "./s3.js";

export async function updateLatestVersion(project, asset, env) {
    let prefix = project + "/" + asset + "/";
    let summaries = [];
    let versions = [];
    await s3.listApply(
        prefix, 
        name => {
            if (!name.startsWith("..")) {
                summaries.push(s3.quickFetchJson(pkeys.versionSummary(project, asset, name), env));
                versions.push(name);
            }
        }, 
        env,
        { local: true }
    );

    let resolved = await Promise.all(summaries);
    let best_version = null, best_time = null;
    for (var i = 0; i < resolved.length; i++) {
        let contents = resolved[i];
        if (!("on_probation" in contents) || !contents.on_probation) {
            let current = Date.parse(contents.upload_finish);
            if (best_time == null || current > best_time) {
                best_time = current;
                best_version = versions[i];
            }
        }
    }

    let lpath = pkeys.latestVersion(project, asset);
    if (best_version == null) {
        // We just deleted the last (non-probational) version, so we'll
        // just clear out the latest specifier.
        await env.BOUND_BUCKET.delete(lpath);
    } else {
        await s3.quickUploadJson(lpath, { version: best_version }, env);
    }

    return best_version;
}
