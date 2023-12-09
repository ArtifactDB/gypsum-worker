import * as version from "../src/version.js";
import * as s3 from "../src/utils/s3.js";
import * as pkeys from "../src/utils/internal.js";
import * as gh from "../src/utils/github.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    const env = getMiniflareBindings();
    await setup.simpleMockProject(env);
    let rigging = gh.enableTestRigging();
    setup.mockGitHubIdentities(rigging);
})

test("refreshLatestVersionHandler works correctly", async () => {
    const env = getMiniflareBindings();

    let lpath = pkeys.latestVersion("test", "blob");
    await env.BOUND_BUCKET.put(lpath, JSON.stringify({ version: "urmom" }));

    let req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);

    req.params = { project: "test2", asset: "blob" };
    await setup.expectError(version.refreshLatestVersionHandler(req, env, []), "does not exist");

    req.params = { project: "test", asset: "blob" };
    let res = await version.refreshLatestVersionHandler(req, env, []);
    expect((await res.json()).version).toEqual("v1");

    let info = await env.BOUND_BUCKET.get(lpath);
    let body = await info.json();
    expect(body.version).toEqual("v1");
})

test("refreshLatestVersionHandler works correctly with probational versions", async () => {
    const env = getMiniflareBindings();
    await setup.probationalize("test", "blob", "v1", env);

    let req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    req.params = { project: "test", asset: "blob" };

    let res = await version.refreshLatestVersionHandler(req, env, []);
    expect(await res.json()).toEqual({});

    let lpath = pkeys.latestVersion("test", "blob");
    expect(await env.BOUND_BUCKET.head(lpath)).toBeNull();
})

test("refreshLatestVersionHandler works correctly if user is not authorized", async () => {
    const env = getMiniflareBindings();
    let req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(version.refreshLatestVersionHandler(req, env, []), "not an administrator");
})
