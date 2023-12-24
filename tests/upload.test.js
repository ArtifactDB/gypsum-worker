import * as upload from "../src/upload.js";
import * as create from "../src/create.js";
import * as pkeys from "../src/utils/internal.js";
import * as gh from "../src/utils/github.js";
import * as s3 from "../src/utils/s3.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    const env = getMiniflareBindings();
    let rigging = gh.enableTestRigging(env);
    setup.mockGitHubIdentities(rigging);
    s3.setS3ObjectDirectly(setup.S3Obj);
});

afterAll(() => {
    gh.enableTestRigging(false);
});

/******* Basic checks *******/

test("initializeUploadHandler throws the right errors related to formatting", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);

    let nb = [];
    let req = new Request("http://localhost");

    req.params = { project: "test/upload", asset: "foo", version: "v1" };
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot contain");
    req.params = { project: "..test-upload", asset: "foo", version: "v1" };
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "start with");
    req.params = { project: "", asset: "foo", version: "v1" };
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "be empty");

    req.params = { project: "test-upload", asset: "foo/bar", version: "v1" };
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot contain");

    req.params = { project: "test-upload", asset: "foobar", version: "v/1" };
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot contain");

    let create_req = body => {
        let req = new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
        req.params = { project: "test-upload", asset: "foobar", version: "v1" };
        req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
        return req;
    };

    req = create_req(2);
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "JSON object");

    req = create_req({ on_probation: 2 });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'on_probation' property to be a boolean");

    req = create_req({ files: "foo" });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files' property to be an array");

    req = create_req({ files: [ "foo" ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files' should be an array of objects");

    req = create_req({ files: [ { "path": 2 } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files.path' should be a string");

    req = create_req({ files: [ { "path": "" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot be empty");

    req = create_req({ files: [ { "path": "..asdasd" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot start with");

    req = create_req({ files: [ { "path": "yay/..asdasd" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot start with");

    req = create_req({ files: [ { "path": "/asd" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot start or end with '/'");

    req = create_req({ files: [ { "path": "asdad//asdasd" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot contain repeated '/'");

    req = create_req({ files: [ { "path": "asdad\\asdasd" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot contain '\\'");

    req = create_req({ files: [ { "path": "asdasd" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files.type' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "simple" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files.md5sum' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "simple", "md5sum": "YAY", "size": "YAY"} ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files.size' should be a non-negative integer");

    req = create_req({ files: [ { "path": "asdasd", "type": "simple", "md5sum": "YAY", "size": 1.5} ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files.size' should be a non-negative integer");

    req = create_req({ files: [ { "path": "asdasd", "type": "simple", "md5sum": "YAY", "size": -100} ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files.size' should be a non-negative integer");

    req = create_req({ files: [ { "path": "asdasd", "type": "link" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files.link' should be an object");

    req = create_req({ files: [ { "path": "asdasd", "type": "link", "link": { } } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files.link.project' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "link", "link": { "project": "YAY" } } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files.link.asset' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "link", "link": { "project": "YAY", "asset": "asdasd" } } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files.link.version' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "link", "link": { "project": "YAY", "asset": "asdasd", "version": "foo" } } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "'files.link.path' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "urmom" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "invalid 'files.type'");
})

test("initializeUploadHandler throws the right errors for permission-related errors", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);
    let options = { method: "POST", body: JSON.stringify({ files: [] }) };

    {
        let req = new Request("http://localhost", options);
        req.params = { project: "test-upload", asset: "palms", version: "test" };
        let nb = [];
        await setup.expectError(upload.initializeUploadHandler(req, env, nb), "user identity");
    }

    {
        let req = new Request("http://localhost", options);
        req.params = { project: "test-upload", asset: "palms", version: "test" };
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        let nb = [];
        await setup.expectError(upload.initializeUploadHandler(req, env, nb), "not authorized to upload");
    }

    await env.BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [ { id: "RandomDude", version: "foo" } ] }));
    {
        let req = new Request("http://localhost", options);
        req.params = { project: "test-upload", asset: "palms", version: "test" };
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        let nb = [];
        await setup.expectError(upload.initializeUploadHandler(req, env, nb), "not authorized to upload");
    }
})

test("initializeUploadHandler throws the right errors for invalid project names", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);
    let options = { method: "POST", body: JSON.stringify({ files: [] }) };

    let req = new Request("http://localhost", options);
    req.params = { project: "test/upload", asset: "palms", version: "test" };
    let nb = [];
    req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "project name cannot contain");

    req.params = { project: "test-upload", asset: "foo\\bar", version: "test" };
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "asset name cannot contain");

    req.params = { project: "test-upload", asset: "foo-bar", version: "..test" };
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "version name cannot start with");

    req.params = { project: "test-upload", asset: "foo-bar", version: "" };
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "version name cannot be empty");
})

test("initializeUploadHandler works correctly for simple uploads", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "simple", path: "WHEE", md5sum: "a4caf5afa851da451e2161a4c3ac46bb", size: 100 },
                { type: "simple", path: "BAR", md5sum: "4209df9c96263664123450aa48fd1bfa", size: 23 }
            ]
        })
    });
    req.params = { project: "test-upload", asset: "blob", version: "v0" };
    req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

    let init = await upload.initializeUploadHandler(req, env, []);
    let body = await init.json();

    expect(body.file_urls.length).toBe(2);
    expect(body.file_urls[0].path).toBe("WHEE");
    expect(body.file_urls[0].url).toMatch("presigned-file");
    expect(body.file_urls[1].path).toBe("BAR");
    expect(body.file_urls[1].url).toMatch("presigned-file");

    expect(body.complete_url).toMatch(/complete.*test-upload/);
    expect(body.abort_url).toMatch(/abort.*test-upload/);

    // Check that a lock file was correctly created.
    let lckinfo = await env.BOUND_BUCKET.get("test-upload/..LOCK");
    let lckbody = await lckinfo.json();
    expect(typeof lckbody.session_hash).toEqual("string");
    expect(lckbody.version).toEqual("v0");

    // Check that the usage file was updated.
    let usinfo = await env.BOUND_BUCKET.get("test-upload/..usage");
    let usbody = await usinfo.json();
    expect(usbody["~pending_on_complete_only"]).toEqual(123);

    // Check that a version summary file was posted to the bucket.
    let sinfo = await env.BOUND_BUCKET.get("test-upload/blob/v0/..summary");
    let sbody = await sinfo.json();
    expect(sbody.upload_user_id).toEqual("ProjectOwner");
    expect(Number.isNaN(Date.parse(sbody.upload_start))).toBe(false);
    expect(sbody.on_probation).toEqual(false);

    // Check that a version manifest file was posted to the bucket.
    let vinfo = await env.BOUND_BUCKET.get("test-upload/blob/v0/..manifest");
    let vbody = await vinfo.json();
    expect(vbody["WHEE"]).toEqual({ size: 100, md5sum: "a4caf5afa851da451e2161a4c3ac46bb" });
    expect(vbody["BAR"]).toEqual({ size: 23, md5sum: "4209df9c96263664123450aa48fd1bfa" });
})

test("initializeUploadHandler converts MD5'able files to simple uploads if no prior version exists", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "dedup", path: "WHEE", md5sum: "a4caf5afa851da451e2161a4c3ac46bb", size: 100 },
                { type: "dedup", path: "BAR", md5sum: "4209df9c96263664123450aa48fd1bfa", size: 23 }
            ]
        })
    });
    req.params = { project: "test-upload", asset: "blob", version: "v0" };
    req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

    let init = await upload.initializeUploadHandler(req, env, []);
    let body = await init.json();

    expect(body.file_urls.length).toBe(2);
    expect(body.file_urls[0].path).toBe("WHEE");
    expect(body.file_urls[0].url).toMatch("presigned-file");
    expect(body.file_urls[1].path).toBe("BAR");
    expect(body.file_urls[1].url).toMatch("presigned-file");
})

test("initializeUploadHandler works correctly for MD5'able uploads with a prior version", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);
    let payload = await setup.mockProjectVersion("test-upload", "linker", "v0", env);

    let whee_md5 = setup.computeHash(payload["whee.txt"]);
    let whee_size = payload["whee.txt"].length;
    let blah_md5 = setup.computeHash(payload["blah.txt"]);
    let blah_size = payload["blah.txt"].length;

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "simple", path: "carbs/rice.txt", md5sum: whee_md5, size: whee_size }, // respects explicit request to avoid deduplication.
                { type: "dedup", path: "carbs/bread.txt", md5sum: whee_md5, size: whee_size },
                { type: "dedup", path: "carbs/beans.txt", md5sum: blah_md5, size: blah_size },
                { type: "dedup", path: "fruit/apple.txt", md5sum: blah_md5, size: blah_size * 10 },
                { type: "dedup", path: "fruit/orange.txt", md5sum: "cannot_match_anything", size: 1 },
            ]
        })
    });
    req.params = { project: "test-upload", asset: "linker", version: "v1" };
    req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

    let nb = [];
    let init = await upload.initializeUploadHandler(req, env, nb);
    let body = await init.json();

    expect(body.file_urls.length).toBe(3);
    expect(body.file_urls[0].path).toBe("carbs/rice.txt");
    expect(body.file_urls[1].path).toBe("fruit/apple.txt");
    expect(body.file_urls[2].path).toBe("fruit/orange.txt");

    // Checking that the manifest contains links.
    let vinfo = await env.BOUND_BUCKET.get("test-upload/linker/v1/..manifest");
    let vbody = await vinfo.json();
    expect("carbs/rice.txt" in vbody).toBe(true);
    expect("fruit/apple.txt" in vbody).toBe(true);
    expect("fruit/orange.txt" in vbody).toBe(true);
    expect(vbody["carbs/bread.txt"]).toEqual({ md5sum: whee_md5, size: whee_size, link: { project: "test-upload", asset: "linker", version: "v0", path: "whee.txt" } });
    expect(vbody["carbs/beans.txt"]).toEqual({ md5sum: blah_md5, size: blah_size, link: { project: "test-upload", asset: "linker", version: "v0", path: "blah.txt" } });
})

test("initializeUploadHandler works correctly for link-based deduplication", async () => {
    const env = getMiniflareBindings();
    let payload = await setup.simpleMockProject(env);
    let whee_md5 = setup.computeHash(payload["whee.txt"]);
    let whee_size = payload["whee.txt"].length;
    let blah_md5 = setup.computeHash(payload["blah.txt"]);
    let blah_size = payload["blah.txt"].length;
    let foobar_md5 = setup.computeHash(payload["foo/bar.txt"]);
    let foobar_size = payload["foo/bar.txt"].length;

    // Performing a new upload.
    await setup.createMockProject("test-upload", env);

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "link", path: "pet/rabbit.txt", link: { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" } },
                { type: "link", path: "pet/cat.txt", link: { project: "test", asset: "blob", version: "v1", path: "whee.txt" } },
                { type: "link", path: "pet/dog.txt", link: { project: "test", asset: "blob", version: "v1", path: "blah.txt" } }
            ]
        })
    });
    req.params = { project: "test-upload", asset: "linker", version: "v1" };
    req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

    // Checking that no links are returned.
    let nb = [];
    let init = await upload.initializeUploadHandler(req, env, nb);
    let body = await init.json();
    expect(body.file_urls.length).toBe(0);

    // Checking that a link file is posted.
    let vinfo = await env.BOUND_BUCKET.get("test-upload/linker/v1/..manifest");
    let vbody = await vinfo.json();
    expect(vbody["pet/rabbit.txt"]).toEqual({ md5sum: foobar_md5, size: foobar_size, link: { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" } });
    expect(vbody["pet/cat.txt"]).toEqual({ md5sum: whee_md5, size: whee_size, link: { project: "test", asset: "blob", version: "v1", path: "whee.txt" } });
    expect(vbody["pet/dog.txt"]).toEqual({ md5sum: blah_md5, size: blah_size, link: { project: "test", asset: "blob", version: "v1", path: "blah.txt" } });
})

test("initializeUploadHandler handles ancestral links correctly", async () => {
    const env = getMiniflareBindings();
    await setup.simpleMockProject(env);

    let nb = [];

    // Performing a series of uploads.
    for (var i = 2; i < 5; i++) {
        let linkversion = "v" + String(i-1);
        let ireq = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ 
                files: [
                    { type: "link", path: "foo/bar.txt", link: { project: "test", asset: "blob", version: linkversion, path: "foo/bar.txt" } },
                    { type: "link", path: "whee.txt", link: { project: "test", asset: "blob", version: linkversion, path: "whee.txt" } },
                    { type: "link", path: "blah.txt", link: { project: "test", asset: "blob", version: linkversion, path: "blah.txt" } }
                ]
            })
        });

        let myversion = "v" + String(i);
        ireq.params = { project: "test", asset: "blob", version: myversion };
        ireq.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
        let init = await upload.initializeUploadHandler(ireq, env, nb);

        let creq = new Request("http://localhost", { method: "POST" });
        creq.params = { project: "test", asset: "blob", version: myversion };
        creq.headers.set("Authorization", "Bearer " + (await init.json()).session_token);
        await upload.completeUploadHandler(creq, env, nb);
    }

    // Checking that the manifests have ancestral information 
    const paths = ["foo/bar.txt", "whee.txt", "blah.txt"];
    {
        let vinfo = await env.BOUND_BUCKET.get("test/blob/v2/..manifest");
        let vbody = await vinfo.json();
        for (const p of paths) {
            expect(vbody[p].link).toEqual({ project: "test", asset: "blob", version: "v1", path: p });
        }
    }

    for (var v = 3; v < 5; v++) {
        let vinfo = await env.BOUND_BUCKET.get("test/blob/v" + String(v) + "/..manifest");
        let vbody = await vinfo.json();
        for (const p of paths) {
            expect(vbody[p].link).toEqual({ 
                project: "test", 
                asset: "blob", 
                version: "v" + String(v - 1), 
                path: p, 
                ancestor: { 
                    project: "test", 
                    asset: "blob", 
                    version: "v1", 
                    path: p
                }
            });
        }
    }
})

test("initializeUploadHandler fails if the quota is exceeded", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env, { quota: { baseline: 1000, growth_rate: 0, year: 2023 } });

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "dedup", path: "WHEE", md5sum: "a4caf5afa851da451e2161a4c3ac46bb", size: 500 },
                { type: "dedup", path: "BAR", md5sum: "4209df9c96263664123450aa48fd1bfa", size: 501 }
            ]
        })
    });
    req.params = { project: "test-upload", asset: "blob", version: "v0" };
    req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

    await setup.expectError(upload.initializeUploadHandler(req, env, []), "upload exceeds the storage quota");
})

