import * as utils from "./utils.js";
import * as pkeys from "./internal.js";

export async function get_latest_version_from_source(project, bound_bucket, cache, cache_key, nonblockers) {
    let stuff = await bound_bucket.get(pkeys.latestAll(project));
    if (stuff == null) {
        throw new utils.HttpError("failed to retrieve latest version for project '" + project + "'", 404);
    }

    let data = await stuff.text();
    let output = JSON.parse(data);

    if (output.version == "") {
        throw new utils.HttpError("all versions of project '" + project + "' have expired", 404);
    }

    nonblockers.push(utils.quickCacheJsonText(cache, cache_key, data, utils.minutesFromNow(5)));
    return output;
}

function latest_cache() {
    return caches.open("latest:cache");
}

function latest_cache_key(project) {
    // Key needs to be a URL.
    return "https://github.com/ArtifactDB/gypsum-worker/latest/" + project;
}

export async function getLatestVersion(project, bound_bucket, nonblockers) {
    const latestCache = await latest_cache();

    let key = latest_cache_key(project);
    let check = await latestCache.match(key);
    if (check) {
        return await check.json();
    }

    return await get_latest_version_from_source(project, bound_bucket, latestCache, key, nonblockers);
}

export async function getLatestVersionNoCache(project, bound_bucket, nonblockers) {
    const latestCache = await latest_cache();
    let key = latest_cache_key(project);
    return await get_latest_version_from_source(project, bound_bucket, latestCache, key, nonblockers);
}

export async function getLatestPersistentVersionOrNull(project, bound_bucket) {
    // Don't bother to cache this, as (i) it's only required for upload start
    // and (ii) we always want to get the very latest from source anyway when
    // defining links to write to the bucket.
    let stuff = await bound_bucket.get(pkeys.latestPersistent(project));
    if (stuff == null) {
        return null;
    }
    return await stuff.json();
}

export async function attemptOnLatest(project, bound_bucket, fun, nonblockers) {
    const latestCache = await latest_cache();

    let key = latest_cache_key(project);
    let check = await latestCache.match(key);

    // If nothing was cached, the latest ID must be fetched from source directly,
    // in which case we don't have to worry about cache invalidity.
    if (check == null) {
        let latest = await get_latest_version_from_source(project, bound_bucket, latestCache, key, nonblockers);
        let lv = latest.version;
        return { version: lv, result: await fun(lv) };
    }

    // Attempting to run the supplied function on the latest version in cache.
    {
        let latest = await check.json();
        let lv = latest.version;
        let res = await fun(lv);
        if (res != null) {
            return { version: lv, result: res };
        }
    }

    // If that fails, e.g., due to the removal of an expired version, we flush
    // the cache, re-acquire the latest version again, and re-run the function.
    // If that ALSO fails... you're on your own.
    await latestCache.delete(key);
    let latest = await get_latest_version_from_source(project, bound_bucket, latestCache, key, nonblockers);
    let lev = latest.version;
    return { version: lv, result: await fun(lv) };
}
