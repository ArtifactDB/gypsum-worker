import * as auth from "../../src/utils/permissions.js";
import * as gh from "../../src/utils/github.js";
import * as setup from "../setup.js";

beforeAll(async () => {
    gh.enableTestRigging(false);
})

setup.testauth("user identity checks work correctly with a real token", async () => {
    let req = new Request("http://localhost");
    req.query = {};
    req.headers.append("Authorization", "Bearer " + setup.fetchTestPAT());

    let nb = [];
    let res = await auth.findUserHandler(req, nb);

    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.login).toEqual("ArtifactDB-bot");
    expect(body.organizations).toEqual([]);
    expect(nb.length).toBeGreaterThan(0);
})
