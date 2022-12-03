import * as fs from "fs";
import * as crypto from "crypto";

export const S3Obj = {
    getSignedUrlPromise: async (operation, details) => {
        return "https://pretend-presigned-url/" + details.Key + "?expires_in=" + details.Expires;
    }
};

function computeHash(contents) {
    if (typeof contents == "string") {
        let enc = new TextEncoder;
        contents = enc.encode(contents);
    }
    return crypto.createHash('md5').update(contents).digest('hex');
}

const jsonmeta = {
    httpMetadata: { contentType: "application/json" }
};

export async function mockProjectVersion(project, version, files) {
    let promises = [];
    let base = project + "/" + version;

    let all_meta = [];
    for (const [rpath, contents] of Object.entries(files)) {
        promises.push(BOUND_BUCKET.put(base + "/" + rpath, contents));

        let meta = { 
            "$schema": "generic_file/v1.json",
            "generic_file": {
                "format": "text"
            },
            md5sum: computeHash(contents), 
            path: rpath 
        };
        all_meta.push(meta);

        promises.push(BOUND_BUCKET.put(base + "/" + rpath + ".json", JSON.stringify(meta), jsonmeta));
    }

    promises.push(BOUND_BUCKET.put("test-public/base/..aggregated", JSON.stringify(all_meta), jsonmeta)); 
    promises.push(BOUND_BUCKET.put("test-public/base/..revision",
        JSON.stringify({
            upload_time: (new Date).toISOString(),
            index_time: (new Date).toISOString()
        }),
        jsonmeta
    ));

    await Promise.all(promises);
    return all_meta;
}

export async function mockPublicProject() {
    let contents = "";
    for (var i = 1; i <= 100; i++) {
        contents += String(i) + "\n";
    }

    let payload = {
        "whee.txt": "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr\ns\nt\nu\nv\nw\nx\ny\nz\n",
        "blah.txt": "A\nB\nC\nD\nE\nF\nG\nH\nI\nJ\nK\nL\nM\nN\nO\nP\nQ\nR\nS\nT\nU\nV\nW\nX\nY\nZ\n",
        "foo/bar.txt": contents
    };
    await mockProjectVersion("test-public", "base", payload);

    payload["whee.txt"] = "Aaron Lun had a little lamb.";
    await mockProjectVersion("test-public", "modified", payload);

    let json_meta = {
        httpMetadata: { contentType: "application/json" }
    };

    // Adding project-level sundries.
    let latest = { version: "modified", index_time: (new Date).toISOString() };
    BOUND_BUCKET.put("test-public/..latest", JSON.stringify(latest), jsonmeta);
    BOUND_BUCKET.put("test-public/..latest_all", JSON.stringify(latest), jsonmeta);

    let perms = {
        scope: "project",
        read_access: "public",
        write_access: "owners",
        owners: ["ArtifactDB-bot"],
        viewers:[]
    };
    await BOUND_BUCKET.put("test-public/..permissions", JSON.stringify(perms), jsonmeta);

    return null;
}
