import * as version from "../../src/utils/version.js";
import * as s3 from "../../src/utils/s3.js";
import * as setup from "../setup.js";

test("updateLatestVersion works correctly", async () => {
    const env = getMiniflareBindings();

    await setup.simpleMockProject(env);
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "foobar", env);
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "whee", env);

    expect(await version.updateLatestVersion("test", "blob", env)).toBe("whee");
    expect((await (await env.BOUND_BUCKET.get("test/blob/..latest")).json()).version).toBe("whee");

    await s3.quickRecursiveDelete("test/blob/whee/", env);
    expect(await version.updateLatestVersion("test", "blob", env)).toBe("foobar");
    expect((await (await env.BOUND_BUCKET.get("test/blob/..latest")).json()).version).toBe("foobar");

    await s3.quickRecursiveDelete("test/blob/foobar/", env);
    expect(await version.updateLatestVersion("test", "blob", env)).toBe("v1");
    expect((await (await env.BOUND_BUCKET.get("test/blob/..latest")).json()).version).toBe("v1");

    await s3.quickRecursiveDelete("test/blob/v1/", env);
    expect(await version.updateLatestVersion("test", "blob", env)).toBeNull();
    expect(await env.BOUND_BUCKET.get("test/blob/..latest")).toBeNull();
})

test("updateLatestVersion doesn't save anything if there are no versions", async () => {
    const env = getMiniflareBindings();

    await setup.createMockProject("test", env);
    expect(await version.updateLatestVersion("test", "not-present", env)).toBeNull();

    let listing = [];
    await s3.listApply("test/not-present/", f => listing.push(f), env);
    expect(listing.length).toEqual(0);
})

test("updateLatestVersion skips probational versions", async () => {
    const env = getMiniflareBindings();

    await setup.simpleMockProject(env);
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "foobar", env);
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "whee", env);

    await setup.probationalize("test", "blob", "whee", env);
    expect(await version.updateLatestVersion("test", "blob", env)).toBe("foobar");
    expect((await (await env.BOUND_BUCKET.get("test/blob/..latest")).json()).version).toBe("foobar");

    await setup.probationalize("test", "blob", "foobar", env);
    expect(await version.updateLatestVersion("test", "blob", env)).toBe("v1");
    expect((await (await env.BOUND_BUCKET.get("test/blob/..latest")).json()).version).toBe("v1");

    await setup.probationalize("test", "blob", "v1", env);
    expect(await version.updateLatestVersion("test", "blob", env)).toBeNull();
    expect(await env.BOUND_BUCKET.get("test/blob/..latest")).toBeNull();
})
