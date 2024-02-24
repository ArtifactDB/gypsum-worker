import * as gh from "../../src/utils/github.js";
import * as setup from "../setup.js";

beforeAll(async () => {
    gh.enableTestRigging(false);
})

setup.testauth("user identity checks work correctly with a real token", async () => {
    let token = setup.fetchTestPAT();
    const env = getMiniflareBindings();

    let res = await gh.identifyUser(token, env);
    let body = await res.json();
    expect(body.login).toEqual("ArtifactDB-bot");

    let ores = await gh.identifyUserOrgs(token, env);
    let obody = await ores.json();
    expect(obody instanceof Array).toBe(true)
})
