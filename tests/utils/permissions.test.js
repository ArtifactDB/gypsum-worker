import * as f_ from "../../src/index.js"; // need this to set the bucket bindings.
import * as gh from "../../src/utils/github.js";
import * as auth from "../../src/utils/permissions.js";
import * as setup from "../setup.js";

beforeAll(async () => {
    await setup.mockProject();
    let rigging = gh.enableTestRigging();
    setup.mockGitHubIdentities(rigging);
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
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    expect(auth.extractBearerToken(req)).toEqual(setup.mockTokenUser);
})

test("findUser works correctly", async () => {
    let nb = [];
    let res = await auth.findUser(setup.mockTokenOwner, nb);
    expect(res.login).toEqual("ProjectOwner");
    expect(res.organizations).toEqual(["STUFF"]);
    expect(nb.length).toBeGreaterThan(0);

    // Just fetches it from cache, so no cache insertion is performed.
    let nb2 = [];
    let res2 = await auth.findUser(setup.mockTokenOwner, nb2);
    expect(res2.login).toEqual("ProjectOwner");
    expect(nb2.length).toBe(0);

    // Works with no organizations:
    res2 = await auth.findUser(setup.mockTokenAdmin, nb2);
    expect(res2.login).toEqual("LTLA");
    expect(res2.organizations).toEqual([]);

    // Checking that the organizations are returned properly...
    // also check that the caching doesn't just return the same result.
    let res3 = await auth.findUser(setup.mockTokenUser, nb);
    expect(res3.login).toEqual("RandomDude");
    expect(res3.organizations).toEqual(["FOO", "BAR"]);
})

