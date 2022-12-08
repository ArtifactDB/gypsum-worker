import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

var r2_bucket_name = "placeholder";
var s3_object = null;
var r2_binding = null;

export function setBucketName(name) {
    r2_bucket_name = name;
    return;
}

export function getBucketName() {
    return r2_bucket_name;
}

export function setS3Object(account_id, access_key, secret_key) {
    s3_object = { 
        client: new S3Client({
            endpoint: "https://" + account_id + ".r2.cloudflarestorage.com",
            credentials: {
                accessKeyId: access_key,
                secretAccessKey: secret_key
            },
            region: "auto"
        })
    };

    s3_object.getSignedUrlPromise = async (mode, params) => {
        let command;
        if (mode == 'getObject') {
            command = new GetObjectCommand({ Bucket: params.Bucket, Key: params.Key });
        } else {
            command = new PutObjectCommand({ Bucket: params.Bucket, Key: params.Key, ContentMD5: params.ContentMD5 });
        }
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
