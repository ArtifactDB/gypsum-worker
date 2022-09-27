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

async function get_links(project, version, bound_bucket) {
    let vals = await bound_bucket.get(project + "/" + version + "/..links.json");
    if (vals !== null) {
        return await vals.json();
    } else {
        return null;
    }
}

async function retrieve_project_version_metadata(project, version, bound_bucket, perm, nonblockers) {
    let resolved = await utils.namedResolve({
        aggregated: getAggregatedMetadata(project, version, bound_bucket),
        version: files.getVersionMetadata(project, version, bound_bucket, nonblockers),
        links: get_links(project, version, bound_bucket)
    });

    let aggr_meta = resolved.aggregated;
    let ver_meta = resolved.version;
    for (const m of aggr_meta) {
        let id = project + ":" + m.path + "@" + version;
        let components = { project: project, path: m.path, version: version };
        m["_extra"] = files.createExtraMetadata(id, components, m, ver_meta, perm);
    }

    let link_meta = resolved.links;
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

    let resolved = await utils.namedResolve({
        user: auth.findUserNoThrow(request, master, nonblockers),
        permissions: auth.getPermissions(project, bound_bucket, nonblockers)
    });

    let perm = resolved.permissions;
    auth.checkReadPermissions(perm, resolved.user, project);

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
    let master = globals.gh_master_token;

    let resolved = await utils.namedResolve({
        user: auth.findUserNoThrow(request, master, nonblockers),
        permissions: auth.getPermissions(project, bound_bucket, nonblockers),
        versions: listAvailableVersions(project, bound_bucket)
    });

    let perm = resolved.permissions;
    auth.checkReadPermissions(perm, resolved.user, project);

    let collected = resolved.versions.map(async version => {
        try {
            return await retrieve_project_version_metadata(project, version, bound_bucket, perm, nonblockers);
        } catch (e) {
            console.warn("failed to retrieve metadata for project '" + project + "' (version '" + version + "'): " + e.message); // don't fail completely if version is bad.
            return [];
        }
    });

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
    let master = globals.gh_master_token;

    let resolved = await utils.namedResolve({
        user: auth.findUserNoThrow(request, master, nonblockers),
        permissions: auth.getPermissions(project, bound_bucket, nonblockers),
        versions: listAvailableVersions(project, bound_bucket),
        latest: files.getLatestVersion(project, bound_bucket, nonblockers)
    });

    auth.checkReadPermissions(resolved.permissions, resolved.user, project);
    let versions = resolved.versions;
    let latest = resolved.latest;

    return utils.jsonResponse({
        project_id: project,
        aggs: versions.map(x => { return { "_extra.version": x } }),
        total: versions.length,
        latest: { "_extra.version": latest.version }
    }, 200);
}

export async function listProjectsHandler(request, bound_bucket, globals, nonblockers) {
    let master = globals.gh_master_token;
    let user = await auth.findUserNoThrow(request, master, nonblockers);

    // Looping across all projects.
    let params = { delimiter: "/", limit: 50 };
    let continuation = request.query.more;
    if (continuation) {
        params.cursor = continuation;
    }

    let entries = await bound_bucket.list(params);
    let collected = [];
    for (const e of entries.delimitedPrefixes) {
        if (!e.endsWith(".json")) {
            let fragments = e.split("/");
            collected.push(fragments[fragments.length - 2]);
        }
    }

    let project_promises = collected.map(async project => {
        try {
            let perm = await auth.getPermissions(project, bound_bucket, nonblockers);
            auth.checkReadPermissions(perm, user, nonblockers);
        } catch (e) {
            if (e.statusCode < 400 && e.statusCode >= 500) {
                console.warn("failed to retrieve permissions for project '" + project + "': " + e.message); // don't fail completely if project is bad.
            }
            return null;
        }

        let all_versions = await listAvailableVersions(project, bound_bucket);
        return { 
            project_id: project,
            aggs: all_versions.map(x => { return { "_extra.version": x } })
        };
    });

    let resolved = await Promise.all(project_promises);
    let keep = [];
    for (const r of resolved) {
        if (r !== null) {
            keep.push(r);
        }
    }

    let output = {
        results: keep,
        count: keep.length
    };

    // Passing on the cursor for the next round.
    let headers = {};
    if (entries.truncated) {
        let scroll = "/projects?more=" + entries.cursor;
        output.more = scroll;
        headers.link = "<" + scroll + ">; rel=\"more\"";
    }

    return utils.jsonResponse(output, 200, headers);
}

export async function getProjectVersionInfoHandler(request, bound_bucket, globals, nonblockers) {
    let project = request.params.project;
    let version = request.params.version;
    let master = globals.gh_master_token;

    let resolved = await utils.namedResolve({
        user: auth.findUserNoThrow(request, master, nonblockers),
        permissions: auth.getPermissions(project, bound_bucket, nonblockers),
        locked: lock.isLocked(project, version, bound_bucket)
    });

    auth.checkReadPermissions(resolved.permissions, resolved.user, nonblockers);
    if (resolved.locked) {
        throw new utils.HttpError("project '" + project + "' (version '" + version + "') is still locked", 400);
    }

    return utils.jsonResponse({ status: "ok", permissions: resolved.permissions }, 200);
}
