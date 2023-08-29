import * as f_ from "../src/index.js";
import * as files from "../src/files.js";
import * as s3 from "../src/s3.js";
import * as gh from "../src/github.js";
import * as setup from "./setup.js";
import * as utils from "./utils.js";

beforeAll(async () => {
    await setup.mockPublicProject();
    await setup.mockPrivateProject();
    s3.setS3ObjectDirectly(setup.S3Obj);

    let rigging = gh.enableTestRigging();
    utils.mockGitHubIdentities(rigging);
})

afterAll(() => {
    gh.enableTestRigging(false);
})

test("getVersionMetadataOrNull works correctly", async () => {
    let nb = [];
    let deets = await files.getVersionMetadataOrNull("test-public", "base", nb);
    expect(deets).not.toBeNull();
    expect("upload_time" in deets).toBe(true);
    expect(nb.length).toBeGreaterThan(0);
    await Promise.all(nb);

    // Successfully pulls it out of the cache.
    {
        let nb2 = [];
        let deets2 = await files.getVersionMetadataOrNull("test-public", "base", nb2);
        expect(deets2).toEqual(deets);
        expect(nb2.length).toBe(0);
    }

    // Returns null if the project or version doesn't exist.
    {
        let nb2 = [];
        let deets2 = await files.getVersionMetadataOrNull("test-public", "foo", nb2);
        expect(deets2).toBeNull();
    }
});

test("getVersionMetadata works correctly", async () => {
    let nb =[];
    let deets = await files.getVersionMetadata("test-public", "base", nb);
    expect(deets).not.toBeNull();
    await Promise.all(nb);

    // Fails if the project or version doesn't exist.
    nb =[];
    expect(() => files.getVersionMetadata("test-public", "foo", nb)).rejects.toThrow("failed to retrieve metadata");
})

test("getFileMetadataHandler works correctly for base usage", async () => {
    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-public:foo/bar.txt@base") };
    req.query = {};

    let nb = [];
    let meta = await files.getFileMetadataHandler(req, nb);
    expect(meta instanceof Response).toBe(true);
    expect(meta.status).toBe(200);

    let body = await meta.json();
    expect(body.path).toBe("foo/bar.txt");
    expect(body._extra.project_id).toBe("test-public");
    expect(body._extra.version).toBe("base");
    expect(typeof body._extra.uploader_name).toBe("string");

    // Setting raw=true. 
    req.query.raw = "true";
    meta = await files.getFileMetadataHandler(req, nb);
    expect(meta instanceof Response).toBe(true);
    expect(meta.status).toBe(200);

    body = await meta.json();
    expect(body.path).toBe("foo/bar.txt");
    expect("_extra" in body).toBe(false);
})

test("getFileMetadataHandler succeeds/fails correctly for private datasets", async () => {
    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-private:whee.txt@base") };
    req.query = {};

    // Fails first.
    let nb = [];
    expect(() => files.getFileMetadataHandler(req, nb)).rejects.toThrow("user credentials not supplied");

    // Adding headers to the request object, and doing it again.
    req.headers.append("Authorization", "Bearer " + utils.mockToken);

    let meta = await files.getFileMetadataHandler(req, nb);
    expect(meta instanceof Response).toBe(true);
    expect(meta.status).toBe(200);

    let body = await meta.json();
    expect(body.path).toBe("whee.txt");
})

test("getFileMetadataHandler resolves the latest alias", async () => {
    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-public:foo/bar.txt@latest") };
    req.query = {};

    let nb = [];
    let meta = await files.getFileMetadataHandler(req, nb);
    expect(meta instanceof Response).toBe(true);
    expect(meta.status).toBe(200);

    let body = await meta.json();
    expect(body.path).toBe("foo/bar.txt");
    expect(body._extra.project_id).toBe("test-public");
    expect(body._extra.version).toBe("modified");
})

