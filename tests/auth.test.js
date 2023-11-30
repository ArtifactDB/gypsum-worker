import * as f_ from "../src/index.js";
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

test("findUserHandler works correctly", async () => {
    let req = new Request("http://localhost");
    req.query = {};

    let nb = [];
    await utils.expectError(auth.findUserHandler(req, nb), "user identity");
    expect(nb.length).toBe(0);

    // Adding headers to the request object, and doing it again.
    req.headers.append("Authorization", "Bearer " + utils.mockToken);

    let res = await auth.findUserHandler(req, nb);
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.login).toEqual("ArtifactDB-bot");
    expect(body.organizations).toEqual([]);
    expect(nb.length).toBeGreaterThan(0);

    // Just fetches it from cache, so no cache insertion is performed.
    let nb2 = [];
    let res2 = await auth.findUserHandler(req, nb2);
    let body2 = await res2.json();
    expect(body2.login).toEqual("ArtifactDB-bot");
    expect(nb2.length).toBe(0);

    // Checking that the organizations are returned properly...
    // also check that the caching doesn't just return the same result.
    {
        req.headers.set("Authorization", "Bearer " + utils.mockTokenOther);
        let res = await auth.findUserHandler(req, nb);
        expect(res.status).toBe(200);
        let body = await res.json();
        expect(body.login).toEqual("SomeoneElse");
        expect(body.organizations).toEqual(["FOO", "BAR"]);
    }
})

test("validatePermissions works correctly", () => {
    expect(auth.validatePermissions({ owners: ["b"] })).toBeUndefined();
    expect(() => auth.validatePermissions({ owners: "b" })).toThrow("to be an array");
    expect(() => auth.validatePermissions({ owners: [1,2,3] })).toThrow("array of strings");
})
