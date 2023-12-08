import * as f_ from "../src/index.js"; // need this to set the bucket bindings.
import * as quot from "../src/quota.js";
import * as s3 from "../src/utils/s3.js";
import * as pkeys from "../src/utils/internal.js";
import * as gh from "../src/utils/github.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    await setup.simpleMockProject();
    let rigging = gh.enableTestRigging();
    setup.mockGitHubIdentities(rigging);
})

test("setQuotaHandler works correctly", async () => {
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
        let res = await quot.setQuotaHandler(req, nb);
        expect(res.status).toBe(200);
        expect(nb.length).toBeGreaterThan(0);
    }

    // Checking that the update was propagated.
    {
        let bucket = s3.getR2Binding();
        let info = await bucket.get("test/..quota");
        let body = await info.json();
        expect(body.baseline).toEqual(1234);
        expect(body.growth_rate).toEqual(4567);
        expect(Number.isInteger(body.year)).toBe(true);
    }
})

test("setQuotaHandler breaks correctly if project doesn't exist", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-foo" };
    req.query = { "owners": [] };
    req.headers.append("Authorization", "Bearer " + setup.mockTokenAdmin);

    let nb = [];
    await setup.expectError(quot.setQuotaHandler(req, nb), "project does not exist");
})

test("setQuotaHandler breaks correctly if the request body is invalid", async () => {
    let req = new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ baseline: "foo" }),
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.query = {};
    req.headers.append("Authorization", "Bearer " + setup.mockTokenAdmin);

    let nb = [];
    await setup.expectError(quot.setQuotaHandler(req, nb), "'baseline' to be a number");
});

test("setQuotaHandler fails correctly if user is not authorized", async () => {
    let req = new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ baseline: 1000 }),
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.query = {};

    let nb = [];
    await setup.expectError(quot.setQuotaHandler(req, nb), "user identity");

    // Adding the wrong credentials.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(quot.setQuotaHandler(req, nb), "not an administrator");

    // Fixing the credentials, so now it works...
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    let res = await quot.setQuotaHandler(req, nb); 
    expect(res.status).toBe(200);
})

test("refreshQuotaUsageHandler works correctly", async () => {
    await BOUND_BUCKET.put(pkeys.usage("test"), JSON.stringify({ total: 999999 }));

    let req = new Request("http://localhost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.query = {};

    let nb = [];
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
    let res = await quot.refreshQuotaUsageHandler(req, nb);

    let bucket = s3.getR2Binding();
    let info = await bucket.get("test/..usage");
    let body = await info.json();
    expect(body.total).toBeLessThan(999999);
})

test("refreshQuotaUsageHandler works correctly if user is not authorized", async () => {
    let req = new Request("http://localhost", {
        method: "PUT",
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.query = {};

    let nb = [];
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(quot.refreshQuotaUsageHandler(req, nb), "not an administrator");
})
