import * as f_ from "../src/index.js";
import * as upload from "../src/upload.js";
import * as create from "../src/create.js";
import * as pkeys from "../src/utils/internal.js";
import * as gh from "../src/utils/github.js";
import * as s3 from "../src/utils/s3.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    let rigging = gh.enableTestRigging();
    setup.mockGitHubIdentities(rigging);
    s3.setS3ObjectDirectly(setup.S3Obj);
});

afterAll(() => {
    gh.enableTestRigging(false);
});

/******* Basic checks *******/

test("initializeUploadHandler throws the right errors related to formatting", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    let nb = [];
    let req = new Request("http://localhost");

    req.params = { project: "test/upload", asset: "foo", version: "v1" };
    await setup.expectError(upload.initializeUploadHandler(req, nb), "cannot contain");
    req.params = { project: "..test-upload", asset: "foo", version: "v1" };
    await setup.expectError(upload.initializeUploadHandler(req, nb), "cannot start");

    req.params = { project: "test-upload", asset: "foo/bar", version: "v1" };
    await setup.expectError(upload.initializeUploadHandler(req, nb), "cannot contain");
    req.params = { project: "test-upload", asset: "..foobar", version: "v1" };
    await setup.expectError(upload.initializeUploadHandler(req, nb), "cannot start");

    req.params = { project: "test-upload", asset: "foobar", version: "v/1" };
    await setup.expectError(upload.initializeUploadHandler(req, nb), "cannot contain");
    req.params = { project: "test-upload", asset: "foobar", version: "..v1" };
    await setup.expectError(upload.initializeUploadHandler(req, nb), "cannot start");

    let create_req = body => {
        let req = new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });
        req.params = { project: "test-upload", asset: "foobar", version: "v1" };
        req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
        return req;
    };

    req = create_req(2);
    await setup.expectError(upload.initializeUploadHandler(req, nb), "JSON object");

    req = create_req({ on_probation: 2 });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'on_probation' property to be a boolean");

    req = create_req({ files: "foo" });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files' property to be an array");

    req = create_req({ files: [ "foo" ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files' should be an array of objects");

    req = create_req({ files: [ { "path": 2 } ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files.path' should be a string");

    req = create_req({ files: [ { "path": "..asdasd" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "cannot start with");

    req = create_req({ files: [ { "path": "yay/..asdasd" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "cannot start with");

    req = create_req({ files: [ { "path": "asdasd" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files.type' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "simple" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files.md5sum' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "simple", "md5sum": "YAY", "size": "YAY"} ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files.size' should be a non-negative integer");

    req = create_req({ files: [ { "path": "asdasd", "type": "simple", "md5sum": "YAY", "size": 1.5} ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files.size' should be a non-negative integer");

    req = create_req({ files: [ { "path": "asdasd", "type": "simple", "md5sum": "YAY", "size": -100} ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files.size' should be a non-negative integer");

    req = create_req({ files: [ { "path": "asdasd", "type": "link" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files.link' should be an object");

    req = create_req({ files: [ { "path": "asdasd", "type": "link", "link": { } } ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files.link.project' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "link", "link": { "project": "YAY" } } ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files.link.asset' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "link", "link": { "project": "YAY", "asset": "asdasd" } } ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files.link.version' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "link", "link": { "project": "YAY", "asset": "asdasd", "version": "foo" } } ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "'files.link.path' should be a string");

    req = create_req({ files: [ { "path": "asdasd", "type": "urmom" } ] });
    await setup.expectError(upload.initializeUploadHandler(req, nb), "invalid 'files.type'");
})

test("initializeUploadHandler throws the right errors for permission-related errors", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));

    let options = { method: "POST", body: JSON.stringify({ files: [] }) };

    {
        let req = new Request("http://localhost", options);
        req.params = { project: "test-upload", asset: "palms", version: "test" };
        let nb = [];
        await setup.expectError(upload.initializeUploadHandler(req, nb), "user identity");
    }

    {
        let req = new Request("http://localhost", options);
        req.params = { project: "test-upload", asset: "palms", version: "test" };
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        let nb = [];
        await setup.expectError(upload.initializeUploadHandler(req, nb), "not authorized to upload");
    }

    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [ { id: "RandomDude", version: "foo" } ] }));
    {
        let req = new Request("http://localhost", options);
        req.params = { project: "test-upload", asset: "palms", version: "test" };
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        let nb = [];
        await setup.expectError(upload.initializeUploadHandler(req, nb), "not authorized to upload");
    }
})

test("initializeUploadHandler works correctly for simple uploads", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));

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

    let init = await upload.initializeUploadHandler(req, []);
    let body = await init.json();

    expect(body.file_urls.length).toBe(2);
    expect(body.file_urls[0].path).toBe("WHEE");
    expect(body.file_urls[0].url).toMatch("presigned-file");
    expect(body.file_urls[1].path).toBe("BAR");
    expect(body.file_urls[1].url).toMatch("presigned-file");

    expect(body.complete_url).toMatch(/complete.*test-upload/);
    expect(body.abort_url).toMatch(/abort.*test-upload/);

    // Check that a lock file was correctly created.
    let lckinfo = await BOUND_BUCKET.get("test-upload/..LOCK");
    let lckbody = await lckinfo.json();
    expect(typeof lckbody.user_name).toEqual("string");
    expect(lckbody.version).toEqual("v0");

    // Check that the quota file was updated.
    let quotinfo = await BOUND_BUCKET.get("test-upload/..quota");
    let quotbody = await quotinfo.json();
    expect(quotbody.pending_on_complete_only).toEqual(123);

    // Check that a version summary file was posted to the bucket.
    let sinfo = await BOUND_BUCKET.get("test-upload/blob/v0/..summary");
    let sbody = await sinfo.json();
    expect(sbody.upload_user_id).toEqual("ProjectOwner");
    expect(Number.isNaN(Date.parse(sbody.upload_start))).toBe(false);
    expect(sbody.on_probation).toEqual(false);

    // Check that a version manifest file was posted to the bucket.
    let vinfo = await BOUND_BUCKET.get("test-upload/blob/v0/..manifest");
    let vbody = await vinfo.json();
    expect(vbody["WHEE"]).toEqual({ size: 100, md5sum: "a4caf5afa851da451e2161a4c3ac46bb" });
    expect(vbody["BAR"]).toEqual({ size: 23, md5sum: "4209df9c96263664123450aa48fd1bfa" });
})

test("initializeUploadHandler converts MD5'able files to simple uploads if no prior version exists", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));

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

    let init = await upload.initializeUploadHandler(req, []);
    let body = await init.json();

    expect(body.file_urls.length).toBe(2);
    expect(body.file_urls[0].path).toBe("WHEE");
    expect(body.file_urls[0].url).toMatch("presigned-file");
    expect(body.file_urls[1].path).toBe("BAR");
    expect(body.file_urls[1].url).toMatch("presigned-file");
})

test("initializeUploadHandler works correctly for MD5'able uploads with a prior version", async () => {
    let payload = await setup.mockProjectRaw("test-upload", "linker", "v0");
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
    let init = await upload.initializeUploadHandler(req, nb);
    let body = await init.json();

    expect(body.file_urls.length).toBe(3);
    expect(body.file_urls[0].path).toBe("carbs/rice.txt");
    expect(body.file_urls[1].path).toBe("fruit/apple.txt");
    expect(body.file_urls[2].path).toBe("fruit/orange.txt");

    // Checking that the manifest contains links.
    let vinfo = await BOUND_BUCKET.get("test-upload/linker/v1/..manifest");
    let vbody = await vinfo.json();
    expect("carbs/rice.txt" in vbody).toBe(true);
    expect("fruit/apple.txt" in vbody).toBe(true);
    expect("fruit/orange.txt" in vbody).toBe(true);
    expect(vbody["carbs/bread.txt"]).toEqual({ md5sum: whee_md5, size: whee_size, link: { project: "test-upload", asset: "linker", version: "v0", path: "whee.txt" } });
    expect(vbody["carbs/beans.txt"]).toEqual({ md5sum: blah_md5, size: blah_size, link: { project: "test-upload", asset: "linker", version: "v0", path: "blah.txt" } });
})

test("initializeUploadHandler works correctly for link-based deduplication", async () => {
    let payload = await setup.mockProject();
    let whee_md5 = setup.computeHash(payload["whee.txt"]);
    let whee_size = payload["whee.txt"].length;
    let blah_md5 = setup.computeHash(payload["blah.txt"]);
    let blah_size = payload["blah.txt"].length;
    let foobar_md5 = setup.computeHash(payload["foo/bar.txt"]);
    let foobar_size = payload["foo/bar.txt"].length;

    // Performing a new upload.
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));

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
    let init = await upload.initializeUploadHandler(req, nb);
    let body = await init.json();
    expect(body.file_urls.length).toBe(0);

    // Checking that a link file is posted.
    let vinfo = await BOUND_BUCKET.get("test-upload/linker/v1/..manifest");
    let vbody = await vinfo.json();
    expect(vbody["pet/rabbit.txt"]).toEqual({ md5sum: foobar_md5, size: foobar_size, link: { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" } });
    expect(vbody["pet/cat.txt"]).toEqual({ md5sum: whee_md5, size: whee_size, link: { project: "test", asset: "blob", version: "v1", path: "whee.txt" } });
    expect(vbody["pet/dog.txt"]).toEqual({ md5sum: blah_md5, size: blah_size, link: { project: "test", asset: "blob", version: "v1", path: "blah.txt" } });
})

test("initializeUploadHandler fails if the quota is exceeded", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [ { id: "RandomDude" } ] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 0, usage: 100, year: 2023 }));

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ 
            files: [
                { type: "dedup", path: "WHEE", md5sum: "a4caf5afa851da451e2161a4c3ac46bb", size: 500 },
                { type: "dedup", path: "BAR", md5sum: "4209df9c96263664123450aa48fd1bfa", size: 401 }
            ]
        })
    });
    req.params = { project: "test-upload", asset: "blob", version: "v0" };
    req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

    await setup.expectError(upload.initializeUploadHandler(req, []), "upload exceeds the storage quota");
})

test("initializeUploadHandler does not trust uploaders unless instructed to", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload1"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [ { id: "RandomDude" } ] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload1"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));

    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ files: [] })
        });
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        req.params = { project: "test-upload1", asset: "trust-check", version: "v1" };

        let nb = [];
        await upload.initializeUploadHandler(req, nb);

        let sinfo = await BOUND_BUCKET.get("test-upload1/trust-check/v1/..summary");
        let sbody = await sinfo.json();
        expect(sbody.on_probation).toBe(true);
    }

    await BOUND_BUCKET.put(pkeys.permissions("test-upload2"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [ { id: "RandomDude", trusted: false } ] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload2"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ files: [] })
        });
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        req.params = { project: "test-upload2", asset: "trust-check", version: "v1" };

        let nb = [];
        await upload.initializeUploadHandler(req, nb);

        let sinfo = await BOUND_BUCKET.get("test-upload2/trust-check/v1/..summary");
        let sbody = await sinfo.json();
        expect(sbody.on_probation).toBe(true);
    }

    // Works if we set trusted = true.
    await BOUND_BUCKET.put(pkeys.permissions("test-upload3"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [ { id: "RandomDude", trusted: true } ] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload3"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));
    {

        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ files: [] })
        });
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        req.params = { project: "test-upload3", asset: "trust-check", version: "v1" };

        let nb = [];
        let init = await upload.initializeUploadHandler(req, nb);
        await init.json();

        let sinfo = await BOUND_BUCKET.get("test-upload3/trust-check/v1/..summary");
        let sbody = await sinfo.json();
        expect(sbody.on_probation).toBe(false);
    }

    // Unless we forcibly enable it.
    await BOUND_BUCKET.put(pkeys.permissions("test-upload4"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [ { id: "RandomDude", trusted: true } ] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload4"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ files: [], on_probation: true })
        });
        req.headers.append("Authorization", "Bearer " + setup.mockTokenUser);
        req.params = { project: "test-upload4", asset: "trust-check-force", version: "v1" };

        let nb = [];
        await upload.initializeUploadHandler(req, nb);

        let sinfo = await BOUND_BUCKET.get("test-upload4/trust-check-force/v1/..summary");
        let sbody = await sinfo.json();
        expect(sbody.on_probation).toBe(true);
    }
})

