import * as files from "./files.js";
import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as lock from "./lock.js";

async function getAggregatedMetadata(project, version, bound_bucket) {
    let aggr = await bound_bucket.get(project + "/" + version + "/..aggregated.json");
    if (aggr == null) {
        throw new utils.HttpError("failed to fetch aggregated metadata for '" + project + "' (version '" + version + "')", 500);
    }
    return await aggr.json();
}

async function getLinks(project, version, bound_bucket) {
    let vals = await bound_bucket.get(project + "/" + version + "/..links.json");
    if (vals !== null) {
        return await vals.json();
    } else {
        return null;
    }
}

async function retrieve_project_version_metadata(project, version, bound_bucket, perm, nonblockers) {
    let resolved = await Promise.all([
        getAggregatedMetadata(project, version, bound_bucket),
        files.getVersionMetadata(project, version, bound_bucket, nonblockers),
        getLinks(project, version, bound_bucket)
    ]);

    let aggr_meta = resolved[0];
    let ver_meta = resolved[1];
    let link_meta = resolved[2];

    for (const m of aggr_meta) {
        let id = project + ":" + m.path + "@" + version;
        let components = { project: project, path: m.path, version: version };
        m["_extra"] = files.createExtraMetadata(id, components, m, ver_meta, perm);
    }

    if (link_meta) {
        for (const m of aggr_meta) {
            if (m.path in link_meta) {
                m["_extra"].link = { "id": link_meta[m.path] };
            }
        }
    }

    return aggr_meta;
}

export async function getProjectVersionMetadataHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let version = request.params.version;
    let master = globals.gh_master_token;

    let all_promises = [];
    all_promises.push(auth.findUser(request, master, nonblockers).catch(error => null));
    all_promises.push(auth.getPermissions(project, bound_bucket, nonblockers));

    // Resolving them all at once.
    let resolved = await Promise.all(all_promises);
    let user = resolved[0];
    let perm = resolved[1];

    files.checkPermissions(perm, user, project);

    let aggr_meta = await retrieve_project_version_metadata(project, version, bound_bucket, perm, nonblockers);
    if (aggr_meta == null) {
        throw new utils.HttpError("cannot fetch metadata for locked project '" + project + "' (version '" + version + "')", 400);
    }

    return utils.jsonResponse({
        results: aggr_meta,
        count: aggr_meta.length,
        total: aggr_meta.length
    }, 200);
}

export async function listAvailableVersions(project, bound_bucket) {
    let collected = [];
    let params = { prefix: project + "/", delimiter: "/" };

    while (1) {
        let entries = await bound_bucket.list(params);
        for (const v of entries.delimitedPrefixes) {
            if (!v.endsWith(".json")) {
                let fragments = v.split("/");
                collected.push(fragments[fragments.length - 2]);
            }
        }

        if (entries.truncated) {
            params.cursor = entries.cursor;
        } else {
            break;
        }
    }

    let lock_promises = collected.map(x => lock.isLocked(project, x, bound_bucket));
    let is_locked = await Promise.all(lock_promises);
    let output = [];
    for (var i = 0; i < is_locked.length; i++) {
        if (!is_locked[i]) {
            output.push(collected[i]);
        }
    }

    return output;
}

export async function getProjectMetadataHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let version = request.params.version;
    let master = globals.gh_master_token;

    let all_promises = [];
    all_promises.push(auth.findUser(request, master, nonblockers).catch(error => null));
    all_promises.push(auth.getPermissions(project, bound_bucket, nonblockers));
    all_promises.push(listAvailableVersions(project, bound_bucket));

    let resolved = await Promise.all(all_promises);
    let user = resolved[0];
    let perm = resolved[1];
    let versions = resolved[2];

    files.checkPermissions(perm, user, project);

    let collected = [];
    for (const v of versions) {
        collected.push(retrieve_project_version_metadata(project, v, bound_bucket, perm, nonblockers));
    }

    let finalized = await Promise.all(collected);
    let output = [];
    for (const f of finalized) {
        for (const k of f) {
            output.push(k);
        }
    }
 
    return utils.jsonResponse({
        results: output,
        count: output.length,
        total: output.length
    }, 200);
}

export async function listProjectVersionsHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let version = request.params.version;
    let master = globals.gh_master_token;

    let all_promises = [];
    all_promises.push(auth.findUser(request, master, nonblockers).catch(error => null));
    all_promises.push(auth.getPermissions(project, bound_bucket, nonblockers));
    all_promises.push(listAvailableVersions(project, bound_bucket));
    all_promises.push(files.getLatestVersion(project, bound_bucket, nonblockers));

    let resolved = await Promise.all(all_promises);
    let user = resolved[0];
    let perm = resolved[1];
    let versions = resolved[2];
    let latest = resolved[3];

    files.checkPermissions(perm, user, project);

    return utils.jsonResponse({
        project_id: project,
        aggs: versions.map(x => { return { "_extra.version": x } }),
        total: versions.length,
        latest: { "_extra.version": latest.version }
    }, 200);
}
