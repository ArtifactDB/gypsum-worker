import * as perm from "../src/permissions.js";
import * as s3 from "../src/utils/s3.js";
import * as gh from "../src/utils/github.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    const env = getMiniflareBindings();
    await setup.simpleMockProject(env);
    let rigging = gh.enableTestRigging();
    setup.mockGitHubIdentities(rigging);
})

test("setPermissionsHandler works correctly", async () => {
    const env = getMiniflareBindings();

    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ owners: [ "foo", "bar"] }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "test" };
        req.query = {};

        let nb = [];
        req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
        let res = await perm.setPermissionsHandler(req, env, nb);
        expect(res.status).toBe(200);
        expect(nb.length).toBeGreaterThan(0);
    }

    // Checking that the update was propagated.
    {
        let info = await env.BOUND_BUCKET.get("test/..permissions");
        let body = await info.json();
        expect(body.owners).toEqual([ "foo", "bar" ]);
    }
})

test("setPermissionsHandler breaks correctly if project doesn't exist", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost");
    req.params = { project: "test-foo" };
    req.query = { "owners": [] };
    req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

    let nb = [];
    await setup.expectError(perm.setPermissionsHandler(req, env, nb), "does not exist");
})

test("setPermissionsHandler breaks correctly if the request body is invalid", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ owners: "foo" }),
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.query = {};
    req.headers.append("Authorization", "Bearer " + setup.mockTokenOwner);

    let nb = [];
    await setup.expectError(perm.setPermissionsHandler(req, env, nb), "'owners' to be an array");
});

test("setPermissionsHandler fails correctly if user is not authorized", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ owners: ["your-mom"] }),
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.query = {};

    let nb = [];
    await setup.expectError(perm.setPermissionsHandler(req, env, nb), "user identity");

    // Adding the wrong credentials.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(perm.setPermissionsHandler(req, env, nb), "does not own");

    // Fixing the credentials, so now it works...
    req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
    let res = await perm.setPermissionsHandler(req, env, nb); 
    expect(res.status).toBe(200);

    // but second request fais as ArtifactDB-bot is no longer authorized.
    await setup.expectError(perm.setPermissionsHandler(req, env, nb), "does not own");
})

