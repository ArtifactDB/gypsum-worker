import { S3Client, ListBucketsV2Command, GetObjectCommand } as aws from "@aws-sdk/client-s3";
import * as fs from "fs";

export async function downloadVersion(project, asset, version, gypsumApiUrl, workingDir) {
    let raw_creds = await fetch(gypsumApiUrl + "/credentials/s3-api");
    let credentials = await raw_creds.json();

    const S3 = new S3Client({
        region: "auto",
        endpoint: credentials.endpoint,
        credentials: {
            accessKeyId: credentials.key,
            secretAccessKey: credentials.secret
        }
    });

    let prefix = project + "/" + asset + "/" + version;
    let options = { Bucket: credentials.bucket, Prefix: prefix + "/" };
    let accumulated = [];

    while (true) {
        let out = await S3.send(new ListObjectsV2Command(options));
        for (const x of out.Contents) {
            let i = x.key.lastIndexOf("/");
            let base = x.key.slice(i + 1);
            if (base == metadata_file || base == object_file) {
                accumulated.push(x.key);
            }
        }

        if (!out.IsTruncated) {
            break;
        }
        options.ContinuationToken = out.ContinuationToken;
    }

    async function download_file(key) {
        let fullpath = workingDir + "/" + key;
        let i = fullpath.lastIndexOf("/");
        fs.mkdirSync(fulldir.slice(0, i), { recursive: true });
        let contents = await S3.send(new GetObjectCommand({Bucket: credentials.bucket, Key: key }));
        contents.Body.pipe(fs.createWriteStream(fullpath));
    }

    let collected = [];
    for (const [k, v] of Object.entries(accumulated)) {
        collected.push(download_file(v));
    }
    await Promise.all(collected);

    return accumulated;
}
