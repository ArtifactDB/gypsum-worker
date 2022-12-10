import * as f_ from "../src/index.js";
import * as proj from "../src/project.js";
import * as lock from "../src/lock.js";
import * as setup from "./setup.js";
import * as gh from "../src/github.js";
import * as utils from "./utils.js";

beforeAll(async () => {
    await setup.mockPublicProject();
    await setup.mockPrivateProject();

    let rigging = gh.enableTestRigging();
    utils.mockGitHubIdentities(rigging);
})

afterAll(() => {
    gh.enableTestRigging(false);
})

test("getProjectVersionMetadataHandler works correctly", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-public", version: "base" };

    let nb = [];
    let res = await proj.getProjectVersionMetadataHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.count).toBe(body.total);

    for (const x of body.results) {
        expect(x._extra.project_id).toBe("test-public");
        expect(x._extra.version).toBe("base");
    }
})

test("getProjectVersionMetadataHandler works correctly with the latest alias", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-public", version: "latest" };

    let nb = [];
    let res = await proj.getProjectVersionMetadataHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.count).toBe(body.total);

    for (const x of body.results) {
        expect(x._extra.project_id).toBe("test-public");
        expect(x._extra.version).toBe("modified");
    }
})

test("getProjectVersionMetadataHandler fails correctly without authentication", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-private", version: "base" };

    let nb = [];
    await utils.expectError(proj.getProjectVersionMetadataHandler(req, nb), "user credentials");

    // Adding headers to the request object, and doing it again.
    req.headers.append("Authorization", "Bearer " + utils.mockToken);

    let meta = await proj.getProjectVersionMetadataHandler(req, nb);
    expect(meta.status).toBe(200);

    let body = await meta.json();
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]._extra.project_id).toBe("test-private");
})

test("listProjectVersionsHandler works correctly", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-public" };

    let nb = [];
    let res = await proj.listProjectVersionsHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.latest["_extra.version"]).toBe("modified");
    expect(body.aggs.length).toBe(2);
})

test("listProjectVersionsHandler fails correctly without authentication", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-private" };

    let nb = [];
    await utils.expectError(proj.listProjectVersionsHandler(req, nb), "user credentials");

    // Adding headers to the request object, and doing it again.
    req.headers.append("Authorization", "Bearer " + utils.mockToken);

    let res = await proj.listProjectVersionsHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.latest["_extra.version"]).toBe("base");
    expect(body.aggs.length).toBe(1);
})

test("getProjectMetadataHandler works correctly", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-public" };

    let nb = [];
    let res = await proj.getProjectMetadataHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.count).toBe(body.total);

    let found_versions = new Set
    for (const x of body.results) {
        expect(x._extra.project_id).toBe("test-public");
        found_versions.add(x._extra.version);
    }

    expect(Array.from(found_versions).sort()).toEqual(["base", "modified"]);
})

test("getProjectMetadataHandler fails correctly without authentication", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-private" };

    let nb = [];
    await utils.expectError(proj.getProjectMetadataHandler(req, nb), "user credentials");

    // Adding headers to the request object, and doing it again.
    req.headers.append("Authorization", "Bearer " + utils.mockToken);

    let res = await proj.getProjectMetadataHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.count).toBe(body.total);

    let found_versions = new Set
    for (const x of body.results) {
        expect(x._extra.project_id).toBe("test-private");
        found_versions.add(x._extra.version);
    }

    expect(Array.from(found_versions)).toEqual(["base"]);
})

test("listProjectsHandler works correctly", async () => {
    let req = new Request("http://localhost");
    req.query = {};

    let nb = [];
    let res = await proj.listProjectsHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.count).toBeGreaterThan(0);

    let found_public = null, found_private = null;
    for (const x of body.results) {
        if (x.project_id == "test-public") {
            found_public = x;
        } else if (x.project_id == "test-private") {
            found_private = x;
        }
    }

    expect(found_private).toBeNull();
    expect(found_public).not.toBeNull();
    expect(found_public.aggs.map(x => x["_extra.version"]).sort()).toEqual(["base", "modified"]);
})

