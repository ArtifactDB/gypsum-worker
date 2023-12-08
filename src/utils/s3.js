import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import * as http from "./http.js";
import * as misc from "./misc.js";

var r2_bucket_name = "placeholder";
var s3_object = null;
var r2_binding = null;
var s3_public_creds = null;

export function setBucketName(name) {
    r2_bucket_name = name;
    return;
}

export function getBucketName() {
    return r2_bucket_name;
}

function define_endpoint(account_id) {
    return "https://" + account_id + ".r2.cloudflarestorage.com";
}

export function setS3Object(account_id, access_key, secret_key) {
    s3_object = { 
        client: new S3Client({
            endpoint: define_endpoint(account_id),
            credentials: {
                accessKeyId: access_key,
                secretAccessKey: secret_key
            },
            region: "auto"
        })
    };

    s3_object.getSignedUrlPromise = async (mode, params) => {
        let command = new PutObjectCommand({ Bucket: params.Bucket, Key: params.Key, ContentMD5: params.ContentMD5 });
        return await getSignedUrl(s3_object.client, command, { expiresIn: params.Expires });
    }

    return;
}

export function setS3ObjectDirectly(s3obj) { // for testing purposes only.
    s3_object = s3obj;
    return;
}

export function getS3Object() {
    return s3_object;
}

export function setR2Binding(bucket) {
    r2_binding = bucket;
    return;
}

export function getR2Binding(bucket) {
    return r2_binding;
}

export function setPublicS3Credentials(account_id, bucket_name, public_key, public_secret) {
    s3_public_creds = {
        endpoint: define_endpoint(account_id),
        bucket: bucket_name,
        key: public_key,
        secret: public_secret
    };
    return;
}

export function getPublicS3Credentials() {
    return s3_public_creds;
}

export async function quickUploadJson(path, value, custom = null) {
    let meta = {
        httpMetadata: { contentType: "application/json" }
    };

    if (custom !== null) {
        meta.customMetadata = custom;
    }

    if ((await r2_binding.put(path, JSON.stringify(value), meta)) == null) {
        throw new http.HttpError("failed to upload '" + path + "'", 500);
    }
}

export async function quickFetchJson(path, mustWork = true) {
    let payload = await r2_binding.get(path);
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

export async function listApply(prefix, op, { namesOnly = true, trimPrefix = true, local = false, list_limit = 1000 } = {}) {
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
        let listing = await r2_binding.list(list_options);

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

export async function quickRecursiveDelete(prefix, { list_limit = 1000 } = {}) {
    let deletions = [];
    let freed = 0;
    await listApply(
        prefix, 
        f => {
            deletions.push(r2_binding.delete(f.key));
            if (!misc.isInternalPath(f.key)) {
                freed += f.size;
            }
        },
        { list_limit: list_limit, namesOnly: false }
    );
    await Promise.all(deletions);
    return freed;
}
