import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as http from "./http.js";
import * as misc from "./misc.js";

function define_endpoint(account_id) {
    return "https://" + account_id + ".r2.cloudflarestorage.com";
}

var s3_object = null;

export function setS3ObjectDirectly(s3obj) { // for testing purposes only.
    s3_object = s3obj;
    return;
}

export function getS3Object(env) {
    if (s3_object === null) {
        s3_object = { 
            client: new S3Client({
                endpoint: define_endpoint(env.CF_ACCOUNT_ID),
                credentials: {
                    accessKeyId: env.ACCESS_KEY_ID,
                    secretAccessKey: env.SECRET_ACCESS_KEY
                },
                region: "auto"
            })
        };

        s3_object.getSignedUrlPromise = async (mode, params) => {
            let command = new PutObjectCommand({ Bucket: params.Bucket, Key: params.Key, ContentMD5: params.ContentMD5 });
            return await getSignedUrl(s3_object.client, command, { expiresIn: params.Expires });
        }
    }
    return s3_object;
}

export function getPublicS3Credentials(env) {
    return {
        endpoint: define_endpoint(env.CF_ACCOUNT_ID),
        bucket: env.R2_BUCKET_NAME,
        key: env.PUBLIC_S3_KEY,
        secret: env.PUBLIC_S3_SECRET
    };
}

export async function quickUploadJson(path, value, env, custom = null) {
    let meta = {
        httpMetadata: { contentType: "application/json" }
    };

    if (custom !== null) {
        meta.customMetadata = custom;
    }

    if ((await env.BOUND_BUCKET.put(path, JSON.stringify(value), meta)) == null) {
        throw new http.HttpError("failed to upload '" + path + "'", 500);
    }
}

export async function quickFetchJson(path, env, mustWork = true) {
    let payload = await env.BOUND_BUCKET.get(path);
    if (payload == null) {
        if (mustWork) {
            // 500 error because these are internal files that SHOULD exist.
            throw new http.HttpError("no file at '" + path + "'", 500);
        } else {
            return null;
        }
    }

    try {
        return await payload.json();
    } catch (e) {
        throw new http.HttpError("failed to parse JSON; " + e.message, 500);
    }
}

export async function listApply(prefix, op, env, { namesOnly = true, trimPrefix = true, local = false, list_limit = 1000 } = {}) {
    let list_options = { limit: list_limit };
    if (prefix != null) {
        list_options.prefix = prefix;
    } else {
        trimPrefix = false; // nothing to trim.
    }
    if (local) {
        list_options.delimiter = "/";
    }

    let truncated = true;
    while (true) {
        let listing = await env.BOUND_BUCKET.list(list_options);

        if (local) {
            if (trimPrefix) {
                listing.delimitedPrefixes.forEach(p => op(p.slice(prefix.length, p.length - 1))); // remove the prefix and the slash.
            } else {
                listing.delimitedPrefixes.forEach(p => op(p.slice(0, p.length - 1))); // remove the trailing slash.
            }
        } 

        if (namesOnly || local) {
            if (trimPrefix) {
                listing.objects.forEach(f => op(f.key.slice(prefix.length)));
            } else {
                listing.objects.forEach(f => op(f.key));
            }
        } else {
            listing.objects.forEach(op);
        }

        truncated = listing.truncated;
        if (truncated) {
            list_options.cursor = listing.cursor;
        } else {
            break;
        }
    }
}

export async function quickRecursiveDelete(prefix, env, { list_limit = 1000 } = {}) {
    let deletions = [];
    let freed = 0;
    await listApply(
        prefix, 
        f => {
            deletions.push(env.BOUND_BUCKET.delete(f.key));
            if (!misc.isInternalPath(f.key)) {
                freed += f.size;
            }
        },
        env,
        { list_limit: list_limit, namesOnly: false }
    );
    await Promise.all(deletions);
    return freed;
}
