import * as f_ from "../src/index.js"; // need this to set the bucket bindings.
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
    await setup.simpleMockProject();
    await setup.createMockProject("testicle");
    await setup.mockProjectVersion("testicle", "blob", "v1");

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test" };
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);

    // Not authorized.
    let nb = [];
    await setup.expectError(remove.removeProjectHandler(req, nb), "does not have the right to delete");

    // Now it works.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    await remove.removeProjectHandler(req, nb); 
    expect(await BOUND_BUCKET.head("test/..permissions")).toBeNull();

    // Avoids removing things with the same prefix.
    expect(await BOUND_BUCKET.head("testicle/..permissions")).not.toBeNull();
})

test("removeProjectAssetHandler works correctly", async () => {
    await setup.simpleMockProject();
    await setup.createMockProject("testicle");
    await setup.mockProjectVersion("test", "blobby", "v1");

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test", asset: "blob" };
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);

    // Not authorized.
    let nb = [];
    await setup.expectError(remove.removeProjectAssetHandler(req, nb), "does not have the right to delete");

    // Now it works.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    await remove.removeProjectAssetHandler(req, nb); 
    expect(await BOUND_BUCKET.head("test/blob/v1/..summary")).toBeNull();

    // Avoids removing things with the same prefix.
    expect(await BOUND_BUCKET.head("test/blobby/v1/..summary")).not.toBeNull();
})

test("removeProjectAssetVersionHandler works correctly in the simple case", async () => {
    await setup.simpleMockProject();
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "v2");

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test", asset: "blob", version: "v1" };
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);

    // Not authorized.
    let nb = [];
    await setup.expectError(remove.removeProjectAssetVersionHandler(req, nb), "does not have the right to delete");

    // Now it works.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    await remove.removeProjectAssetVersionHandler(req, nb); 
    expect(await BOUND_BUCKET.head("test/blob/v1/..summary")).toBeNull();

    // Avoids removing things with the same prefix.
    expect(await BOUND_BUCKET.head("test/blob/v2/..summary")).not.toBeNull();
})

test("removeProjectAssetVersionHandler handles version updates correctly", async () => {
    await setup.simpleMockProject();
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "v2");
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "v3");
    expect((await (await BOUND_BUCKET.get("test/blob/..latest")).json()).version).toEqual("v3");

    let req = new Request("http://localhost", { method: "DELETE" });
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    let nb = [];

    // Updates the latest back to the previous version.
    req.params = { project: "test", asset: "blob", version: "v3" };
    await remove.removeProjectAssetVersionHandler(req, nb); 
    expect((await (await BOUND_BUCKET.get("test/blob/..latest")).json()).version).toEqual("v2");

    req.params = { project: "test", asset: "blob", version: "v2" };
    await remove.removeProjectAssetVersionHandler(req, nb); 
    expect((await (await BOUND_BUCKET.get("test/blob/..latest")).json()).version).toEqual("v1");

    // Until we delete the last version, in which case the entire thing gets wiped.
    req.params = { project: "test", asset: "blob", version: "v1" };
    await remove.removeProjectAssetVersionHandler(req, nb); 
    expect(await BOUND_BUCKET.head("test/blob/..latest")).toBeNull();
})

test("removeProjectAssetVersionHandler handles version updates with probational versions", async () => {
    await setup.simpleMockProject();
    let sumpath = "test/blob/v1/..summary";
    let existing = await (await BOUND_BUCKET.get(sumpath)).json();
    existing.on_probation = true;
    await BOUND_BUCKET.put(sumpath, JSON.stringify(existing), setup.jsonmeta);

    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "v2");

    let req = new Request("http://localhost", { method: "DELETE" });
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    let nb = [];

    // Deleting the latest non-probational version wipes the latest, but not the actual contents.
    req.params = { project: "test", asset: "blob", version: "v2" };
    await remove.removeProjectAssetVersionHandler(req, nb); 
    expect(await BOUND_BUCKET.head("test/blob/..latest")).toBeNull();
    expect(await BOUND_BUCKET.head(sumpath)).not.toBeNull();
})
