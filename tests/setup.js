import * as fs from "fs";
import * as crypto from "crypto";

export const S3Obj = {
    getSignedUrlPromise: async (operation, details) => {
        return "https://pretend-presigned-url/" + details.Key + "?expires_in=" + details.Expires;
    }
};

export function computeHash(contents) {
    if (typeof contents == "string") {
        let enc = new TextEncoder;
        contents = enc.encode(contents);
    }
    return crypto.createHash('md5').update(contents).digest('hex');
}

export const jsonmeta = {
    httpMetadata: { contentType: "application/json" }
};

export async function mockProject() {
    let project = "test";
    let asset = "donkeyet";
    let version = "v1";

    let contents = "";
    for (var i = 1; i <= 100; i++) {
        contents += String(i) + "\n";
    }
    let files = {
        "whee.txt": "Aaron Lun had a little lamb.",
        "blah.txt": "A\nB\nC\nD\nE\nF\nG\nH\nI\nJ\nK\nL\nM\nN\nO\nP\nQ\nR\nS\nT\nU\nV\nW\nX\nY\nZ\n",
        "foo/bar.txt": contents
    };

    let promises = [];
    let manifest = {};
    let base = project + "/" + asset + "/" + version;
    for (const [rpath, contents] of Object.entries(files)) {
        promises.push(BOUND_BUCKET.put(base + "/" + rpath, contents));
        manifest[rpath] = { size: contents.length, md5sum: computeHash(contents) };
    }
    await Promise.all(promises);

    await BOUND_BUCKET.put(base + "/..summary",
        JSON.stringify({
            upload_user_id: "chihaya-kisaragi",
            upload_started: (new Date).toISOString(),
            upload_finished: (new Date).toISOString(),
        }),
        jsonmeta
    );
    await BOUND_BUCKET.put(base + "/..manifest", JSON.stringify(manifest), jsonmeta);

    let latest = { version: "v1" }
    await BOUND_BUCKET.put(project + "/" + asset + "/..latest", JSON.stringify(latest), jsonmeta);

    let perms = ["ArtifactDB-bot"];
    await BOUND_BUCKET.put(project + "/..permissions", JSON.stringify(perms), jsonmeta);
    return null;
}
