import * as create from "../src/create.js";
import * as s3 from "../src/utils/s3.js";
import * as gh from "../src/utils/github.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    const env = getMiniflareBindings();
    await setup.simpleMockProject(env);
    let rigging = gh.enableTestRigging();
    setup.mockGitHubIdentities(rigging);
})

afterAll(() => {
    gh.enableTestRigging(false);
})

test("createHandler works correctly for permissions", async () => {
    const env = getMiniflareBindings();

    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ permissions: { owners: [ "foo", "bar"] } }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "stuff" };
        req.query = {};

        let nb = [];
        req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
        let res = await create.createProjectHandler(req, env, nb);
        expect(res.status).toBe(200);
    }

    // Checking that some contents were posted.
    {
        let info = await env.BOUND_BUCKET.get("stuff/..permissions");
        let body = await info.json();
        expect(body.owners).toEqual([ "foo", "bar" ]);

        let qinfo = await env.BOUND_BUCKET.get("stuff/..quota");
        let qbody = await qinfo.json();
        expect("baseline" in qbody).toBe(true);
    }
})

test("createHandler works with quota specifications", async () => {
    const env = getMiniflareBindings();

    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ quota: { baseline: 1e11, growth_rate: 0 } }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "stuff" };
        req.query = {};

        let nb = [];
        req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
        let res = await create.createProjectHandler(req, env, nb);
        expect(res.status).toBe(200);
    }

    // Checking that some contents were posted.
    {
        let info = await env.BOUND_BUCKET.get("stuff/..permissions");
        let body = await info.json();
        expect(body.owners).toEqual([]);

        let qinfo = await env.BOUND_BUCKET.get("stuff/..quota");
        let qbody = await qinfo.json();
        expect(qbody.baseline).toEqual(1e11);
        expect(qbody.growth_rate).toEqual(0);
    }
})

test("createHandler breaks correctly if project already exists", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ permissions: { owners: ["foo"] } }),
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);

    let nb = [];
    await setup.expectError(create.createProjectHandler(req, env, nb), "already exists");
})

test("createHandler breaks correctly if the request is invalid", async () => {
    const env = getMiniflareBindings();

    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ permissions: { owners: ["foo"] } }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "tes/foo" };
        req.query = {};
        req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);

        let nb = [];
        await setup.expectError(create.createProjectHandler(req, env, nb), "cannot contain");
    }

    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ permissions: { owners: "foo" } }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "tesfoo" };
        req.query = {};
        req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);

        let nb = [];
        await setup.expectError(create.createProjectHandler(req, env, nb), "to be an array");
    }

    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ quota: { growth_rate: "foo" } }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "tesfoo" };
        req.query = {};
        req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);

        let nb = [];
        await setup.expectError(create.createProjectHandler(req, env, nb), "to be a number");
    }
});

test("createProjectHandler fails correctly if user is not authorized", async () => {
    const env = getMiniflareBindings();

    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ permissions: { owners: ["your-mom"] } }),
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test2" };
    req.query = {};

    let nb = [];
    await setup.expectError(create.createProjectHandler(req, env, nb), "user identity");

    // Adding the wrong credentials.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(create.createProjectHandler(req, env, nb), "not an administrator");
})
