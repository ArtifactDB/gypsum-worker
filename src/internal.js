export function permissions(project) {
    return project + "/..permissions";
}

export function versionSummary(project, asset, version) {
    return project + "/" + asset + "/" + version + "/..summary";
}

export function versionManifest(project, asset, version) {
    return project + "/" + asset + "/" + version + "/..manifest";
}

export function lock(project, asset) {
    return project + "/" + asset + "/..LOCK";
}

export function links(project, version) {
    return project + "/" + version + "/..links.json";
}

export function latestVersion(project, asset) {
    return project + "/" + asset + "/..latest";
}