test("initializeUploadHandler prohibits links to missing files or versions", async () => {
    let payload = await setup.mockProject();
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 99 }));

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
        await setup.expectError(upload.initializeUploadHandler(req, nb), "failed to link");
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
        await setup.expectError(upload.initializeUploadHandler(req, nb), "no manifest available");
    }

    // Links back to ourselves.
    {
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
        await setup.expectError(upload.initializeUploadHandler(req, nb), "circular link");
    }
})

test("initializeUploadHandler prohibits duplicate files", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 99 }));

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
    await setup.expectError(upload.initializeUploadHandler(req, nb), "duplicated value");
})

/******* Presigned upload checks *******/

test("uploadPresignedFileHandler works as expected", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 99 }));

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
    let raw_init = await upload.initializeUploadHandler(req, nb);
    let init = await raw_init.json();

    // Tapping the presigned endpoint.
    let req2 = new Request("http://localhost", { method: "POST" });
    req2.params = { slug: "YAAY" };
    await setup.expectError(upload.uploadPresignedFileHandler(req2, nb), "invalid slug");

    let url = init.file_urls[0].url;
    let slug = url.slice(url.lastIndexOf("/") + 1);
    req2.params = { slug: slug };
    req2.headers.set("Authorization", "Bearer NOOOOOOO");
    await setup.expectError(upload.uploadPresignedFileHandler(req2, nb), "different user");

    req2.headers.set("Authorization", "Bearer " + init.session_token);
    let raw_pres = await upload.uploadPresignedFileHandler(req2, nb);
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
    await setup.mockProject();
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    let original_size = 999;
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: original_size }));

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
        let init = await (await upload.initializeUploadHandler(req, nb)).json();
        key = init.session_token;
    }

    // Now we do the two uploads that we're obliged to do.
    await BOUND_BUCKET.put("test-upload/blob/v0/witch/makoto.csv", payload["makoto"]);
    await BOUND_BUCKET.put("test-upload/blob/v0/witch/akane.csv", payload["akane"]);
    await BOUND_BUCKET.put("test-upload/blob/v0/animal/cat/chito.txt", payload["chito"]);

    // Completing the upload.
    let req = new Request("http://localhost", { method: "POST", body: "{}" });
    req.params = params;
    req.query = {};

    let nb = [];
    await setup.expectError(upload.completeUploadHandler(req, nb), "no user identity");

    req.headers.append("Authorization", "Bearer " + key);
    await upload.completeUploadHandler(req, nb);

    // Checking that the lock on the folder has been removed.
    let lckinfo = await BOUND_BUCKET.head("test-upload/..LOCK");
    expect(lckinfo).toBeNull();

    // Checking that the quota has been updated.
    let quotinfo = await BOUND_BUCKET.get("test-upload/..quota");
    let quotbody = await quotinfo.json();
    expect(quotbody.usage).toBeGreaterThan(original_size);

    // Check that an updated summary file was posted to the bucket.
    let sinfo = await BOUND_BUCKET.get("test-upload/blob/v0/..summary");
    let sbody = await sinfo.json();
    expect(Number.isNaN(Date.parse(sbody.upload_finish))).toBe(false);
    expect("on_probation" in sbody).toEqual(false);

    // Check that we created the link files.
    let link1 = await (await BOUND_BUCKET.get("test-upload/blob/v0/..links")).json();
    expect(link1).toEqual({ 
        "haru-no-hakobiya": { project: "test", asset: "blob", version: "v1", path: "blah.txt" } 
    });

    let link2 = await (await BOUND_BUCKET.get("test-upload/blob/v0/human/..links")).json();
    expect(link2).toEqual({ 
        "chinatsu.txt": { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" },
        "nao.txt": { project: "test", asset: "blob", version: "v1", path: "whee.txt" },
    });

    let link3 = await (await BOUND_BUCKET.get("test-upload/blob/v0/animal/cat/..links")).json();
    expect(link3).toEqual({ 
        "kenny.txt": { project: "test", asset: "blob", version: "v1", path: "foo/bar.txt" },
    });
})

