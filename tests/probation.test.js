import * as f_ from "../src/index.js";
import * as prob from "../src/probation.js";
import * as auth from "../src/utils/permissions.js";
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

test("probation approval works as expected", async () => {
    await setup.mockProject();
    let sumpath = "test/blob/v1/..summary";
    let existing = await (await BOUND_BUCKET.get(sumpath)).json();
    existing.on_probation = true;
    await BOUND_BUCKET.put(sumpath, JSON.stringify(existing), setup.jsonmeta);

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test", asset: "blob", version: "v1" };
    req.query = {};

    // Doesn't work without sufficient permissions.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(prob.approveProbationHandler(req, []), "not an owner");

    // Success!
    req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
    await prob.approveProbationHandler(req, []);
    let refreshed = await (await BOUND_BUCKET.get(sumpath)).json();
    expect("on_probation" in refreshed).toBe(false);

    // Repeated attempt fails.
    await setup.expectError(prob.approveProbationHandler(req, []), "non-probational");

    // Fails if it can't find anything.
    req.params = { project: "test", asset: "blob", version: "v2" };
    await setup.expectError(prob.approveProbationHandler(req, []), "does not exist");
})

test("probation rejection works as expected", async () => {
    await setup.mockProject();

    let req = new Request("http://localhost", { method: "DELETE" });
    req.params = { project: "test", asset: "blob", version: "v1" };
    req.query = {};
    req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
    await setup.expectError(prob.rejectProbationHandler(req, []), "non-probational");

    // Setting the probational flag.
    let sumpath = "test/blob/v1/..summary";
    let existing = await (await BOUND_BUCKET.get(sumpath)).json();
    existing.on_probation = true;
    await BOUND_BUCKET.put(sumpath, JSON.stringify(existing), setup.jsonmeta);

    // Doesn't work without sufficient permissions.
    req.headers.set("Authorization", "Bearer " + setup.mockTokenUser);
    await setup.expectError(prob.rejectProbationHandler(req, []), "not authorized to upload");

    await BOUND_BUCKET.put("test/..permissions", '{ "owners": [ "ProjectOwner" ], "uploaders": [ { "id": "RandomDude" } ] }');
    await auth.flushCachedPermissions("test", []);
    await setup.expectError(prob.rejectProbationHandler(req, []), "different user");

    // Success!
    req.headers.set("Authorization", "Bearer " + setup.mockTokenOwner);
    await prob.rejectProbationHandler(req, []);
    expect(await BOUND_BUCKET.head(sumpath)).toBeNull()

    // Fails if it can't find anything.
    req.params = { project: "test", asset: "blob", version: "v2" };
    await setup.expectError(prob.rejectProbationHandler(req, []), "does not exist");
})
