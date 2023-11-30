import * as f_ from "../src/index.js";
import * as utils from "./utils.js";
import * as gh from "../src/github.js";
import * as auth from "../src/auth.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    await setup.mockPublicProject();
    await setup.mockPrivateProject();

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

test("validateNewPermissions works correctly", () => {
    expect(() => auth.validateNewPermissions({ read_access: "FOO" })).toThrow("public, viewers, owners, or none");
    expect(() => auth.validateNewPermissions({ read_access: "public", write_access: "FOO" })).toThrow("owners or none");
    expect(() => auth.validateNewPermissions({ scope: "version", read_access: "public", write_access: "owners" })).toThrow("scope");

    let base = { scope: "project", read_access: "public", write_access: "owners" };
    expect(() => auth.validateNewPermissions({ ...base, viewers: [1] })).toThrow("non-empty strings");
    expect(() => auth.validateNewPermissions({ ...base, viewers: [""] })).toThrow("non-empty strings");
    expect(() => auth.validateNewPermissions({ ...base, viewers: ["a"], owners: [""] })).toThrow("non-empty strings");

    expect(auth.validateNewPermissions({ ...base, viewers: ["a"], owners: ["b"] })).toBeUndefined();
})

test("setPermissionsHandler works correctly", async () => {
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ read_access: "viewers" }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "test-private" };
        req.query = {};

        let nb = [];
        await utils.expectError(auth.setPermissionsHandler(req, nb), "user identity");

        // Adding the wrong credentials.
        req.headers.append("Authorization", "Bearer " + utils.mockTokenOther);
        await utils.expectError(auth.setPermissionsHandler(req, nb), "does not have write access");

        // Trying again.
        req.headers.set("Authorization", "Bearer " + utils.mockToken);
        let res = await auth.setPermissionsHandler(req, nb);
        expect(res.status).toBe(202);
    }

    // Checking that the update was propagated.
    {
        let req = new Request("http://localhost");
        req.params = { project: "test-private" };
        req.query = {};
        req.headers.append("Authorization", "Bearer " + utils.mockToken);

        let nb = [];
        let res = await auth.getPermissionsHandler(req, nb);
        expect(res.status).toBe(200);

        let body = await res.json();
        expect(body.read_access).toBe("viewers");
    }

    // Breaks correctly if project doesn't exist.
    {
        let req = new Request("http://localhost");
        req.params = { project: "test-foo" };
        req.query = {};
        req.headers.append("Authorization", "Bearer " + utils.mockToken);

        let nb = [];
        await utils.expectError(auth.getPermissionsHandler(req, nb), "does not exist");
    }

    // Breaks correctly if request body is invalid.
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ read_access: ["viewers"] }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "test-public" };
        req.query = {};
        req.headers.append("Authorization", "Bearer " + utils.mockToken);

        let nb = [];
        await utils.expectError(auth.setPermissionsHandler(req, nb), "invalid request body");
    }

    // Fails correctly if user is not authorized.
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ write_access: "none" }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "test-private" };
        req.query = {};
        req.headers.append("Authorization", "Bearer " + utils.mockToken);

        let nb = [];
        let res = await auth.setPermissionsHandler(req, nb); // initial request works.
        expect(res.status).toBe(202);

        // Second request fais as ArtifactDB-bot is no longer authorized.
        await utils.expectError(auth.setPermissionsHandler(req, nb), "write access");
    }
})
