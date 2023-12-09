import * as quot from "../src/quota.js";
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

test("setQuotaHandler works correctly", async () => {
    const env = getMiniflareBindings();

    {
        let req = new Request("http://localhost", {
            method: "PUT",
            body: JSON.stringify({ baseline: 1234, growth_rate: 4567 }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "test" };
        req.query = {};

        let nb = [];
        req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
        let res = await quot.setQuotaHandler(req, env, nb);
        expect(res.status).toBe(200);
        expect(nb.length).toBeGreaterThan(0);
    }

    // Checking that the update was propagated.
    {
        let info = await env.BOUND_BUCKET.get("test/..quota");
        let body = await info.json();
        expect(body.baseline).toEqual(1234);
        expect(body.growth_rate).toEqual(4567);
        expect(Number.isInteger(body.year)).toBe(true);
    }
})

test("setQuotaHandler breaks correctly if project doesn't exist", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost");
    req.params = { project: "test-foo" };
    req.query = { "owners": [] };
    req.headers.append("Authorization", "Bearer " + setup.mockTokenAdmin);

    let nb = [];
    await setup.expectError(quot.setQuotaHandler(req, env, nb), "project does not exist");
})

test("setQuotaHandler breaks correctly if the request body is invalid", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ baseline: "foo" }),
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.query = {};
    req.headers.append("Authorization", "Bearer " + setup.mockTokenAdmin);

    let nb = [];
    await setup.expectError(quot.setQuotaHandler(req, env, nb), "'baseline' to be a number");
});

test("setQuotaHandler fails correctly if user is not authorized", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ baseline: 1000 }),
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.query = {};

    let nb = [];
    await setup.expectError(quot.setQuotaHandler(req, env, nb), "user identity");

    // Adding the wrong credentials.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(quot.setQuotaHandler(req, env, nb), "not an administrator");

    // Fixing the credentials, so now it works...
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    let res = await quot.setQuotaHandler(req, env, nb); 
    expect(res.status).toBe(200);
})

test("refreshQuotaUsageHandler works correctly", async () => {
    const env = getMiniflareBindings();
    await env.BOUND_BUCKET.put(pkeys.usage("test"), JSON.stringify({ total: 999999 }));

    let req = new Request("http://localhost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);

    let res = await quot.refreshQuotaUsageHandler(req, env, []);
    expect((await res.json()).total).toBeLessThan(999999);

    let info = await env.BOUND_BUCKET.get("test/..usage");
    let body = await info.json();
    expect(body.total).toBeLessThan(999999);
})

test("refreshQuotaUsageHandler fails correctly", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(quot.refreshQuotaUsageHandler(req, env, []), "not an administrator");

    req.params = { project: "test2" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    await setup.expectError(quot.refreshQuotaUsageHandler(req, env, []), "does not exist");
})
