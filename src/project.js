import * as files from "./files.js";
import * as auth from "./auth.js";
import * as utils from "./utils.js";
import * as lock from "./lock.js";
import * as pkeys from "./internal.js";
import * as latest from "./latest.js";
import * as s3 from "./s3.js";

async function getAggregatedMetadata(project, version) {
    let bound_bucket = s3.getR2Binding();
    let aggr = await bound_bucket.get(pkeys.aggregated(project, version));
    if (aggr == null) {
        throw new utils.HttpError("failed to fetch aggregated metadata for '" + project + "' (version '" + version + "')", 500);
    }
    return await aggr.json();
}

async function get_links(project, version) {
    let bound_bucket = s3.getR2Binding();
    let vals = await bound_bucket.get(pkeys.links(project, version));
    if (vals !== null) {
        return await vals.json();
    } else {
        return null;
    }
}

async function decorate_version_metadata(project, version, resolved, perm) {
    let aggr_meta = resolved.aggregated;
    for (const m of aggr_meta) {
        let id = utils.packId(project, m.path, version);
        let components = { project: project, path: m.path, version: version };
        m["_extra"] = files.createExtraMetadata(id, components, m, resolved.version, perm);
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

async function retrieve_project_version_metadata_or_null(project, version, perm, nonblockers) {
    let ver_meta = await files.getVersionMetadataOrNull(project, version, nonblockers);
    if (ver_meta == null) {
        return null;
    }

    let resolved = await utils.namedResolve({
        aggregated: getAggregatedMetadata(project, version),
        links: get_links(project, version)
    });
    resolved.version = ver_meta;

    return decorate_version_metadata(project, version, resolved, perm);
}

async function retrieve_project_version_metadata(project, version, perm, nonblockers) {
    let resolved = await utils.namedResolve({
        aggregated: getAggregatedMetadata(project, version),
        version: files.getVersionMetadata(project, version, nonblockers),
        links: get_links(project, version)
    });
    return decorate_version_metadata(project, version, resolved, perm);
}

export async function getProjectVersionMetadataHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let version = decodeURIComponent(request.params.version);

    let resolved = await utils.namedResolve({
        user: auth.findUserNoThrow(request, nonblockers),
        permissions: auth.getPermissions(project, nonblockers)
    });
    let perm = resolved.permissions;
    auth.checkReadPermissions(perm, resolved.user, project);

    let aggr_meta;
    let aggr_fun = v => retrieve_project_version_metadata_or_null(project, v, perm, nonblockers);
    if (version == "latest") {
        let attempt = await latest.attemptOnLatest(project, aggr_fun, nonblockers);
        aggr_meta = attempt.result;
        version = attempt.version;
    } else {
        aggr_meta = await aggr_fun(version);
    }
    if (aggr_meta == null) {
        throw new utils.HttpError("cannot fetch metadata for locked project '" + project + "' (version '" + version + "')", 400);
    }

    return utils.jsonResponse({
        results: aggr_meta,
        count: aggr_meta.length,
        total: aggr_meta.length
    }, 200);
}

export async function listAvailableVersions(project) {
    let bound_bucket = s3.getR2Binding();
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

    let lock_promises = collected.map(x => lock.isLocked(project, x));
    let ver_promises = collected.map(x => bound_bucket.head(pkeys.versionMetadata(project, x)));

    let is_locked = await Promise.all(lock_promises);
    let has_ver_meta = await Promise.all(ver_promises);
    let output = [];
    for (var i = 0; i < is_locked.length; i++) {
        if (!is_locked[i] && has_ver_meta[i] != null) {
            output.push(collected[i]);
        }
    }

    return output;
}

export async function getProjectMetadataHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);

    let resolved = await utils.namedResolve({
        user: auth.findUserNoThrow(request, nonblockers),
        permissions: auth.getPermissions(project, nonblockers),
        versions: listAvailableVersions(project)
    });

    let perm = resolved.permissions;
    auth.checkReadPermissions(perm, resolved.user, project);

    let collected = resolved.versions.map(async version => {
        try {
            return await retrieve_project_version_metadata(project, version, perm, nonblockers);
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

export async function listProjectVersionsHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);

    let resolved = await utils.namedResolve({
        user: auth.findUserNoThrow(request, nonblockers),
        permissions: auth.getPermissions(project, nonblockers)
    });
    auth.checkReadPermissions(resolved.permissions, resolved.user, project);

    let more_resolved = await utils.namedResolve({
        versions: await listAvailableVersions(project),
        latest: await latest.getLatestVersion(project, nonblockers)
    });
    let versions = more_resolved.versions;
    let latver = more_resolved.latest.version;

    if (versions.indexOf(latver) < 0) {
        let reloaded = await latest.getLatestVersionNoCache(project, nonblockers);
        latver = reloaded.version;
    }

    return utils.jsonResponse({
        project_id: project,
        aggs: versions.map(x => { return { "_extra.version": x } }),
        total: versions.length,
        latest: { "_extra.version": latver }
    }, 200);
}

export async function listProjectsHandler(request, nonblockers) {
    let bound_bucket = s3.getR2Binding();
    let user = await auth.findUserNoThrow(request, nonblockers);

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
            let perm = await auth.getPermissions(project, nonblockers);
            auth.checkReadPermissions(perm, user, nonblockers);
        } catch (e) {
            if (e.statusCode < 400 && e.statusCode >= 500) {
                console.warn("failed to retrieve permissions for project '" + project + "': " + e.message); // don't fail completely if project is bad.
            }
            return null;
        }

        let all_versions = await listAvailableVersions(project);
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

export async function getProjectVersionInfoHandler(request, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let version = decodeURIComponent(request.params.version);
    let bound_bucket = s3.getR2Binding();

    let resolved = await utils.namedResolve({
        user: auth.findUserNoThrow(request, nonblockers),
        permissions: auth.getPermissions(project, nonblockers)
    });
    auth.checkReadPermissions(resolved.permissions, resolved.user, nonblockers);

    let check_version_meta = v => bound_bucket.head(pkeys.versionMetadata(project, v));
    let ver_meta;

    if (version != "latest") {
        let locked = await lock.isLocked(project, version);
        if (locked) {
            return utils.jsonResponse({ 
                status: "error", 
                permissions: resolved.permissions,
                anomalies: ["project version is still locked"]
            }, 200);
        }
        ver_meta = await check_version_meta(version);
    } else {
        let attempt = await latest.attemptOnLatest(project, check_version_meta, nonblockers);
        ver_meta = attempt.result;
        version = attempt.version;
    }

    if (ver_meta == null) {
        return utils.jsonResponse({ 
            status: "error", 
            permissions: resolved.permissions, 
            anomalies: ["cannot find version metadata"]
        }, 200);
    }

    return utils.jsonResponse({ status: "ok", permissions: resolved.permissions }, 200);
}