test("getFileHandler works correctly", async () => {
    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-public:blah.txt@base") };
    req.query = {};

    let nb = [];
    let meta = await files.getFileHandler(req, nb);
    expect(meta instanceof Response).toBe(true);
    expect(meta.status).toBe(302);

    // Checking that the key is properly set up.
    let redirect = meta.headers.get("Location");
    expect(redirect).toMatch("test-public/base/blah.txt");

    // Responds to the expiry request.
    req.query.expires_in = 100;
    {
        let meta2 = await files.getFileHandler(req, nb);
        let redirect2 = meta2.headers.get("Location");
        expect(redirect2).toMatch("expires_in=100");
    }
})

test("getFileHandler succeeds/fails correctly for private datasets", async () => {
    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-private:whee.txt@base") };
    req.query = {};

    // Fails first.
    let nb = [];
    expect(() => files.getFileHandler(req, nb)).rejects.toThrow("user credentials not supplied");

    // Adding headers to the request object, and doing it again.
    req.headers.append("Authorization", "Bearer " + utils.mockToken);

    let meta = await files.getFileHandler(req, nb);
    expect(meta instanceof Response).toBe(true);
    expect(meta.status).toBe(302);

    // Checking that the key is properly set up.
    let redirect = meta.headers.get("Location");
    expect(redirect).toMatch("test-private/base/whee.txt");
})

test("getFileHandler resolves the latest alias", async () => {
    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-public:whee.txt@latest") };
    req.query = {};

    let nb = [];
    let meta = await files.getFileHandler(req, nb);
    expect(meta instanceof Response).toBe(true);
    expect(meta.status).toBe(302);

    // Checking that the key is properly set up.
    let redirect = meta.headers.get("Location");
    expect(redirect).toMatch("test-public/modified/whee.txt");
})

test("getFileMetadataHandler redirects correctly in simple cases", async () => {
    let payload = setup.mockFiles();
    await setup.mockProjectVersion("test-redirect-simple", "check", payload);
    await setup.addRedirection("test-redirect-simple", "check", "Aaron", "foo/bar.txt")
    await setup.dumpProjectSundries("test-redirect-simple", "check");

    // No redirection for the metadata.
    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-redirect-simple:Aaron@check") };
    req.query = {};

    {
        let nb = [];
        let meta = await files.getFileMetadataHandler(req, nb);
        expect(meta instanceof Response).toBe(true);
        expect(meta.status).toBe(200);

        let body = await meta.json();
        expect(body.path).toBe("Aaron");
        expect(body["$schema"]).toMatch("redirection");
    }

    // With redirection.
    req.query["follow_link"] = "true";

    {
        let nb = [];
        let meta = await files.getFileMetadataHandler(req, nb);
        expect(meta instanceof Response).toBe(true);
        expect(meta.status).toBe(200);

        let body = await meta.json();
        expect(body.path).toBe("foo/bar.txt");
        expect(body["$schema"]).toMatch("generic");
    }
})

test("getFileMetadataHandler redirects correctly in chains", async () => {
    let payload = setup.mockFiles();
    await setup.mockProjectVersion("test-redirect-chains", "check", payload);
    await setup.addRedirection("test-redirect-chains", "check", "Akari", "foo/bar.txt")
    await setup.addRedirection("test-redirect-chains", "check", "Aika", "Akari")
    await setup.dumpProjectSundries("test-redirect-chains", "check");

    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-redirect-chains:Aika@check") };
    req.query = { follow_link: "true" };

    {
        let nb = [];
        let meta = await files.getFileMetadataHandler(req, nb);
        expect(meta instanceof Response).toBe(true);
        expect(meta.status).toBe(200);

        let body = await meta.json();
        expect(body.path).toBe("foo/bar.txt");
        expect(body["$schema"]).toMatch("generic");
    }

    // Unless they're circular.
    await setup.addRedirection("test-redirect-chains", "check", "Akari", "Aika")
    {
        let nb = [];
        await utils.expectError(files.getFileMetadataHandler(req, nb), "circular");
    }
})