test("initializeUploadHandler does not trust uploaders unless instructed to", async () => {
    const env = getMiniflareBindings();

    await setup.createMockProject("test-upload1", env, { permissions: { "owners": [ "ProjectOwner" ], uploaders: [ { id: "RandomDude" } ] } })
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ files: [] })
        });
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        req.params = { project: "test-upload1", asset: "trust-check", version: "v1" };

        let nb = [];
        await upload.initializeUploadHandler(req, env, nb);

        let sinfo = await env.BOUND_BUCKET.get("test-upload1/trust-check/v1/..summary");
        let sbody = await sinfo.json();
        expect(sbody.on_probation).toBe(true);
    }

    await setup.createMockProject("test-upload2", env, { permissions: { "owners": [ "ProjectOwner" ], uploaders: [ { id: "RandomDude", trusted: false } ] } });
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ files: [] })
        });
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        req.params = { project: "test-upload2", asset: "trust-check", version: "v1" };

        let nb = [];
        await upload.initializeUploadHandler(req, env, nb);

        let sinfo = await env.BOUND_BUCKET.get("test-upload2/trust-check/v1/..summary");
        let sbody = await sinfo.json();
        expect(sbody.on_probation).toBe(true);
    }

    // Works if we set trusted = true.
    await setup.createMockProject("test-upload3", env, { permissions: { "owners": [ "ProjectOwner" ], uploaders: [ { id: "RandomDude", trusted: true } ] } });
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ files: [] })
        });
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        req.params = { project: "test-upload3", asset: "trust-check", version: "v1" };

        let nb = [];
        let init = await upload.initializeUploadHandler(req, env, nb);
        await init.json();

        let sinfo = await env.BOUND_BUCKET.get("test-upload3/trust-check/v1/..summary");
        let sbody = await sinfo.json();
        expect(sbody.on_probation).toBe(false);
    }

    // Unless we forcibly enable it.
    await setup.createMockProject("test-upload4", env, { permissions: { "owners": [ "ProjectOwner" ], uploaders: [ { id: "RandomDude", trusted: true } ] } });
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ files: [], on_probation: true })
        });
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        req.params = { project: "test-upload4", asset: "trust-check-force", version: "v1" };

        let nb = [];
        await upload.initializeUploadHandler(req, env, nb);

        let sinfo = await env.BOUND_BUCKET.get("test-upload4/trust-check-force/v1/..summary");
        let sbody = await sinfo.json();
        expect(sbody.on_probation).toBe(true);
    }
})

