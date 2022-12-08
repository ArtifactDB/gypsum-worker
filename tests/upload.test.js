import * as f_ from "../src/index.js";
import * as upload from "../src/upload.js";
import * as s3 from "../src/s3.js";
import * as gh from "../src/github.js";
import * as utils from "./utils.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    s3.setS3ObjectDirectly(setup.S3Obj);
    gh.setToken(null); // forcibly nullify any token to avoid communication.
});

utils.testauth("initializeUploadHandler throws the right errors", async () => {
    {
        let req = new Request("http://localhost");
        req.params = { project: "test/upload", version: "test" };
        let nb = [];
        await utils.expectError(upload.initializeUploadHandler(req, nb), "cannot contain");
    }

    {
        let req = new Request("http://localhost");
        req.params = { project: "test:upload", version: "test" };
        let nb = [];
        await utils.expectError(upload.initializeUploadHandler(req, nb), "cannot contain");
    }

    {
        let req = new Request("http://localhost");
        req.params = { project: "test-upload", version: "test@" };
        let nb = [];
        await utils.expectError(upload.initializeUploadHandler(req, nb), "cannot contain");
    }

    {
        let req = new Request("http://localhost");
        req.params = { project: "test-upload", version: "test" };
        let nb = [];
        await utils.expectError(upload.initializeUploadHandler(req, nb), "user identity");
    }

    {
        await setup.mockPublicProject();
        let req = new Request("http://localhost");
        req.params = { project: "test-public", version: "base" };
        req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());
        let nb = [];
        await utils.expectError(upload.initializeUploadHandler(req, nb), "already exists");
    }

    {
        // First request fails input schema validation.
        let req = new Request("http://localhost", { method: "POST", body: '{ "value": "WHEEE" }' });
        req.params = { project: "test-upload", version: "test" };
        req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());
        let nb = [];
        await utils.expectError(upload.initializeUploadHandler(req, nb), "invalid request body");

        // Trying again causes a lock failure.
        await utils.expectError(upload.initializeUploadHandler(req, nb), "already been locked");
    }

    {
        let req = new Request("http://localhost", { 
            method: "POST", 
            body: JSON.stringify({
                filenames: [
                    { check: "simple", filename: "WHEE/..foo", value: { md5sum: "a4caf5afa851da451e2161a4c3ac46bb" } },
                ]
            })
        });
        req.params = { project: "test-upload", version: "test2" };
        req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());
        let nb = [];
        await utils.expectError(upload.initializeUploadHandler(req, nb), "reserved '..' pattern");
    }
})

utils.testauth("initializeUploadHandler works correctly for simple uploads", async () => {
    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            filenames: [
                { check: "simple", filename: "WHEE", value: { md5sum: "a4caf5afa851da451e2161a4c3ac46bb" } },
                { check: "simple", filename: "BAR", value: { md5sum: "4209df9c96263664123450aa48fd1bfa" } }
            ]
        })
    });
    req.params = { project: "test-upload", version: "test" };
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let nb = [];
    let init = await upload.initializeUploadHandler(req, nb);
    let body = await init.json();

    expect(body.presigned_urls.length).toBe(2);
    expect(body.presigned_urls[0].filename).toBe("WHEE");
    expect(body.presigned_urls[0].url).toMatch("WHEE");
    expect(body.presigned_urls[0].md5sum.length).toBe(24);
    expect(body.presigned_urls[0].md5sum.endsWith("==")).toBe(true);

    expect(body.presigned_urls[1].filename).toBe("BAR");
    expect(body.presigned_urls[1].url).toMatch("BAR");
    expect(body.presigned_urls[1].md5sum.length).toBe(24);
    expect(body.presigned_urls[1].md5sum.endsWith("==")).toBe(true);

    expect(body.completion_url).toMatch("test-upload/version/test");
    expect(body.abort_url).toMatch("test-upload/version/test");

    // Check that the issue posting is done.
    let resolved = await Promise.all(nb);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved[resolved.length - 1].title).toEqual("purge project");

    // Check that a lock file was created with the right user name.
    let lckinfo = await BOUND_BUCKET.get("test-upload/test/..LOCK");
    let lckbody = await lckinfo.json();
    expect(lckbody.user_name).toEqual("ArtifactDB-bot");

    // Check that a version metadata file was posted to the bucket.
    let vinfo = await BOUND_BUCKET.get("test-upload/test/..manifest");
    let vbody = await vinfo.json();
    expect(vbody).toEqual(["WHEE", "BAR"]);
})

utils.testauth("initializeUploadHandler works correctly for MD5 deduplication", async () => {
    let payload = setup.mockFiles();
    await setup.mockProjectVersion("test-upload-md5sum-link", "test", payload);
    await setup.dumpProjectSundries("test-upload-md5sum-link", "test");

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            filenames: [
                { check: "simple", filename: "whee.txt", value: { md5sum: setup.computeHash(payload["whee.txt"]) } },
                { check: "md5", filename: "blah.txt", value: { field: "md5sum", md5sum: setup.computeHash(payload["blah.txt"]) } },
                { check: "md5", filename: "foo/bar.txt", value: { field: "md5sum", md5sum: "cannot_match_anything" } },
            ]
        })
    });
    req.params = { project: "test-upload-md5sum-link", version: "v2" };
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let nb = [];
    let init = await upload.initializeUploadHandler(req, nb);
    let body = await init.json();

    expect(body.presigned_urls.length).toBe(2);
    expect(body.presigned_urls[0].filename).toBe("whee.txt");
    expect(body.presigned_urls[1].filename).toBe("foo/bar.txt");

    expect(body.links.length).toBe(1);
    expect(body.links[0].filename).toBe("blah.txt");
    expect(body.links[0].url).toMatch(btoa("test-upload-md5sum-link:blah.txt@v2"));
})

utils.testauth("initializeUploadHandler works correctly for link-based deduplication", async () => {
    let payload = setup.mockFiles();
    await setup.mockProjectVersion("test-upload-id-link", "test", payload);
    await setup.dumpProjectSundries("test-upload-id-link", "test");

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            filenames: [
                { check: "link", filename: "whee.txt", value: { artifactdb_id: "test-upload-id-link:whee.txt@test" } },
                { check: "link", filename: "blah.txt", value: { artifactdb_id: "test-upload-id-link:blah.txt@test" } },
                { check: "link", filename: "foo/bar.txt", value: { artifactdb_id: "test-upload-id-link:foo/bar.txt@test" } },
            ]
        })
    });
    req.params = { project: "test-upload-md5sum-link", version: "v2" };
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let nb = [];
    let init = await upload.initializeUploadHandler(req, nb);
    let body = await init.json();

    expect(body.links.length).toBe(3);
    expect(body.links[0].filename).toBe("whee.txt");
    expect(body.links[0].url).toMatch(btoa("test-upload-md5sum-link:whee.txt@v2"));
    expect(body.links[1].filename).toBe("blah.txt");
    expect(body.links[1].url).toMatch(btoa("test-upload-md5sum-link:blah.txt@v2"));
    expect(body.links[2].filename).toBe("foo/bar.txt");
    expect(body.links[2].url).toMatch(btoa("test-upload-md5sum-link:foo/bar.txt@v2"));
})