test("completeUploadHandler checks that all uploads are present", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));

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
        let init = await (await upload.initializeUploadHandler(req, nb)).json();
        key = init.session_token;
    }

    // Upload fails due to missing files.
    let req = new Request("http://localhost", { method: "POST", body: "{}" });
    req.params = params;
    req.query = {};
    req.headers.append("Authorization", "Bearer " + key);

    let nb = [];
    await setup.expectError(upload.completeUploadHandler(req, nb), "should have a file");
})

test("completeUploadHandler checks that all uploads have the same size", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));

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
        let init = await (await upload.initializeUploadHandler(req, nb)).json();
        key = init.session_token;
    }

    // Now we do the two uploads that we're obliged to do.
    await BOUND_BUCKET.put("test-upload/blob/v0/witch/makoto.csv", payload["makoto"]);
    await BOUND_BUCKET.put("test-upload/blob/v0/witch/akane.csv", payload["akane"]);
    await BOUND_BUCKET.put("test-upload/blob/v0/animal/cat/chito.txt", payload["chito"]);

    // Upload fails due to missing files.
    let req = new Request("http://localhost", { method: "POST", body: "{}" });
    req.params = params;
    req.query = {};
    req.headers.append("Authorization", "Bearer " + key);

    let nb = [];
    await setup.expectError(upload.completeUploadHandler(req, nb), "reported size");
})

