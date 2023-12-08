export function permissions(project) {
    return project + "/..permissions";
}

export function quota(project) {
    return project + "/..quota";
}

export function usage(project) {
    return project + "/..usage";
}

export function versionSummary(project, asset, version) {
    return project + "/" + asset + "/" + version + "/..summary";
}

export function versionManifest(project, asset, version) {
    return project + "/" + asset + "/" + version + "/..manifest";
}

export function lock(project) {
    return project + "/..LOCK";
}

export function latestVersion(project, asset) {
    return project + "/" + asset + "/..latest";
}
