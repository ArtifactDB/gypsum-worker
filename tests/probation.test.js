import * as prob from "../src/probation.js";
import * as auth from "../src/utils/permissions.js";
import * as s3 from "../src/utils/s3.js";
import * as gh from "../src/utils/github.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    const env = getMiniflareBindings();
    await setup.simpleMockProject(env);
    let rigging = gh.enableTestRigging();
    setup.mockGitHubIdentities(rigging);

    await setup.probationalize("test", "blob", "v1", env);
    await env.BOUND_BUCKET.delete("test/blob/..latest");
})

afterAll(() => {
    gh.enableTestRigging(false);
})

test("probation approval works as expected", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test", asset: "blob", version: "v1" };
    req.query = {};

    // Doesn't work without sufficient permissions.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(prob.approveProbationHandler(req, env, []), "not an owner");

    // Success!
    req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
    await prob.approveProbationHandler(req, env, []);
    let refreshed = await (await env.BOUND_BUCKET.get("test/blob/v1/..summary")).json();
    expect("on_probation" in refreshed).toBe(false);

    // Repeated attempt fails.
    await setup.expectError(prob.approveProbationHandler(req, env, []), "non-probational");

    // Fails if it can't find anything.
    req.params = { project: "test", asset: "blob", version: "v2" };
    await setup.expectError(prob.approveProbationHandler(req, env, []), "does not exist");
})

test("probation approval sets the latest version correctly", async () => {
    const env = getMiniflareBindings();

    let latpath = "test/blob/..latest";
    { 
        let req = new Request("http://localhost", { method: "POST" });
        req.params = { project: "test", asset: "blob", version: "v1" };
        req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
        await prob.approveProbationHandler(req, env, []);

        let latest = await (await env.BOUND_BUCKET.get(latpath)).json();
        expect(latest.version).toBe('v1');
    }

    await setup.mockProjectVersion("test", "blob", "v2", env);
    await setup.probationalize("test", "blob", "v2", env);
    await env.BOUND_BUCKET.put(latpath, '{ "version": "v1" }'); // reset the version to v1.
    { 
        let req = new Request("http://localhost", { method: "POST" });
        req.params = { project: "test", asset: "blob", version: "v2" };
        req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
        await prob.approveProbationHandler(req, env, []);

        let latest = await (await env.BOUND_BUCKET.get(latpath)).json();
        expect(latest.version).toBe('v2');
    }

    // Approving an older version does not update the latest version.
    await setup.probationalize("test", "blob", "v1", env);
    { 
        let req = new Request("http://localhost", { method: "POST" });
        req.params = { project: "test", asset: "blob", version: "v1" };
        req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
        await prob.approveProbationHandler(req, env, []);

        let latest = await (await env.BOUND_BUCKET.get(latpath)).json();
        expect(latest.version).toBe('v2');
    }
})

test("probation rejection works as expected", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test", asset: "blob", version: "v1" };

    // Doesn't work without sufficient permissions.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(prob.rejectProbationHandler(req, env, []), "not authorized to upload");

    await env.BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ProjectOwner" ], "uploaders": [ { "id": "RandomDude" } ] }');
    await auth.flushCachedPermissions("test", []);
    await setup.expectError(prob.rejectProbationHandler(req, env, []), "different user");

    // Success!
    req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
    await prob.rejectProbationHandler(req, env, []);
    expect(await env.BOUND_BUCKET.head("test/blob/v1/..summary")).toBeNull()

    // Fails with non-probational version.
    {
        await setup.simpleMockProject(env);
        await setup.expectError(prob.rejectProbationHandler(req, env, []), "non-probational");
    }

    // Fails if it can't find anything.
    req.params = { project: "test", asset: "blob", version: "v2" };
    await setup.expectError(prob.rejectProbationHandler(req, env, []), "does not exist");
})

test("probation rejection accurately updates the usage", async () => {
    const env = getMiniflareBindings();

    // Checking the usage.
    let original = await (await env.BOUND_BUCKET.get("test/..usage")).json();
    expect(original.total).toBeGreaterThan(0);

    // Setting up a second version that is not probational.
    await setup.mockProjectVersion("test", "blob", "v2", env);
    let usage = await (await env.BOUND_BUCKET.get("test/..usage")).json();
    expect(usage.total).toBeGreaterThan(original.total);

    // Rejecting the first probational version.
    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test", asset: "blob", version: "v1" };
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
    await prob.rejectProbationHandler(req, env, []);

    let usage2 = await (await env.BOUND_BUCKET.get("test/..usage")).json();
    expect(usage2.total).toBe(usage.total - original.total);
})
