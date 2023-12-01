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
    expect(auth.validatePermissions({ owners: ["b"] })).toBeUndefined();
    expect(() => auth.validatePermissions({ owners: "b" })).toThrow("to be an array");
    expect(() => auth.validatePermissions({ owners: [1,2,3] })).toThrow("array of strings");
})

test("checkProjectManagementPermissions works correctly", async () => {
    let nb = [];
    await auth.checkProjectManagementPermissions("test", utils.mockToken, nb);
    await utils.expectError(auth.checkProjectManagementPermissions("test", utils.mockTokenOther, nb), "not an owner");

    try {
        auth.setAdmins(["SomeoneElse"]);
        await auth.checkProjectManagementPermissions("test", utils.mockTokenOther, nb);
    } finally {
        auth.setAdmins([]);
    }
})
