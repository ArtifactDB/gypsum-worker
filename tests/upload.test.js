import * as f_ from "../src/index.js";
import * as upload from "../src/upload.js";
import * as s3 from "../src/s3.js";
import * as gh from "../src/github.js";
import * as utils from "./utils.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    await setup.mockPublicProject();
    gh.enableTestRigging();
    s3.setS3ObjectDirectly(setup.S3Obj);
    gh.setToken(null); // forcibly nullify any token to avoid communication.
});

afterAll(() => {
    gh.enableTestRigging(false);
});

/******* Basic checks *******/

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
    let gh_test_rigging = gh.enableTestRigging();
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
    await Promise.all(nb);
    let posted = gh_test_rigging.postNewIssue[0];
    expect(posted.title).toEqual("purge project");

    // Check that a lock file was created with the right user name.
    let lckinfo = await BOUND_BUCKET.get("test-upload/test/..LOCK");
    let lckbody = await lckinfo.json();
    expect(lckbody.user_name).toEqual("ArtifactDB-bot");

    // Check that a version metadata file was posted to the bucket.
    let vinfo = await BOUND_BUCKET.get("test-upload/test/..manifest");
    let vbody = await vinfo.json();
    expect(vbody).toEqual(["WHEE", "BAR"]);
})

utils.testauth("initializeUploadHandler registers transient uploads correctly", async () => {
    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            filenames: [
                { check: "simple", filename: "WHEE", value: { md5sum: "a4caf5afa851da451e2161a4c3ac46bb" } },
                { check: "simple", filename: "BAR", value: { md5sum: "4209df9c96263664123450aa48fd1bfa" } }
            ],
            expires_in: "in 2 days"
        })
    });
    req.params = { project: "test-upload", version: "transient" };
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let nb = [];
    await upload.initializeUploadHandler(req, nb);
    await Promise.all(nb);        

    let expinfo = await BOUND_BUCKET.get("test-upload/transient/..expiry");
    let expbody = await expinfo.json();
    expect(expbody.expires_in).toBe(2*24*60*60*1000);
})

/******* Initialize link checks *******/

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

    // Checking that a link file is posted.
    await Promise.all(nb);
    let linkinfo = await BOUND_BUCKET.get("test-upload-md5sum-link/v2/..links");
    let linkbody = await linkinfo.json();
    expect(linkbody["blah.txt"]).toBe("test-upload-md5sum-link:blah.txt@test");
    expect("whee.txt" in linkbody).toBe(false);
    expect("foo/bar.txt" in linkbody).toBe(false);
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
    req.params = { project: "test-upload-id-link", version: "v2" };
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    // Checking that links are returned.
    let nb = [];
    let init = await upload.initializeUploadHandler(req, nb);
    let body = await init.json();

    expect(body.links.length).toBe(3);
    expect(body.links[0].filename).toBe("whee.txt");
    expect(body.links[0].url).toMatch(btoa("test-upload-id-link:whee.txt@v2"));
    expect(body.links[1].filename).toBe("blah.txt");
    expect(body.links[1].url).toMatch(btoa("test-upload-id-link:blah.txt@v2"));
    expect(body.links[2].filename).toBe("foo/bar.txt");
    expect(body.links[2].url).toMatch(btoa("test-upload-id-link:foo/bar.txt@v2"));

    // Checking that a link file is posted.
    await Promise.all(nb);
    let linkinfo = await BOUND_BUCKET.get("test-upload-id-link/v2/..links");
    let linkbody = await linkinfo.json();
    expect(linkbody["whee.txt"]).toBe("test-upload-id-link:whee.txt@test");
    expect(linkbody["blah.txt"]).toBe("test-upload-id-link:blah.txt@test");
    expect(linkbody["foo/bar.txt"]).toBe("test-upload-id-link:foo/bar.txt@test");
})

utils.testauth("initializeUploadHandler prohibits invalid links to missing files", async () => {
    let payload = setup.mockFiles();
    await setup.mockProjectVersion("test-upload-id-link-missing", "v1", payload);
    await setup.dumpProjectSundries("test-upload-id-link-missing", "v1");

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            filenames: [
                { check: "link", filename: "whee2.txt", value: { artifactdb_id: "test-upload-id-link-missing:whee2.txt@v1" } }
            ]
        })
    });
    req.params = { project: "test-upload-id-link-missing", version: "v2" };
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let nb = [];
    await utils.expectError(upload.initializeUploadHandler(req, nb), "does not exist");
})

