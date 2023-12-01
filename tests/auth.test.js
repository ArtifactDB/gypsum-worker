import * as f_ from "../src/index.js"; // need this to set the bucket bindings.
import * as utils from "./utils.js";
import * as gh from "../src/github.js";
import * as auth from "../src/auth.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    await setup.mockProject();
    let rigging = gh.enableTestRigging();
    utils.mockGitHubIdentities(rigging);
})

afterAll(() => {
    gh.enableTestRigging(false);
})

test("extractBearerToken works correctly", async () => {
    let req = new Request("http://localhost");
    req.query = {};

    // Fails with nothing.
    expect(() => auth.extractBearerToken(req)).toThrow("user identity");

    // Fails with no Bearer prefix:
    req.headers.set("Authorization", "aasdasD");
    expect(() => auth.extractBearerToken(req)).toThrow("user identity");

    // Finally works.
    req.headers.set("Authorization", "Bearer " + utils.mockToken);
    expect(auth.extractBearerToken(req)).toEqual(utils.mockToken);
})

test("findUser works correctly", async () => {
    let nb = [];
    let res = await auth.findUser(utils.mockToken, nb);
    expect(res.login).toEqual("ArtifactDB-bot");
    expect(res.organizations).toEqual([]);
    expect(nb.length).toBeGreaterThan(0);

    // Just fetches it from cache, so no cache insertion is performed.
    let nb2 = [];
    let res2 = await auth.findUser(utils.mockToken, nb2);
    expect(res2.login).toEqual("ArtifactDB-bot");
    expect(nb2.length).toBe(0);

    // Checking that the organizations are returned properly...
    // also check that the caching doesn't just return the same result.
    let res3 = await auth.findUser(utils.mockTokenOther, nb);
    expect(res3.login).toEqual("SomeoneElse");
    expect(res3.organizations).toEqual(["FOO", "BAR"]);
})

test("getPermissions works correctly", async () => {
    let nb = [];
    let out = await auth.getPermissions("test", nb);
    expect(out.owners).toEqual(["ArtifactDB-bot"]);
    expect(nb.length).toBeGreaterThan(0);
    await Promise.all(nb);

    // Fails correctly.
    await utils.expectError(auth.getPermissions("nonexistent", nb), "no existing permissions");

    // Fetches from cache.
    let nb2 = [];
    let out2 = await auth.getPermissions("test", nb2);
    expect(out2.owners).toEqual(["ArtifactDB-bot"]);
    expect(nb2.length).toBe(0);

    // Flushes the cache.
    let nb3 = [];
    await auth.flushCachedPermissions("test", nb3);
    expect(nb3.length).toBeGreaterThan(0);
    await Promise.all(nb3);
})

test("isOneOf works correctly", () => {
    expect(auth.isOneOf({login:"luna", organizations:["foo", "bar"]}, ["akari", "luna", "kaori"])).toBe(true)
    expect(auth.isOneOf({login:"luna", organizations:["foo", "bar"]}, ["akari", "kaori"])).toBe(false)
    expect(auth.isOneOf({login:"luna", organizations:["foo", "bar"]}, ["akari", "foo", "kaori"])).toBe(true)
})

test("setting admins works correctly", () => {
    let old = auth.getAdmins();
    try {
        auth.setAdmins(["a", "b", "c"]);
        expect(auth.getAdmins()).toEqual(["a", "b", "c"]);
    } finally {
        auth.setAdmins(old);
    }
})