test("initializeUploadHandler prohibits links to missing files or versions", async () => {
    const env = getMiniflareBindings();
    let payload = await setup.simpleMockProject(env);
    await setup.createMockProject("test-upload", env);

    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ 
                files: [
                    { type: "link", path: "pet/rabbit.txt", link: { project: "test", asset: "blob", version: "v1", path: "foo/bar2.txt" } }
                ]
            })
        });
        req.params = { project: "test-upload", asset: "linker", version: "v1" };
        req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

        let nb = [];
        await setup.expectError(upload.initializeUploadHandler(req, env, nb), "failed to link");
    }

    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ 
                files: [
                    { type: "link", path: "pet/rabbit.txt", link: { project: "test", asset: "blob", version: "v0", path: "foo/bar.txt" } }
                ]
            })
        });
        req.params = { project: "test-upload", asset: "linker", version: "v1" };
        req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

        let nb = [];
        await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot find version summary");
    }
})

test("initializeUploadHandler prohibits circular links ", async () => {
    const env = getMiniflareBindings();
    let payload = await setup.simpleMockProject(env);
    await setup.createMockProject("test-upload", env);

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "link", path: "pet/rabbit.txt", link: { project: "test", asset: "blob", version: "v2", path: "foo/bar.txt" } }
            ]
        })
    });
    req.params = { project: "test", asset: "blob", version: "v2" };
    req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

    let nb = [];
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "circular link");
})

