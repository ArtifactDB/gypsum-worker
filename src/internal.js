export function permissions(project) {
    return project + "/..permissions";
}

export function versionMetadata(project, version) {
    return project + "/" + version + "/..revision";
}

export function versionManifest(project, version) {
    return project + "/" + version + "/..manifest";
}

export function latestPersistent(project) {
    return project + "/..latest";
}

export function latestAll(project) {
    return project + "/..latest_all";
}

export function lock(project, version) {
    return project + "/" + version + "/..LOCK";
}

export function aggregated(project, version) {
    return project + "/" + version + "/..aggregated";
}

export function links(project, version) {
    return project + "/" + version + "/..links";
}

export function expiry(project, version) {
    return project + "/" + version + "/..expiry";
}
