import * as fs from "fs";
import * as crypto from "crypto";

export const mockTokenOwner = "gh_auth_mock_token_for_ProjectOwner";
export const mockTokenUser = "gh_auth_mock_token_for_RandomDude";
export const mockTokenAdmin = "gh_auth_mock_token_for_LTLA";

export function mockGitHubIdentities(rigging) {
    rigging.identifyUser[mockTokenOwner] = { login: "ProjectOwner" };
    rigging.identifyUserOrgs[mockTokenOwner] = [ { login: "STUFF" } ];
    rigging.identifyUser[mockTokenUser] = { login: "RandomDude" };
    rigging.identifyUserOrgs[mockTokenUser] = [ { login: "FOO" }, { login: "BAR" } ];
    rigging.identifyUser[mockTokenAdmin] = { login: "LTLA" };
    rigging.identifyUserOrgs[mockTokenAdmin] = [];
    return;
}

export const testauth = ("BOT_TEST_TOKEN" in process.env ? test : test.skip);

export function fetchTestPAT() {
    return process.env.BOT_TEST_TOKEN;
}

// Providing our own checks for errors, as sometimes toThrow doesn't work. It
// seems like the mocked-up R2 bucket somehow gets reset by Jest, and any extra
// files that were added will not show up in the test. So we force it to run in
// the same thread and context by using a simple try/catch block.
export async function expectError(promise, message) {
    try {
        await promise;
        throw new Error("didn't throw");
    } catch (e){
        expect(e.message).toMatch(message);
    }
}


export const S3Obj = {
    getSignedUrlPromise: async (operation, details) => {
        return "https://pretend-presigned-url/" + details.Key + "?expires_in=" + details.Expires;
    }
};

export function computeHash(contents) {
    if (typeof contents == "string") {
        let enc = new TextEncoder;
        contents = enc.encode(contents);
    }
    return crypto.createHash('md5').update(contents).digest('hex');
}

export const jsonmeta = {
    httpMetadata: { contentType: "application/json" }
};

export async function createMockProject(project, env, { permissions = null, quota = null, usage = null } = {}) {
    let permpath = project + "/..permissions";
    if (permissions == null) {
        permissions = { owners: ["ProjectOwner"], uploaders: [] };
    }
    await env.BOUND_BUCKET.put(permpath, JSON.stringify(permissions), jsonmeta);

    let qpath = project + "/..quota";
    if (quota == null) {
        quota = { baseline: 1000, growth_rate: 100, year: (new Date).getFullYear() };
    }
    await env.BOUND_BUCKET.put(qpath, JSON.stringify(quota), jsonmeta);

    let upath = project + "/..usage";
    if (usage == null) {
        usage = { total : 0 };
    }
    await env.BOUND_BUCKET.put(upath, JSON.stringify(usage), jsonmeta);
}

export async function mockProjectVersion(project, asset, version, env) {
    let contents = "";
    for (var i = 1; i <= 100; i++) {
        contents += String(i) + "\n";
    }
    let files = {
        "whee.txt": "Aaron Lun had a little lamb.",
        "blah.txt": "A\nB\nC\nD\nE\nF\nG\nH\nI\nJ\nK\nL\nM\nN\nO\nP\nQ\nR\nS\nT\nU\nV\nW\nX\nY\nZ\n",
        "foo/bar.txt": contents
    };

    let promises = [];
    let manifest = {};
    let base = project + "/" + asset + "/" + version;
    for (const [rpath, contents] of Object.entries(files)) {
        promises.push(env.BOUND_BUCKET.put(base + "/" + rpath, contents));
        manifest[rpath] = { size: contents.length, md5sum: computeHash(contents) };
    }
    await Promise.all(promises);

    await env.BOUND_BUCKET.put(base + "/..summary",
        JSON.stringify({
            upload_user_id: "chihaya-kisaragi",
            upload_start: (new Date).toISOString(),
            upload_finish: (new Date).toISOString(),
        }),
        jsonmeta
    );

    await env.BOUND_BUCKET.put(base + "/..manifest", JSON.stringify(manifest), jsonmeta);

    let upath = project + "/..usage";
    let usage = await (await env.BOUND_BUCKET.get(upath)).json();
    for (const x of Object.values(files)) {
        usage.total += x.length;
    }
    await env.BOUND_BUCKET.put(upath, JSON.stringify(usage), jsonmeta);

    let latest = { version: version };
    await env.BOUND_BUCKET.put(project + "/" + asset + "/..latest", JSON.stringify(latest), jsonmeta);

    return files;
}

export async function simpleMockProject(env) {
    await createMockProject("test", env);
    return mockProjectVersion("test", "blob", "v1", env);
}

export async function probationalize(project, asset, version, env) {
    let sumpath = project + "/" + asset + "/" + version + "/..summary";
    let existing = await (await env.BOUND_BUCKET.get(sumpath)).json();
    existing.on_probation = true;
    await env.BOUND_BUCKET.put(sumpath, JSON.stringify(existing), jsonmeta);
}

export async function fetchLogs(env) {
    let listing = await env.BOUND_BUCKET.list({ prefix: "..logs/" }); 
    if (listing.truncated) {
        throw new Error("tests should not create enough logs to truncate the listing!");
    }
    let found_logs = [];
    for (const f of listing.objects) {
        let payload = await (await env.BOUND_BUCKET.get(f.key)).json();
        found_logs.push(payload);
    }
    return found_logs;
}
