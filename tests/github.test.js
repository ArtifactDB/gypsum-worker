import * as auth from "../src/auth.js";
import * as gh from "../src/github.js";
import * as utils from "./utils.js";

beforeAll(async () => {
    gh.enableTestRigging(false);
})

utils.testauth("user identity checks work correctly with a real token", async () => {
    let req = new Request("http://localhost");
    req.query = {};
    req.headers.append("Authorization", "Bearer " + utils.fetchTestPAT());

    let nb = [];
    let res = await auth.findUserHandler(req, nb);

    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.login).toEqual("ArtifactDB-bot");
    expect(body.organizations).toEqual([]);
    expect(nb.length).toBeGreaterThan(0);
})
