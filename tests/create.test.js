import * as f_ from "../src/index.js"; // need this to set the bucket bindings.
import * as create from "../src/create.js";
import * as s3 from "../src/utils/s3.js";
import * as gh from "../src/utils/github.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    await setup.mockProject();
    let rigging = gh.enableTestRigging();
    setup.mockGitHubIdentities(rigging);
})

afterAll(() => {
    gh.enableTestRigging(false);
})

test("createHandler works correctly", async () => {
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ owners: [ "foo", "bar"] }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "stuff" };
        req.query = {};

        let nb = [];
        req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);
        let res = await create.createProjectHandler(req, nb);
        expect(res.status).toBe(200);
    }

    // Checking that the update was propagated.
    {
        let bucket = s3.getR2Binding();
        let info = await bucket.get("stuff/..permissions");
        let body = await info.json();
        expect(body.owners).toEqual([ "foo", "bar" ]);
    }
})

test("createHandler breaks correctly if project already exists", async () => {
    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ owners: ["foo"] }),
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test" };
    req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);

    let nb = [];
    await setup.expectError(create.createProjectHandler(req, nb), "already exists");
})

test("setPermissionsHandler breaks correctly if the request is invalid", async () => {
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ owners: ["foo"] }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "tes/foo" };
        req.query = {};
        req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);

        let nb = [];
        await setup.expectError(create.createProjectHandler(req, nb), "cannot contain");
    }

    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ owners: "foo" }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "tesfoo" };
        req.query = {};
        req.headers.set("Authorization", "Bearer " + setup.mockTokenAdmin);

        let nb = [];
        await setup.expectError(create.createProjectHandler(req, nb), "to be an array");
    }
});

test("createProjectHandler fails correctly if user is not authorized", async () => {
    let req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ owners: ["your-mom"] }),
        headers: { "Content-Type": "application/json" }
    });
    req.params = { project: "test2" };
    req.query = {};

    let nb = [];
    await setup.expectError(create.createProjectHandler(req, nb), "user identity");

    // Adding the wrong credentials.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(create.createProjectHandler(req, nb), "not have the right to create projects");
})
