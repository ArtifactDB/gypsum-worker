import { S3Client, ListBucketsV2Command, GetObjectCommand } as aws from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as ajv from "ajv";

const api = "https://gypsum-test.aaron-lun.workers.dev";
let raw_creds = await fetch(api + "/credentials/s3-api");
let credentials = await raw_creds.json();

const S3 = new S3Client({
    region: "auto",
    endpoint: credentials.endpoint,
    credentials: {
        accessKeyId: credentials.key,
        secretAccessKey: credentials.secret
    }
});

const workspace = "WORKSPACE";

let prefix = "test-R/basic/v3"
const metadata_file = "_metadata.json";
const object_file = "OBJECT";

let okay_file = workspace + "/" + prefix + "/COMPLETED";
if (!fs.existsSync(okay_file)) {
    // Identifying the files to download.
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

    // Finding useful pairs.
    async function download_file(key) {
        let fullpath = workspace + "/" + key;
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
    fs.writeFileSync(okay_file, "");
}

// Listing out all the files we just downloaded.
let pairs = {};
function list_files(dir, sofar="") {
    let out = fs.readdirSync(dir);
    let nextdir = sofar;
    if (nextdir != "") {
        nextdir += "/";
    }

    for (const f of out) {
        if (f.isDirectory()) {
            list_files(path.resolve(dir, f.name), nextdir + f.name); 
        } else if (f.name == metadata_file || f.name == object_file) {
            if (!(sofar in pairs)) {
                pairs[sofar] = new Set;
            }
            pairs[sofar].add(f.name);
        }
    }
}

// Scanning through them and validating them.
for (const [k, v] of Object.entries(pairs)) {
    if (!v.has(metadata_file)) {
        throw new Error("detected '" + object_file + "' without '" + metadata_file + "' at '" + k + "'");
    } else if (!v.has(object_file)) {
        throw new Error("detected '" + metadata_file + "' without '" + object_file + "' at '" + k + "'");
    }

    let meta = JSON.parse(fs.readFileSync(workspace + "/" + k + "/" + metadata_file, "utf8"));
    let obj = fs.readFileSync(workspace + "/" + k + "/" + object_file, "utf8");
}