test("getFileMetadataHandler refuses to redirect into private projects", async () => {
    await setup.mockProjectVersion("test-redirect-private", "check", {});
    await setup.addRedirection("test-redirect-private", "check", "Alice", "test-private:blah.txt@base", "ArtifactDB")
    await setup.dumpProjectSundries("test-redirect-private", "check");

    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-redirect-private:Alice@check") };
    req.query = { "follow_link": "true" };

    // Fails first. 
    let nb = [];
    await utils.expectError(files.getFileMetadataHandler(req, nb), "user credentials not supplied");

    // Adding headers to the request object, and doing it again.
    req.headers.append("Authorization", "Bearer " + utils.mockToken);

    {
        let nb = [];
        let meta = await files.getFileMetadataHandler(req, nb);
        expect(meta instanceof Response).toBe(true);
        expect(meta.status).toBe(200);

        let body = await meta.json();
        expect(body.path).toBe("blah.txt");
        expect(body["$schema"]).toMatch("generic");
    }
})

test("getFileHandler follows links correctly in simple cases", async () => {
    await setup.mockLinkedProjectVersion("test-link-simple", "foo", {
        "whee.txt": "test-public:whee.txt@modified",
        "blah.txt": "test-public:blah.txt@modified",
        "foo/bar.txt": "test-public:foo/bar.txt@modified"
    });
    await setup.dumpProjectSundries("test-link-simple", "foo");

    // No redirection for the metadata.
    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-link-simple:whee.txt@foo") };
    req.query = {};

    let nb = [];
    let meta = await files.getFileHandler(req, nb);
    expect(meta instanceof Response).toBe(true);
    expect(meta.status).toBe(302);

    // Checking that the key is properly set up.
    let redirect = meta.headers.get("Location");
    expect(redirect).toMatch("test-public/modified/whee.txt");
})

test("getFileHandler follows links correctly in chains", async () => {
    await setup.mockLinkedProjectVersion("test-link-chained", "foo", {
        "blah.txt": "test-public:blah.txt@modified",
        "whee.txt": "test-link-chained:whee.txt@bar"
    });
    await setup.mockLinkedProjectVersion("test-link-chained", "bar", {
        "blah.txt": "test-link-chained:blah.txt@foo",
        "whee.txt": "test-link-chained:whee.txt@foo"
    });
    await setup.dumpProjectSundries("test-link-chained", "bar");

    // No redirection for the metadata.
    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-link-chained:blah.txt@bar") };
    req.query = {};

    let nb = [];
    let meta = await files.getFileHandler(req, nb);
    expect(meta instanceof Response).toBe(true);
    expect(meta.status).toBe(302);

    // Checking that the key is properly set up.
    let redirect = meta.headers.get("Location");
    expect(redirect).toMatch("test-public/modified/blah.txt");

    // Unless it's circular.
    {
        let req = new Request("http://localhost");
        req.params = { id: encodeURIComponent("test-link-chained:whee.txt@bar") };
        req.query = {};

        let nb = [];
        await utils.expectError(files.getFileHandler(req, nb), "circular");
    }
})

test("getFileHandler refuses to follow links into private projects", async () => {
    await setup.mockLinkedProjectVersion("test-link-private", "foo", {
        "foo/bar.txt": "test-private:foo/bar.txt@base"
    });
    await setup.dumpProjectSundries("test-link-private", "foo");

    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-link-private:foo/bar.txt@foo") };
    req.query = { "follow_link": "true" };

    // Fails first. 
    let nb = [];
    await utils.expectError(files.getFileHandler(req, nb), "user credentials not supplied");

    // Adding headers to the request object, and doing it again.
    req.headers.append("Authorization", "Bearer " + utils.mockToken);

    {
        let nb = [];
        let meta = await files.getFileHandler(req, nb);
        expect(meta instanceof Response).toBe(true);
        expect(meta.status).toBe(302);

        let redirect = meta.headers.get("Location");
        expect(redirect).toMatch("test-private/base/foo/bar.txt");
    }
})
