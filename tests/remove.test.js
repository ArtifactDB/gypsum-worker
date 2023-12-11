import * as remove from "../src/remove.js";
import * as s3 from "../src/utils/s3.js";
import * as gh from "../src/utils/github.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    let rigging = gh.enableTestRigging();
    setup.mockGitHubIdentities(rigging);
})

afterAll(() => {
    gh.enableTestRigging(false);
})

test("removeProjectHandler works correctly", async () => {
    const env = getMiniflareBindings();
    await setup.simpleMockProject(env);
    await setup.createMockProject("testicle", env);
    await setup.mockProjectVersion("testicle", "blob", "v1", env);

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test" };
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);

    // Not authorized.
    let nb = [];
    await setup.expectError(remove.removeProjectHandler(req, env, nb), "does not have the right to delete");

    // Now it works.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    await remove.removeProjectHandler(req, env, nb); 
    expect(await env.BOUND_BUCKET.head("test/..permissions")).toBeNull();

    // Checking that it added to the logs.
    let found_logs = await setup.fetchLogs(env);
    expect(found_logs.length).toBe(1);
    expect(found_logs[0]).toEqual({ type: "delete-project", project: "test" });

    // Avoids removing things with the same prefix.
    expect(await env.BOUND_BUCKET.head("testicle/..permissions")).not.toBeNull();
})

test("removeProjectAssetHandler works correctly", async () => {
    const env = getMiniflareBindings();

    await setup.simpleMockProject(env);
    await setup.createMockProject("testicle", env);
    await setup.mockProjectVersion("test", "blobby", "v1", env);

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test", asset: "blob" };
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);

    // Not authorized.
    let nb = [];
    await setup.expectError(remove.removeProjectAssetHandler(req, env, nb), "does not have the right to delete");

    // Now it works.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    await remove.removeProjectAssetHandler(req, env, nb); 
    expect(await env.BOUND_BUCKET.head("test/blob/v1/..summary")).toBeNull();

    // Checking that it added to the logs.
    let found_logs = await setup.fetchLogs(env);
    expect(found_logs.length).toBe(1);
    expect(found_logs[0]).toEqual({ type: "delete-asset", project: "test", asset: "blob" });

    // Avoids removing things with the same prefix.
    expect(await env.BOUND_BUCKET.head("test/blobby/v1/..summary")).not.toBeNull();
})

test("removeProjectAssetHandler correctly updates the usage", async () => {
    const env = getMiniflareBindings();

    await setup.simpleMockProject(env);
    await setup.mockProjectVersion("test", "blobby", "v1", env);
    let original = await (await env.BOUND_BUCKET.get("test/..usage")).json();
    expect(original.total).toBeGreaterThan(0);

    await setup.mockProjectVersion("test", "blobbo", "v1", env);
    let usage = await (await env.BOUND_BUCKET.get("test/..usage")).json();
    expect(usage.total).toBeGreaterThan(original.total);

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test", asset: "blobbo" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    await remove.removeProjectAssetHandler(req, env, []); 

    usage = await (await env.BOUND_BUCKET.get("test/..usage")).json(); // quota gets updated.
    expect(usage.total).toBe(original.total);
})

test("removeProjectAssetVersionHandler works correctly in the simple case", async () => {
    const env = getMiniflareBindings();

    await setup.simpleMockProject(env);
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "v2", env);

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test", asset: "blob", version: "v1" };
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);

    // Not authorized.
    let nb = [];
    await setup.expectError(remove.removeProjectAssetVersionHandler(req, env, nb), "does not have the right to delete");

    // Now it works.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    await remove.removeProjectAssetVersionHandler(req, env, nb); 
    expect(await env.BOUND_BUCKET.head("test/blob/v1/..summary")).toBeNull();

    // Checking that it added to the logs.
    let found_logs = await setup.fetchLogs(env);
    expect(found_logs.length).toBe(1);
    expect(found_logs[0]).toEqual({ type: "delete-version", project: "test", asset: "blob", version: "v1", latest: false });

    // Avoids removing things with the same prefix.
    expect(await env.BOUND_BUCKET.head("test/blob/v2/..summary")).not.toBeNull();
})

test("removeProjectAssetVersionHandler correctly updates the usage", async () => {
    const env = getMiniflareBindings();

    await setup.simpleMockProject(env);
    await setup.mockProjectVersion("test", "blobby", "v1", env);
    let original = await (await env.BOUND_BUCKET.get("test/..usage")).json();
    expect(original.total).toBeGreaterThan(0);

    await setup.mockProjectVersion("test", "blobby", "v2", env);
    let usage = await (await env.BOUND_BUCKET.get("test/..usage")).json();
    expect(usage.total).toBeGreaterThan(original.total);

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test", asset: "blobby", version: "v2" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    await remove.removeProjectAssetVersionHandler(req, env, []); 

    usage = await (await env.BOUND_BUCKET.get("test/..usage")).json(); // quota gets updated.
    expect(usage.total).toBe(original.total);
})

test("removeProjectAssetVersionHandler handles version updates correctly", async () => {
    const env = getMiniflareBindings();

    await setup.simpleMockProject(env);
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "v2", env);
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "v3", env);
    expect((await (await env.BOUND_BUCKET.get("test/blob/..latest")).json()).version).toEqual("v3");

    let req = new Request("http://localhost", { method: "DELETE" });
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    let nb = [];

    // Updates the latest back to the previous version.
    req.params = { project: "test", asset: "blob", version: "v3" };
    await remove.removeProjectAssetVersionHandler(req, env, nb); 
    expect((await (await BOUND_BUCKET.get("test/blob/..latest")).json()).version).toEqual("v2");

    req.params = { project: "test", asset: "blob", version: "v2" };
    await remove.removeProjectAssetVersionHandler(req, env, nb); 
    expect((await (await BOUND_BUCKET.get("test/blob/..latest")).json()).version).toEqual("v1");

    // Until we delete the last version, in which case the entire thing gets wiped.
    req.params = { project: "test", asset: "blob", version: "v1" };
    await remove.removeProjectAssetVersionHandler(req, env, nb); 
    expect(await BOUND_BUCKET.head("test/blob/..latest")).toBeNull();
})

test("removeProjectAssetVersionHandler handles version updates with probational versions", async () => {
    const env = getMiniflareBindings();

    await setup.simpleMockProject(env);
    await setup.probationalize("test", "blob", "v1", env);

    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "v2", env);

    let req = new Request("http://localhost", { method: "DELETE" });
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    let nb = [];

    // Deleting the latest non-probational version wipes the latest, but not the actual contents.
    req.params = { project: "test", asset: "blob", version: "v2" };
    await remove.removeProjectAssetVersionHandler(req, env, nb);
    expect(await env.BOUND_BUCKET.head("test/blob/..latest")).toBeNull();
    expect(await env.BOUND_BUCKET.head("test/blob/v1/..summary")).not.toBeNull();
})