utils.testauth("initializeUploadHandler prohibits links to unauthorized projects", async () => {
    let payload = setup.mockFiles();
    await setup.mockProjectVersion("test-upload-id-link-private", "test", payload);
    await setup.dumpProjectSundries("test-upload-id-link-private", "test", false);

    // Putting some manual permissions in there.
    let perms = setup.definePermissions(["SomeoneElse"], [], false);
    await BOUND_BUCKET.put("test-upload-id-link-private/..permissions", JSON.stringify(perms), setup.jsonmeta);

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            filenames: [
                { check: "link", filename: "whee.txt", value: { artifactdb_id: "test-upload-id-link-private:whee.txt@test" } }
            ]
        })
    });
    req.params = { project: "test-upload-id-link-private2", version: "v1" };
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    // Fails without access to the linked project.
    let nb = [];
    await utils.expectError(upload.initializeUploadHandler(req, nb), "'test-upload-id-link-private'");
})

utils.testauth("initializeUploadHandler prohibits invalid links to transient projects", async () => {
    let payload = setup.mockFiles();
    await setup.mockProjectVersion("test-upload-id-link-expiry", "test", payload);
    await setup.dumpProjectSundries("test-upload-id-link-expiry", "test");

    // Injecting an expiry file.
    await BOUND_BUCKET.put("test-upload-id-link-expiry/test/..expiry", JSON.stringify({ expires_in: 100 }), setup.jsonmeta);

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            filenames: [
                { check: "link", filename: "whee.txt", value: { artifactdb_id: "test-upload-id-link-expiry:whee.txt@test" } }
            ]
        })
    });
    req.params = { project: "test-upload-id-link-expiry", version: "v2" };
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let nb = [];
    await utils.expectError(upload.initializeUploadHandler(req, nb), "detected links to a transient project");
})

/******* Create link checks *******/

utils.testauth("createLinkHandler works correctly", async () => {
    let all_links = [
        { check: "link", filename: "whee.txt", value: { artifactdb_id: "test-public:whee.txt@base" } },
        { check: "link", filename: "blah.txt", value: { artifactdb_id: "test-public:blah.txt@base" } },
        { check: "link", filename: "foo/bar.txt", value: { artifactdb_id: "test-public:foo/bar.txt@base" } },
    ];

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ filenames: all_links })
    });
    req.params = { project: "test-upload-id-link-create", version: "first" };
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let nb = [];
    let init = await upload.initializeUploadHandler(req, nb);
    let body = await init.json();
    await Promise.all(nb);

    // Hitting all the links.
    expect(body.links.length).toBe(3);
    for (const x of body.links) {
        let paths = x.url.split("/");
        let req = new Request("http://localhost");
        req.params = { source: paths[2], target: paths[4] };
        req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());
        let res = await upload.createLinkHandler(req, nb);
        expect(res.status).toBe(202);
    }

    // Checking that a link file is actually created.
    for (const info of all_links) {
        let x = info.filename;
        let check = await BOUND_BUCKET.get("test-upload-id-link-create/first/" + x);
        let expected_id = "test-public:" + x + "@base";
        expect(check.customMetadata.artifactdb_id).toBe(expected_id);
        let body = await check.json();
        expect(body.artifactdb_id).toBe(expected_id);
    }
})

utils.testauth("createLinkHandler throws the right errors", async () => {
    let req = new Request("http://localhost");
    req.params = { source: btoa("foo:whee.txt@1"), target: btoa("test-public:whee.txt@base") };

    let nb = [];
    await utils.expectError(upload.createLinkHandler(req, nb), "user identity");

    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());
    await utils.expectError(upload.createLinkHandler(req, nb), "not been previously locked");
})

/******* Complete uploads checks *******/

utils.testauth("completeUploadHandler works correctly", async () => {
    // Initializing the upload.
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ 
                filenames: [
                    { check: "simple", filename: "WHEE", value: { md5sum: "a4caf5afa851da451e2161a4c3ac46bb" } },
                    { check: "simple", filename: "BAR", value: { md5sum: "4209df9c96263664123450aa48fd1bfa" } }
                ]
            })
        });
        req.params = { project: "test-complete-upload", version: "test" };
        req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

        let nb = [];
        await upload.initializeUploadHandler(req, nb);
        await Promise.all(nb);
    }

    // Completing the upload.
    let req = new Request("http://localhost", { method: "POST", body: "{}" });
    req.params = { project: "test-complete-upload", version: "test" };
    req.query = {};
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let nb = [];
    let gh_test_rigging = gh.enableTestRigging();
    let res = await upload.completeUploadHandler(req, nb);

    let body = await res.json();
    expect(body.job_id).toBe(-1); // placeholder number, used for testing.
    let postinfo = gh_test_rigging.postNewIssue[0];
    expect(postinfo.title).toBe("upload complete");
    let postbody = JSON.parse(postinfo.body);
    expect(postbody.project).toBe("test-complete-upload");
    expect(postbody.permissions.read_access).toBe("public");
    expect(postbody.permissions.owners).toEqual(["ArtifactDB-bot"]);
})