test("listProjectsHandler ignores locked projects", async () => {
    let payload = setup.mockFiles();
    await setup.mockProjectVersion("test-locked", "base", payload);
    await setup.dumpProjectSundries("test-locked", "base");

    let req = new Request("http://localhost");
    req.query = {};

    // Initial check.
    let nb = [];
    let res = await proj.listProjectsHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.count).toBeGreaterThan(0);

    let found_locked = null;
    for (const x of body.results) {
        if (x.project_id == "test-locked") {
            found_locked = x;
        }
    }
    expect(found_locked.aggs.length).toBeGreaterThan(0);

    // Repeating with locks.
    await lock.lockProject("test-locked", "base");
    let lres = await proj.listProjectsHandler(req, nb);
    let lbody = await lres.json();

    found_locked = null;
    for (const x of lbody.results) {
        if (x.project_id == "test-locked") {
            found_locked = x;
        }
    }
    expect(found_locked.aggs.length).toBe(0);
})

test("listProjectsHandler works correctly with authentication", async () => {
    let req = new Request("http://localhost");
    req.query = {};
    req.headers.append("Authorization", "Bearer " + utils.mockToken);

    let nb = [];
    let res = await proj.listProjectsHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.count).toBeGreaterThan(0);

    let found_public = null, found_private = null;
    for (const x of body.results) {
        if (x.project_id == "test-public") {
            found_public = x;
        } else if (x.project_id == "test-private") {
            found_private = x;
        }
    }

    expect(found_private).not.toBeNull();
    expect(found_private.aggs.map(x => x["_extra.version"]).sort()).toEqual(["base"]);
    expect(found_public).not.toBeNull();
    expect(found_public.aggs.map(x => x["_extra.version"]).sort()).toEqual(["base", "modified"]);
})

test("listProjectsHandler works correctly with loads of scrolling", async () => {
    for (var i = 0; i < 200; i++) {
        let name = "test-dummy" + String(i);
        await setup.mockProjectVersion(name, "base", {});
        await setup.dumpProjectSundries(name, "base");
    }

    let req = new Request("http://localhost");
    req.query = {};

    let nb = [];
    let res = await proj.listProjectsHandler(req, nb);
    expect(res.status).toBe(200);
    expect(res.headers.get("link")).toMatch("/projects?more=");

    let collected = new Set;
    let body = await res.json();
    for (const x of body.results) {
        expect(collected.has(x.project_id)).toBe(false);
        collected.add(x.project_id);
    }
    expect(collected.size).toBeLessThan(200);

    while (1) {
        let linked = res.headers.get("link");
        if (!linked) {
            break;
        }

        let stub = linked.replace(/>.*/, "").replace(/.*more=/, "");
        req.query.more = stub;

        res = await proj.listProjectsHandler(req, nb);
        expect(res.status).toBe(200);

        let body = await res.json();
        for (const x of body.results) {
            expect(collected.has(x.project_id)).toBe(false);
            collected.add(x.project_id);
        }
    }

    expect(collected.size).toBeGreaterThan(200);
})

test("getProjectVersionInfoHandler works correctly", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-public", version: "modified" };

    let nb = [];
    let res = await proj.getProjectVersionInfoHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.permissions.owners).toEqual(["ArtifactDB-bot"]);
    expect(body.permissions.read_access).toBe("public");

    // Reports anomalies correctly as well.
    req.params = { project: "test-public", version: "foobar" };
    {
        let res = await proj.getProjectVersionInfoHandler(req, nb);
        expect(res.status).toBe(200);
        let body = await res.json();
        expect(body.status).toBe("error");
    }
})

test("getProjectVersionInfoHandler works correctly with the latest alias", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-public", version: "latest" };

    let nb = [];
    let res = await proj.getProjectVersionInfoHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.permissions.owners).toEqual(["ArtifactDB-bot"]);
    expect(body.permissions.read_access).toBe("public");
})

test("getProjectVersionInfoHandler fails correctly when unauthorized", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-private", version: "base" };

    let nb = [];
    await utils.expectError(proj.getProjectVersionInfoHandler(req, nb), "user credentials");

    // Adding auth information.
    req.headers.append("Authorization", "Bearer " + utils.mockToken);

    let res = await proj.getProjectVersionInfoHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.permissions.owners).toEqual(["ArtifactDB-bot"]);
    expect(body.permissions.read_access).toBe("viewers");
})

test("getProjectVersionInfoHandler fails correctly when locked", async () => {
    let req = new Request("http://localhost");
    req.params = { project: "test-public", version: "locked" };
    await lock.lockProject("test-public", "locked");

    let nb = [];
    let res = await proj.getProjectVersionInfoHandler(req, nb);
    expect(res.status).toBe(200);

    let body = await res.json();
    expect(body.status).toBe("error");
    expect(body.anomalies[0]).toMatch("locked");
})