test("initializeUploadHandler prohibits links to probational versions", async () => {
    const env = getMiniflareBindings();
    let payload = await setup.simpleMockProject(env);
    await setup.createMockProject("test-upload", env);

    let nb = [];

    // First, creating a probational version.
    {
        let ireq = new Request("http://localhost", { 
            method: "POST", 
            body: JSON.stringify({ 
                files: [
                    { type: "link", path: "pet/rabbit.txt", link: { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" } }
                ],
                on_probation: true 
            }) 
        });
        ireq.params = { project: "test-upload", asset: "linker", version: "bach" };
        ireq.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
        let init = await upload.initializeUploadHandler(ireq, env, nb);

        let creq = new Request("http://localhost", { method: "POST" });
        creq.params = { project: "test-upload", asset: "linker", version: "bach" };
        creq.headers.set("Authorization", "Bearer " + (await init.json()).session_token);
        await upload.completeUploadHandler(creq, env, nb);
    }

    // Now trying to create a link to it.
    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "link", path: "wherewoolf.txt", link: { project: "test-upload", asset: "linker", version: "bach", path: "pet/rabbit.txt" } }
            ]
        })
    });
    req.params = { project: "test-upload", asset: "linker", version: "amadeus" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot refer to probational version");
})

test("initializeUploadHandler prohibits links to incomplete uploads", async () => {
    const env = getMiniflareBindings();
    let payload = await setup.simpleMockProject(env);
    await setup.createMockProject("test-upload", env);
    await setup.createMockProject("test-upload-deux", env);

    let nb = [];

    // Starting an upload in one place....
    let ireq = new Request("http://localhost", { 
        method: "POST", 
        body: JSON.stringify({ 
            files: [
                { type: "link", path: "pet/rabbit.txt", link: { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" } }
            ]
        }) 
    });
    ireq.params = { project: "test-upload", asset: "chihaya", version: "kisaragi" };
    ireq.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
    await upload.initializeUploadHandler(ireq, env, nb);

    // Now trying to create a link to it.
    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "link", path: "wherewoolf.txt", link: { project: "test-upload", asset: "chihaya", version: "kisaragi", path: "pet/rabbit.txt" } }
            ]
        })
    });
    req.params = { project: "test-upload-deux", asset: "miki", version: "hoshii" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "cannot refer to incomplete upload");
})