utils.testauth("completeUploadHandler works correctly with custom permissions", async () => {
    // Initializing the upload.
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ 
                filenames: [
                    { check: "simple", filename: "WHEE", value: { md5sum: "a4caf5afa851da451e2161a4c3ac46bb" } },
                    { check: "simple", filename: "BAR", value: { md5sum: "4209df9c96263664123450aa48fd1bfa" } }
                ]
            })
        });
        req.params = { project: "test-complete-upload2", version: "test" };
        req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

        let nb = [];
        await upload.initializeUploadHandler(req, nb);
        await Promise.all(nb);
    }

    // Completing the upload.
    let req = new Request("http://localhost", { method: "POST", body: '{ "read_access": "viewers", "owners": [ "LTLA" ] }' });
    req.params = { project: "test-complete-upload2", version: "test" };
    req.query = {};
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let nb = [];
    let gh_test_rigging = gh.enableTestRigging();
    let res = await upload.completeUploadHandler(req, nb);

    let postinfo = gh_test_rigging.postNewIssue[0];
    expect(postinfo.title).toBe("upload complete");
    let postbody = JSON.parse(postinfo.body);
    expect(postbody.project).toBe("test-complete-upload2");
    expect(postbody.permissions.read_access).toBe("viewers");
    expect(postbody.permissions.owners).toEqual(["LTLA"]);
})

utils.testauth("completeUploadHandler throws the right errors", async () => {
    let req = new Request("http://localhost", { method: "POST", body: '{ "read_access": "FOOABLE" }' });
    req.params = { project: "test-complete-check", version: "WHEE" };

    // First attempt without identity.
    let nb = [];
    await utils.expectError(upload.completeUploadHandler(req, nb), "user identity");

    // Trying again after adding headers.
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());
    await utils.expectError(upload.completeUploadHandler(req, nb), "not been previously locked");

    // Forcing a lock file.
    await BOUND_BUCKET.put("test-complete-check/WHEE/..LOCK", '{ "user_name": "ArtifactDB-bot" }')
    await utils.expectError(upload.completeUploadHandler(req, nb), "invalid request body");
})

utils.testauth("queryJobHandler works correctly", async () => {
    let req = new Request("http://localhost", { method: "POST", body: '{ "read_access": "FOOABLE" }' });
    req.params = { jobid: "-1" };

    // PENDING
    {
        let gh_test_rigging = gh.enableTestRigging();
        gh_test_rigging.getIssue["-1"] = { "state": "open", "comments": 0 };

        let nb = [];
        let res = await upload.queryJobIdHandler(req, nb);
        expect(res.status).toBe(200);
        let body = await res.json();
        expect(body.status).toBe("PENDING");
    }

    // SUCCESS
    {
        let gh_test_rigging = gh.enableTestRigging();
        gh_test_rigging.getIssue["-1"] = { "state": "closed", "comments": 0 };

        let nb = [];
        let res = await upload.queryJobIdHandler(req, nb);
        expect(res.status).toBe(200);
        let body = await res.json();
        expect(body.status).toBe("SUCCESS");
    }

    // FAILURE 
    {
        let gh_test_rigging = gh.enableTestRigging();
        gh_test_rigging.getIssue["-1"] = { "state": "open", "comments": 10 };

        let nb = [];
        let res = await upload.queryJobIdHandler(req, nb);
        expect(res.status).toBe(200);
        let body = await res.json();
        expect(body.status).toBe("FAILURE");
    }
})

utils.testauth("abortUploadHandler works correctly", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-abort-upload", version: "test" };

    // First attempt without headers.
    let nb = [];
    await utils.expectError(upload.abortUploadHandler(req, nb), "user identity");

    // Trying again after adding headers.
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());
    await utils.expectError(upload.abortUploadHandler(req, nb), "not been previously locked");

    // Forcing a lock file.
    await BOUND_BUCKET.put("test-abort-upload/test/..LOCK", '{ "user_name": "ArtifactDB-bot" }')
    let res = await upload.abortUploadHandler(req, nb);
    expect(res.status).toBe(202);
})
