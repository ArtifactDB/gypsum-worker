import * as lock from "../src/utils/lock.js";
import * as lckh from "../src/lock.js";
import * as gh from "../src/utils/github.js";
import * as setup from "./setup.js";
import * as pkeys from "../src/utils/internal.js";

beforeAll(async () => {
    const env = getMiniflareBindings();
    await setup.simpleMockProject(env);
    let rigging = gh.enableTestRigging();
    setup.mockGitHubIdentities(rigging);
})

test("unlockProjectHandler works correctly", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" }
    });
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    req.params = { project: "test" };

    // Unlocking works if it's not locked.
    expect((await lckh.unlockProjectHandler(req, env, [])).status).toBe(200);
    expect(await env.BOUND_BUCKET.head(pkeys.lock("test"))).toBeNull()

    // Unlocking works if it's locked.
    await lock.lockProject("test", "whee", "bar", "SESSION_KEY", env)
    expect((await lckh.unlockProjectHandler(req, env, [])).status).toBe(200);
    expect(await env.BOUND_BUCKET.head(pkeys.lock("test"))).toBeNull()

    // Unlocking works if the project doesn't even exist.
    req.params = { project: "test-does-not-exist" };
    expect((await lckh.unlockProjectHandler(req, env, [])).status).toBe(200);
})

test("unlockProjectHandler works correctly if user is not authorized", async () => {
    const env = getMiniflareBindings();
    let req = new Request("http://localhost", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(lckh.unlockProjectHandler(req, env, []), "not an administrator");
})

