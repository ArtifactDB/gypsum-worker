import * as files from "./files.js";
import * as auth from "./auth.js";
import * as utils from "./utils.js";

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

function augment_file_metadata(project, version, aggr_meta, ver_meta, perm, link_meta) {
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
}

export async function getProjectVersionMetadataHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let version = request.params.version;
    let master = globals.gh_master_token;

    let all_promises = [];
    all_promises.push(auth.findUser(request, master, nonblockers).catch(error => null));
    all_promises.push(auth.getPermissions(project, bound_bucket, nonblockers));
    all_promises.push(files.getVersionMetadata(project, version, bound_bucket, nonblockers));
    all_promises.push(getAggregatedMetadata(project, version, bound_bucket));
    all_promises.push(getLinks(project, version, bound_bucket));

    // Resolving them all at once.
    let resolved = await Promise.all(all_promises);
    let user = resolved[0];
    let perm = resolved[1];
    let ver_meta = resolved[2];
    let aggr_meta = resolved[3];
    let link_meta = resolved[4];

    let err = files.checkPermissions(perm, user, project);
    if (err !== null) {
        return err;
    }
    if (aggr_meta == null) {
        throw new utils.HttpError("cannot fetch metadata for locked project '" + project + "' (version '" + version + "')", 400);
    }

    augment_file_metadata(project, version, aggr_meta, ver_meta, perm, link_meta);
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

    return collected;
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

    let err = files.checkPermissions(perm, user, project);
    if (err !== null) {
        return err;
    }

    let collected = [];
    for (const v of versions) {
        let p1 = await getAggregatedMetadata(project, v, bound_bucket);
        let p2 = await files.getVersionMetadata(project, v, bound_bucket);
        let p3 = await getLinks(project, v, bound_bucket);

        collected.push(
            Promise.all([p1, p2, p3, v])
                .then(x => {
                    if (x[0] !== null) {
                        augment_file_metadata(project, x[3], x[0], x[1], x[2]);
                        return x[0];
                    } else {
                        return [];
                    }
                })
        );
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