test("getPermissions works correctly", async () => {
    let nb = [];
    let out = await auth.getPermissions("test", nb);
    expect(out.owners).toEqual(["ProjectOwner"]);
    expect(nb.length).toBeGreaterThan(0);
    await Promise.all(nb);

    // Fails correctly.
    await setup.expectError(auth.getPermissions("nonexistent", nb), "no existing permissions");

    // Fetches from cache.
    let nb2 = [];
    let out2 = await auth.getPermissions("test", nb2);
    expect(out2.owners).toEqual(["ProjectOwner"]);
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

test("setting admins works correctly", async () => {
    let old = auth.getAdmins();

    // Check that our admin token is actually in the set of admins.
    expect(old.indexOf((await auth.findUser(setup.mockTokenAdmin, [])).login)).toBeGreaterThanOrEqual(0);

    try {
        auth.setAdmins(["a", "b", "c"]);
        expect(auth.getAdmins()).toEqual(["a", "b", "c"]);
    } finally {
        auth.setAdmins(old);
    }
})

test("validatePermissions works correctly", () => {
    expect(auth.validatePermissions({ owners: ["b"], uploaders: [] })).toBeUndefined();
    expect(auth.validatePermissions({})).toBeUndefined();

    expect(() => auth.validatePermissions({ owners: "b", uploaders: [] }, true)).toThrow("to be an array");
    expect(() => auth.validatePermissions({ owners: [1,2,3], uploaders: [] }, true)).toThrow("array of strings");

    expect(() => auth.validatePermissions({ owners: [], uploaders: "asdad"}, true)).toThrow("to be an array");
    expect(() => auth.validatePermissions({ owners: [], uploaders: ["asdsad"]}, true)).toThrow("array of objects");

    expect(() => auth.validatePermissions({ owners: [], uploaders: [{}]}, true)).toThrow("uploaders.id");
    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:2}]}, true)).toThrow("uploaders.id");
    expect(auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd"}]}, true)).toBeUndefined();

    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", until: 5}]}, true)).toThrow("to be a date/time-formatted string");
    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", until: "asdad"}]}, true)).toThrow("to be a date/time-formatted string");
    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", until: "2019-12-22"}]}, true)).toThrow("to be a date/time-formatted string");
    expect(auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", until: "2019-12-22T01:02:03Z"}]}, true)).toBeUndefined();
    expect(auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", until: "2019-12-22T01:02:03+08:00"}]}, true)).toBeUndefined();

    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", trusted: 1}]}, true)).toThrow("to be a boolean");
    expect(auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", trusted: false}]}, true)).toBeUndefined();

    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", asset: 1}]}, true)).toThrow("to be a string");
    expect(auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", asset: "foobar"}]}, true)).toBeUndefined();

    expect(() => auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", version: 1}]}, true)).toThrow("to be a string");
    expect(auth.validatePermissions({ owners: [], uploaders: [{id:"asdasd", version: "foobar"}]}, true)).toBeUndefined();
})

test("checkProjectManagementPermissions works correctly", async () => {
    let nb = [];
    await auth.checkProjectManagementPermissions("test", setup.mockTokenOwner, nb);
    await setup.expectError(auth.checkProjectManagementPermissions("test", setup.mockTokenUser, nb), "not an owner");
    await auth.checkProjectManagementPermissions("test", setup.mockTokenAdmin, nb);
})

test("checkProjectUploadPermissions works correctly", async () => {
    let nb = [];
    let out = await auth.checkProjectUploadPermissions("test", "blob", "v1", setup.mockTokenOwner, nb);
    expect(out.can_manage).toBe(true);
    expect(out.is_trusted).toBe(true);

    await setup.expectError(auth.checkProjectUploadPermissions("test", "blob", "v1", setup.mockTokenUser, nb), "not authorized to upload");

    out = await auth.checkProjectUploadPermissions("test", "blob", "v1", setup.mockTokenAdmin, nb);
    expect(out.can_manage).toBe(true);
    expect(out.is_trusted).toBe(true);

    // Alright time to get wild.
    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ProjectOwner" ], "uploaders": [ { "id": "RandomDude" } ] }');
    await auth.flushCachedPermissions("test", nb);
    out = await auth.checkProjectUploadPermissions("test", "blob", "v1", setup.mockTokenUser, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(false);

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ProjectOwner" ], "uploaders": [ { "id": "RandomDude", "asset": "foo" } ] }');
    await auth.flushCachedPermissions("test", nb);
    await setup.expectError(auth.checkProjectUploadPermissions("test", "blob", "v1", setup.mockTokenUser, nb), "not authorized to upload");
    out = await auth.checkProjectUploadPermissions("test", "foo", "v1", setup.mockTokenUser, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(false);

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ProjectOwner" ], "uploaders": [ { "id": "RandomDude", "version": "foo" } ] }');
    await auth.flushCachedPermissions("test", nb);
    await setup.expectError(auth.checkProjectUploadPermissions("test", "blob", "v1", setup.mockTokenUser, nb), "not authorized to upload");
    out = await auth.checkProjectUploadPermissions("test", "blob", "foo", setup.mockTokenUser, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(false);

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ProjectOwner" ], "uploaders": [ { "id": "RandomDude", "until": "1989-11-09" } ] }');
    await auth.flushCachedPermissions("test", nb);
    await setup.expectError(auth.checkProjectUploadPermissions("test", "blob", "v1", setup.mockTokenUser, nb), "not authorized to upload");
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(false);

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ProjectOwner" ], "uploaders": [ { "id": "RandomDude", "until": "' + (new Date(Date.now() + 10000)).toISOString() + '" } ] }');
    await auth.flushCachedPermissions("test", nb);
    out = await auth.checkProjectUploadPermissions("test", "blob", "v1", setup.mockTokenUser, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(false);

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ProjectOwner" ], "uploaders": [ { "id": "RandomDude", "trusted": false } ] }');
    await auth.flushCachedPermissions("test", nb);
    out = await auth.checkProjectUploadPermissions("test", "blob", "v1", setup.mockTokenUser, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(false);

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ProjectOwner" ], "uploaders": [ { "id": "RandomDude", "trusted": true } ] }');
    await auth.flushCachedPermissions("test", nb);
    out = await auth.checkProjectUploadPermissions("test", "blob", "v1", setup.mockTokenUser, nb);
    expect(out.can_manage).toBe(false);
    expect(out.is_trusted).toBe(true);
})
