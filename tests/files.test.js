import * as f_ from "../src/index.js";
import * as files from "../src/files.js";
import * as s3 from "../src/s3.js";
import * as setup from "./setup.js";
import * as utils from "./utils.js";

beforeAll(async () => {
    await setup.mockPublicProject();
    await setup.mockPrivateProject();
    s3.setS3ObjectDirectly(setup.S3Obj);
});

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

test("getFileMetadataHandler works correctly with no links", async () => {
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
})

utils.testauth("getFileMetadataHandler succeeds/fails correctly for private datasets", async () => {
    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-private:whee.txt@base") };
    req.query = {};

    // Fails first.
    let nb = [];
    expect(() => files.getFileMetadataHandler(req, nb)).rejects.toThrow("user credentials not supplied");

    // Adding headers to the request object, and doing it again.
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let meta = await files.getFileMetadataHandler(req, nb);
    expect(meta instanceof Response).toBe(true);
    expect(meta.status).toBe(200);

    let body = await meta.json();
    expect(body.path).toBe("whee.txt");
})

test("getFileHandler works correctly with no links", async () => {
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

utils.testauth("getFileHandler succeeds/fails correctly for private datasets", async () => {
    let req = new Request("http://localhost");
    req.params = { id: encodeURIComponent("test-private:whee.txt@base") };
    req.query = {};

    // Fails first.
    let nb = [];
    expect(() => files.getFileHandler(req, nb)).rejects.toThrow("user credentials not supplied");

    // Adding headers to the request object, and doing it again.
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let meta = await files.getFileHandler(req, nb);
    expect(meta instanceof Response).toBe(true);
    expect(meta.status).toBe(302);

    // Checking that the key is properly set up.
    let redirect = meta.headers.get("Location");
    expect(redirect).toMatch("test-private/base/whee.txt");
})