test("initializeUploadHandler prohibits duplicate files", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "simple", path: "pet/rabbit.txt", md5sum: "asdasdasdasd", size: 20 },
                { type: "dedup", path: "pet/rabbit.txt", md5sum: "blahblahbalh", size: 40 }
            ]
        })
    });
    req.params = { project: "test-upload", asset: "linker", version: "v1" };
    req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

    let nb = [];
    await setup.expectError(upload.initializeUploadHandler(req, env, nb), "duplicated value");
})

/******* Presigned upload checks *******/

test("uploadPresignedFileHandler works as expected", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);

    // Setting up the state.
    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "simple", path: "WHEE", md5sum: "a4caf5afa851da451e2161a4c3ac46bb", size: 100 },
            ]
        })
    });
    req.params = { project: "test-upload", asset: "blob", version: "v0" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);

    let nb = [];
    let raw_init = await upload.initializeUploadHandler(req, env, nb);
    let init = await raw_init.json();

    // Tapping the presigned endpoint.
    let req2 = new Request("http://localhost", { method: "POST" });
    req2.params = { slug: "YAAY" };
    await setup.expectError(upload.uploadPresignedFileHandler(req2, env, nb), "invalid slug");

    let url = init.file_urls[0].url;
    let slug = url.slice(url.lastIndexOf("/") + 1);
    req2.params = { slug: slug };
    req2.headers.set("Authorization", "Bearer NOOOOOOO");
    await setup.expectError(upload.uploadPresignedFileHandler(req2, env, nb), "does not look like");

    req2.headers.set("Authorization", "Bearer " + init.session_token);
    let raw_pres = await upload.uploadPresignedFileHandler(req2, env, nb);
    let pres = await raw_pres.json();
    expect(pres.url).toMatch("pretend");
    expect(pres.md5sum_base64.length).toEqual(24);
    expect(pres.md5sum_base64.endsWith("==")).toBe(true);
})

