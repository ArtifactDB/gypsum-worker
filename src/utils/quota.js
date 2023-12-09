import * as s3 from "./s3.js";
import * as misc from "./misc.js";
import * as http from "./http.js";
import * as lock from "./lock.js";
import * as pkeys from "./internal.js";

export async function getProjectUsage(project, env) {
    let total = 0;

    await s3.listApply(
        project + "/",
        f => { 
            // Only count the files that are actually uploaded by users.
            if (!f.key.startsWith("..") && f.key.indexOf("/..") < 0) {
                total += f.size; 
            }
        },
        env,
        { namesOnly: false }
    );

    return total;
}

export function validateQuota(body) {
    if (!misc.isJsonObject(body)) {
        throw new http.HttpError("expected quota specification to be a JSON object", 400);
    }

    let expected = [ "baseline", "growth_rate", "year" ];
    for (const field of expected) {
        if (field in body) {
            if (typeof body[field] != "number") {
                throw new http.HttpError("expected '" + field + "' to be a number", 400);
            }
            if (body[field] < 0) {
                throw new http.HttpError("expected '" + field + "' to be a non-negative number", 400);
            }
        }
    }
}

export function defaults() {
    return { 
        baseline: 10 * 10 ** 9,
        growth_rate: 20 * 10**9,
        year: (new Date()).getFullYear()
    };
}

export async function computeQuota(project, env) {
    let quota = await s3.quickFetchJson(pkeys.quota(project), env);
    return quota.baseline + ((new Date).getFullYear() - quota.year) * quota.growth_rate;
}

export async function updateQuotaOnDeletion(project, freed, env) {
    let usepath = pkeys.usage(project);
    let usage = await s3.quickFetchJson(usepath, env);
    usage.total -= freed;
    if (usage.total < 0) {
        usage.total = 0;
    }
    await s3.quickUploadJson(usepath, usage, env);
}
