import * as misc from "./utils/misc.js";
import * as http from "./utils/http.js";
import * as s3 from "./utils/s3.js";
import * as auth from "./utils/permissions.js";
import * as quot from "./utils/quota.js";
import * as pkeys from "./utils/internal.js";

export async function createProjectHandler(request, env, nonblockers) {
    let token = auth.extractBearerToken(request);
    await auth.checkAdminPermissions(token, env, nonblockers);

    let project = decodeURIComponent(request.params.project);
    if (project.indexOf("/") >= 0) {
        throw new http.HttpError("project name cannot contain '/'", 400);
    }

    let bound_bucket = env.BOUND_BUCKET;
    let permpath = pkeys.permissions(project);
    if ((await bound_bucket.head(permpath)) !== null) {
        throw new http.HttpError("project '" + project + "' already exists", 400);
    }

    let body = await http.bodyToJson(request);
    if (!misc.isJsonObject(body)) {
        throw new http.HttpError("expected a JSON object in the request body", 400);
    }

    let bucket_writes = [];
    bucket_writes.push(s3.quickUploadJson(pkeys.usage(project), { total: 0 }, env));

    let new_perms = { owners: [], uploaders: [] };
    if ('permissions' in body) {
        let req_perms = body.permissions;
        auth.validatePermissions(req_perms);
        for (const field of Object.keys(new_perms)) {
            if (field in req_perms) {
                new_perms[field] = req_perms[field];
            }
        }
    }
    bucket_writes.push(s3.quickUploadJson(permpath, new_perms, env));

    let new_quota = quot.defaults();
    if ('quota' in body) {
        let req_quota = body.quota;
        quot.validateQuota(req_quota);
        for (const field of Object.keys(new_quota)) {
            if (field in req_quota) {
                new_quota[field] = req_quota[field];
            }
        }
    }
    bucket_writes.push(s3.quickUploadJson(pkeys.quota(project), new_quota, env));

    await Promise.all(bucket_writes);
    return new Response(null, { status: 200 });
}