/******* Complete uploads checks *******/

function createCompleteTestPayloads() {
    return { 
        "makoto": "Minami Shinoda",
        "akane": "Kana Aoi",
        "chito": "Ai Kayano"
    };
}

test("completeUploadHandler works correctly", async () => {
    const env = getMiniflareBindings();
    await setup.simpleMockProject(env);
    let original_size = 999;
    await setup.createMockProject("test-upload", env, { quota: { baseline: 10000, growth_rate: 10, year: (new Date).getFullYear() }, usage: { total: original_size } });

    let payload = createCompleteTestPayloads();

    // Setting up the state.
    let params = { project: "test-upload", asset: "blob", version: "v0" };
    let key;
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ 
                files: [
                    { type: "simple", path: "witch/makoto.csv", md5sum: "a4caf5afa851da451e2161a4c3ac46bb", size: payload["makoto"].length },
                    { type: "simple", path: "witch/akane.csv", md5sum: "3f8aaed3d149be552fc2ec47ae2d1e57", size: payload["akane"].length },
                    { type: "link", path: "human/chinatsu.txt", link: { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" } },
                    { type: "link", path: "human/nao.txt", link: { project: "test", asset: "blob", version: "v1", path: "whee.txt" } },
                    { type: "link", path: "haru-no-hakobiya", link: { project: "test", asset: "blob", version: "v1", path: "blah.txt" } },
                    { type: "link", path: "animal/cat/kenny.txt", link: { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" } },
                    { type: "simple", path: "animal/cat/chito.txt", md5sum: "4ba0e96c086a229b4f39e544e2fa7873", size: payload["chito"].length }, 
                ]
            })
        });
        req.params = params;
        req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);

        let nb = [];
        let init = await (await upload.initializeUploadHandler(req, env, nb)).json();
        key = init.session_token;
    }

    // Now we do the two uploads that we're obliged to do.
    await env.BOUND_BUCKET.put("test-upload/blob/v0/witch/makoto.csv", payload["makoto"]);
    await env.BOUND_BUCKET.put("test-upload/blob/v0/witch/akane.csv", payload["akane"]);
    await env.BOUND_BUCKET.put("test-upload/blob/v0/animal/cat/chito.txt", payload["chito"]);

    // Completing the upload.
    let req = new Request("http://localhost", { method: "POST", body: "{}" });
    req.params = params;
    req.query = {};

    let nb = [];
    await setup.expectError(upload.completeUploadHandler(req, env, nb), "no user identity");

    req.headers.set("Authorization", "Bearer NOOO");
    await setup.expectError(upload.completeUploadHandler(req, env, nb), "does not look like");

    req.headers.set("Authorization", "Bearer " + key);
    await upload.completeUploadHandler(req, env, nb);

    // Checking that the lock on the folder has been removed.
    let lckinfo = await env.BOUND_BUCKET.head("test-upload/..LOCK");
    expect(lckinfo).toBeNull();

    // Checking that the usage has been updated.
    let usinfo = await env.BOUND_BUCKET.get("test-upload/..usage");
    let usbody = await usinfo.json();
    expect(usbody.total).toBeGreaterThan(original_size);

    // Check that a log was added.
    let found_logs = await setup.fetchLogs(env);
    expect(found_logs.length).toBe(1);
    expect(found_logs[0]).toEqual({ type: "add-version", project: "test-upload", asset: "blob", version: "v0", latest: true });

    // Check that an updated summary file was posted to the bucket.
    let sinfo = await env.BOUND_BUCKET.get("test-upload/blob/v0/..summary");
    let sbody = await sinfo.json();
    expect(Number.isNaN(Date.parse(sbody.upload_finish))).toBe(false);
    expect("on_probation" in sbody).toEqual(false);

    // Check that we created the link files.
    let link1 = await (await env.BOUND_BUCKET.get("test-upload/blob/v0/..links")).json();
    expect(link1).toEqual({ 
        "haru-no-hakobiya": { project: "test", asset: "blob", version: "v1", path: "blah.txt" } 
    });

    let link2 = await (await env.BOUND_BUCKET.get("test-upload/blob/v0/human/..links")).json();
    expect(link2).toEqual({ 
        "chinatsu.txt": { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" },
        "nao.txt": { project: "test", asset: "blob", version: "v1", path: "whee.txt" },
    });

    let link3 = await (await env.BOUND_BUCKET.get("test-upload/blob/v0/animal/cat/..links")).json();
    expect(link3).toEqual({ 
        "kenny.txt": { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" },
    });
})