test("validatePermissions works correctly", () => {
    expect(auth.validatePermissions({ owners: ["b"], uploaders: [] }, true)).toBeUndefined();
    expect(auth.validatePermissions({}, false)).toBeUndefined();

    expect(() => auth.validatePermissions({}, true)).toThrow("'owners' property to be present");
    expect(() => auth.validatePermissions({ owners: "b", uploaders: [] }, true)).toThrow("to be an array");
    expect(() => auth.validatePermissions({ owners: [1,2,3], uploaders: [] }, true)).toThrow("array of strings");

    expect(() => auth.validatePermissions({ owners: [] }, true)).toThrow("'uploaders' property to be present");
    expect(() => auth.validatePermissions({ owners: [], uploaders: "asdad"}, true)).toThrow("to be an array");
    expect(() => auth.validatePermissions({ owners: [], uploaders: ["asdsad"]}, true)).toThrow("array of objects");

    expect(() => auth.validatePermissions({ owners: [], uploaders: [{}]}, true)).toThrow("uploaders.id");
    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:2}]}, true)).toThrow("uploaders.id");
    expect(auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd"}]}, true)).toBeUndefined();

    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", until: 5}]}, true)).toThrow("to be a date-formatted string");
    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", until: "asdad"}]}, true)).toThrow("to be a date-formatted string");
    expect(auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", until: "2019-12-22"}]}, true)).toBeUndefined();

    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", trusted: 1}]}, true)).toThrow("to be a boolean");
    expect(auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", trusted: false}]}, true)).toBeUndefined();

    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", asset: 1}]}, true)).toThrow("to be a string");
    expect(auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", asset: "foobar"}]}, true)).toBeUndefined();

    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", version: 1}]}, true)).toThrow("to be a string");
    expect(auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", version: "foobar"}]}, true)).toBeUndefined();
})

test("checkProjectManagementPermissions works correctly", async () => {
    let nb = [];
    await auth.checkProjectManagementPermissions("test", utils.mockToken, nb);
    await utils.expectError(auth.checkProjectManagementPermissions("test", utils.mockTokenOther, nb), "not an owner");
    await auth.checkProjectManagementPermissions("test", utils.mockTokenAaron, nb);
})

test("checkProjectUploadPermissions works correctly", async () => {
    let nb = [];
    let out = await auth.checkProjectUploadPermissions("test", "blob", "v1", utils.mockToken, nb);
    expect(out.can_manage).toBe(true);
    expect(out.is_trusted).toBe(true);

    await utils.expectError(auth.checkProjectUploadPermissions("test", "blob", "v1", utils.mockTokenOther, nb), "not authorized to upload");

    out = await auth.checkProjectUploadPermissions("test", "blob", "v1", utils.mockTokenAaron, nb);
    expect(out.can_manage).toBe(true);
    expect(out.is_trusted).toBe(true);

    // Alright time to get wild.
    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ArtifactDB-bot" ], "uploaders": [ { "id": "SomeoneElse" } ] }');
    await auth.flushCachedPermissions("test", nb);
    out = await auth.checkProjectUploadPermissions("test", "blob", "v1", utils.mockTokenOther, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(true);

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ArtifactDB-bot" ], "uploaders": [ { "id": "SomeoneElse", "asset": "foo" } ] }');
    await auth.flushCachedPermissions("test", nb);
    await utils.expectError(auth.checkProjectUploadPermissions("test", "blob", "v1", utils.mockTokenOther, nb), "not authorized to upload");
    out = await auth.checkProjectUploadPermissions("test", "foo", "v1", utils.mockTokenOther, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(true);

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ArtifactDB-bot" ], "uploaders": [ { "id": "SomeoneElse", "version": "foo" } ] }');
    await auth.flushCachedPermissions("test", nb);
    await utils.expectError(auth.checkProjectUploadPermissions("test", "blob", "v1", utils.mockTokenOther, nb), "not authorized to upload");
    out = await auth.checkProjectUploadPermissions("test", "blob", "foo", utils.mockTokenOther, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(true);

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ArtifactDB-bot" ], "uploaders": [ { "id": "SomeoneElse", "until": "1989-11-09" } ] }');
    await auth.flushCachedPermissions("test", nb);
    await utils.expectError(auth.checkProjectUploadPermissions("test", "blob", "v1", utils.mockTokenOther, nb), "not authorized to upload");

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ArtifactDB-bot" ], "uploaders": [ { "id": "SomeoneElse", "until": "' + (new Date(Date.now() + 10000)).toISOString() + '" } ] }');
    await auth.flushCachedPermissions("test", nb);
    out = await auth.checkProjectUploadPermissions("test", "blob", "v1", utils.mockTokenOther, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(true);

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ArtifactDB-bot" ], "uploaders": [ { "id": "SomeoneElse", "trusted": false } ] }');
    await auth.flushCachedPermissions("test", nb);
    out = await auth.checkProjectUploadPermissions("test", "blob", "v1", utils.mockTokenOther, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(false);

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ArtifactDB-bot" ], "uploaders": [ { "id": "SomeoneElse", "trusted": true } ] }');
    await auth.flushCachedPermissions("test", nb);
    out = await auth.checkProjectUploadPermissions("test", "blob", "v1", utils.mockTokenOther, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(true);
})
