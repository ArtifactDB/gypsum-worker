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

async function dumpVersionSundries(project, version, all_meta) {
    await BOUND_BUCKET.put(project + "/" + version + "/..aggregated", JSON.stringify(all_meta), jsonmeta); 
    await BOUND_BUCKET.put(project + "/" + version + "/..revision",
        JSON.stringify({
            uploader_name: "LTLA",
            upload_time: (new Date).toISOString(),
            index_time: (new Date).toISOString()
        }),
        jsonmeta
    );
    return;
}

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

    await Promise.all(promises);
    await dumpVersionSundries(project, version, all_meta);

    return all_meta;
}

export function mockFiles() {
    let contents = "";
    for (var i = 1; i <= 100; i++) {
        contents += String(i) + "\n";
    }
    return {
        "whee.txt": "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr\ns\nt\nu\nv\nw\nx\ny\nz\n",
        "blah.txt": "A\nB\nC\nD\nE\nF\nG\nH\nI\nJ\nK\nL\nM\nN\nO\nP\nQ\nR\nS\nT\nU\nV\nW\nX\nY\nZ\n",
        "foo/bar.txt": contents
    };
}

export function definePermissions(owners, viewers, isPublic) {
    return {
        scope: "project",
        read_access: (isPublic ? "public" : "viewers"),
        write_access: "owners",
        owners: owners,
        viewers: viewers
    };
}

export async function dumpProjectSundries(project, latestVersion, isPublic=true) {
    // Adding project-level sundries.
    let latest = { version: latestVersion, index_time: (new Date).toISOString() };
    await BOUND_BUCKET.put(project + "/..latest", JSON.stringify(latest), jsonmeta);
    await BOUND_BUCKET.put(project + "/..latest_all", JSON.stringify(latest), jsonmeta);

    let perms = definePermissions(["ArtifactDB-bot"], [], isPublic);
    await BOUND_BUCKET.put(project + "/..permissions", JSON.stringify(perms), jsonmeta);

    return;
}

export async function mockPublicProject() {
    let payload = mockFiles();
    await mockProjectVersion("test-public", "base", payload);

    payload["whee.txt"] = "Aaron Lun had a little lamb.";
    await mockProjectVersion("test-public", "modified", payload);

    await dumpProjectSundries("test-public", "modified");
    return null;
}

export async function mockPrivateProject() {
    let payload = mockFiles();
    await mockProjectVersion("test-private", "base", payload);
    await dumpProjectSundries("test-private", "base", false);
    return null;
}

export async function addRedirection(project, version, from, to, type="local") {
    let meta = {
        path: from,
        "$schema": "redirection/v1.json",
        redirection: {
            targets: [
                {
                    type: type,
                    location: to
                }
            ]
        }
    };
    await BOUND_BUCKET.put(project + "/" + version + "/" + from + ".json", JSON.stringify(meta), jsonmeta);
    return;
}

export async function mockLinkedProjectVersion(project, version, links) {
    let promises = [];
    let base = project + "/" + version;

    let all_meta = [];
    for (const [rpath, target] of Object.entries(links)) {
        let link = { artifactdb_id: target };
        promises.push(BOUND_BUCKET.put(base + "/" + rpath, JSON.stringify(link), { customMetadata: link }));

        let meta = { 
            "$schema": "generic_file/v1.json",
            "generic_file": {
                "format": "text"
            },
            md5sum: "dontcare",
            path: rpath 
        };
        all_meta.push(meta);

        promises.push(BOUND_BUCKET.put(base + "/" + rpath + ".json", JSON.stringify(meta), jsonmeta));
    }

    await Promise.all(promises);
    await dumpVersionSundries(project, version, all_meta);
    return all_meta;
}