test("completeUploadHandler checks that all uploads are present", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);
    let payload = createCompleteTestPayloads();

    // Setting up the state.
    let params = { project: "test-upload", asset: "blob", version: "v0" };
    let key;
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ 
                files: [
                    { type: "simple", path: "witch/makoto.csv", md5sum: "a4caf5afa851da451e2161a4c3ac46bb", size: payload["makoto"].length },
                    { type: "simple", path: "witch/akane.csv", md5sum: "3f8aaed3d149be552fc2ec47ae2d1e57", size: payload["akane"].length },
                    { type: "simple", path: "animal/cat/chito.txt", md5sum: "4ba0e96c086a229b4f39e544e2fa7873", size: payload["chito"].length }, 
                ]
            })
        });
        req.params = params;
        req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);

        let nb = [];
        let init = await (await upload.initializeUploadHandler(req, env, nb)).json();
        key = init.session_token;
    }

    // Upload fails due to missing files.
    let req = new Request("http://localhost", { method: "POST", body: "{}" });
    req.params = params;
    req.query = {};
    req.headers.append("Authorization", "Bearer " + key);

    let nb = [];
    await setup.expectError(upload.completeUploadHandler(req, env, nb), "should have a file");
})

test("completeUploadHandler checks that all uploads have the indicated size", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env, { quota: { baseline: 100000, growth_rate: 10, year: (new Date).getFullYear() } });
    let payload = createCompleteTestPayloads();

    // Setting up the state.
    let params = { project: "test-upload", asset: "blob", version: "v0" };
    let key;
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ 
                files: [
                    { type: "simple", path: "witch/makoto.csv", md5sum: "a4caf5afa851da451e2161a4c3ac46bb", size: payload["makoto"].length + 1000 },
                    { type: "simple", path: "witch/akane.csv", md5sum: "3f8aaed3d149be552fc2ec47ae2d1e57", size: payload["akane"].length + 1000 },
                    { type: "simple", path: "animal/cat/chito.txt", md5sum: "4ba0e96c086a229b4f39e544e2fa7873", size: payload["chito"].length + 1000 }, 
                ]
            })
        });
        req.params = params;
        req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);

        let nb = [];
        let init = await (await upload.initializeUploadHandler(req, env, nb)).json();
        key = init.session_token;
    }

    // Now we do the two uploads that we're obliged to do.
    await env.BOUND_BUCKET.put("test-upload/blob/v0/witch/makoto.csv", payload["makoto"]);
    await env.BOUND_BUCKET.put("test-upload/blob/v0/witch/akane.csv", payload["akane"]);
    await env.BOUND_BUCKET.put("test-upload/blob/v0/animal/cat/chito.txt", payload["chito"]);

    // Upload fails due to missing files.
    let req = new Request("http://localhost", { method: "POST", body: "{}" });
    req.params = params;
    req.query = {};
    req.headers.append("Authorization", "Bearer " + key);

    let nb = [];
    await setup.expectError(upload.completeUploadHandler(req, env, nb), "reported size");
})