test("completeUploadHandler checks that there are no files at the links", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));

    let payload = await setup.mockProject();

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
        let init = await (await upload.initializeUploadHandler(req, nb)).json();
        key = init.session_token;
    }

    // Adding files at the links.
    await BOUND_BUCKET.put("test-upload/blob/v0/human/chinatsu.txt", "Eri Suzuki");
    await BOUND_BUCKET.put("test-upload/blob/v0/human/nao.txt", "Shiori Mikami");

    // Upload fails due to files present at the links.
    let req = new Request("http://localhost", { method: "POST", body: "{}" });
    req.params = params;
    req.query = {};
    req.headers.append("Authorization", "Bearer " + key);

    let nb = [];
    await setup.expectError(upload.completeUploadHandler(req, nb), "should not have a file");
})

test("completeUploadHandler respects the probation status", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));

    let payload = await setup.mockProject();

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
        let init = await (await upload.initializeUploadHandler(req, nb)).json();
        key = init.session_token;
    }

    // Running completion.
    let req = new Request("http://localhost", { method: "POST", body: "{}" });
    req.params = params;
    req.query = {};
    req.headers.append("Authorization", "Bearer " + key);

    let nb = [];
    await upload.completeUploadHandler(req, nb);

    let sinfo = await BOUND_BUCKET.get("test-upload/blob/v0/..summary");
    let sbody = await sinfo.json();
    expect(sbody.on_probation).toBe(true);
})

/******* Abort upload checks *******/

test("abortUploadHandler works correctly", async () => {
    await BOUND_BUCKET.put(pkeys.permissions("test-upload"), JSON.stringify({ "owners": [ "ProjectOwner" ], uploaders: [] }));
    await BOUND_BUCKET.put(pkeys.quota("test-upload"), JSON.stringify({ baseline: 1000, growth_rate: 10, usage: 999 }));

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
    let raw_init = await upload.initializeUploadHandler(req, nb);
    let init = await raw_init.json();

    // First attempt without headers.
    let req2 = new Request("http://localhost", { method: "DELETE" });
    req2.params = req.params;
    await setup.expectError(upload.abortUploadHandler(req2, nb), "user identity");

    // Trying again after adding headers.
    req2.headers.set("Authorization", "Bearer NOOO");
    await setup.expectError(upload.abortUploadHandler(req2, nb), "different user");

    // Success!
    req2.headers.set("Authorization", "Bearer " + init.session_token);
    await upload.abortUploadHandler(req2, nb);

    // Repeated attempts fail as the lock file is gone.
    await setup.expectError(upload.abortUploadHandler(req2, nb), "not been previously locked");
})
