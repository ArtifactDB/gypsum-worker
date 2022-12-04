import S3 from 'aws-sdk/clients/s3.js';

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
    s3_object = new S3({
        endpoint: "https://" + account_id + ".r2.cloudflarestorage.com",
        accessKeyId: access_key,
        secretAccessKey: secret_key,
        signatureVersion: 'v4',
    });
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