test("completeUploadHandler checks that there are no files at the links", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);
    let payload = await setup.simpleMockProject(env);

    // Setting up the state.
    let params = { project: "test-upload", asset: "blob", version: "v0" };
    let key;
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ 
                files: [
                    { type: "link", path: "human/chinatsu.txt", link: { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" } },
                    { type: "link", path: "human/nao.txt", link: { project: "test", asset: "blob", version: "v1", path: "whee.txt" } },
                ]
            })
        });
        req.params = params;
        req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);

        let nb = [];
        let init = await (await upload.initializeUploadHandler(req, env, nb)).json();
        key = init.session_token;
    }

    // Adding files at the links.
    await env.BOUND_BUCKET.put("test-upload/blob/v0/human/chinatsu.txt", "Eri Suzuki");
    await env.BOUND_BUCKET.put("test-upload/blob/v0/human/nao.txt", "Shiori Mikami");

    // Upload fails due to files present at the links.
    let req = new Request("http://localhost", { method: "POST", body: "{}" });
    req.params = params;
    req.query = {};
    req.headers.append("Authorization", "Bearer " + key);

    let nb = [];
    await setup.expectError(upload.completeUploadHandler(req, env, nb), "should not have a file");
})

test("completeUploadHandler respects the probation status", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);
    let payload = await setup.simpleMockProject(env);

    // Setting up the state.
    let params = { project: "test-upload", asset: "blob", version: "v0" };
    let key;
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ files: [], on_probation: true })
        })
        req.params = params;
        req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);

        let nb = [];
        let init = await (await upload.initializeUploadHandler(req, env, nb)).json();
        key = init.session_token;
    }

    // Running completion.
    let req = new Request("http://localhost", { method: "POST", body: "{}" });
    req.params = params;
    req.query = {};
    req.headers.append("Authorization", "Bearer " + key);

    let nb = [];
    await upload.completeUploadHandler(req, env, nb);

    let sinfo = await env.BOUND_BUCKET.get("test-upload/blob/v0/..summary");
    let sbody = await sinfo.json();
    expect(sbody.on_probation).toBe(true);

    // Check that a log was NOT added.
    let found_logs = await setup.fetchLogs(env);
    expect(found_logs.length).toBe(0);
})

/******* Abort upload checks *******/

test("abortUploadHandler works correctly", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test-upload", env);

    // Setting up the state.
    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "simple", path: "WHEE", md5sum: "a4caf5afa851da451e2161a4c3ac46bb", size: 100 },
            ]
        })
    });
    req.params = { project: "test-upload", asset: "blob", version: "v0" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);

    let nb = [];
    let raw_init = await upload.initializeUploadHandler(req, env, nb);
    let init = await raw_init.json();

    // First attempt without headers.
    let req2 = new Request("http://localhost", { method: "DELETE" });
    req2.params = req.params;
    await setup.expectError(upload.abortUploadHandler(req2, env, nb), "user identity");

    // Trying again after adding headers.
    req2.headers.set("Authorization", "Bearer NOOO");
    await setup.expectError(upload.abortUploadHandler(req2, env, nb), "does not look like");

    // Success!
    req2.headers.set("Authorization", "Bearer " + init.session_token);
    await upload.abortUploadHandler(req2, env, nb);

    // Repeated attempts fail as the lock file is gone.
    await setup.expectError(upload.abortUploadHandler(req2, env, nb), "not been previously locked");
})
