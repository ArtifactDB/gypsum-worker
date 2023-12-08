import * as f_ from "../../src/index.js"; // need this to set the bucket bindings.
import * as version from "../../src/utils/version.js";
import * as s3 from "../../src/utils/s3.js";
import * as setup from "../setup.js";

test("updateLatestVersion works correctly", async () => {
    await setup.simpleMockProject();
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "foobar");
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "whee");

    expect(await version.updateLatestVersion("test", "blob")).toBe("whee");
    expect((await (await BOUND_BUCKET.get("test/blob/..latest")).json()).version).toBe("whee");

    await s3.quickRecursiveDelete("test/blob/whee/");
    expect(await version.updateLatestVersion("test", "blob")).toBe("foobar");
    expect((await (await BOUND_BUCKET.get("test/blob/..latest")).json()).version).toBe("foobar");

    await s3.quickRecursiveDelete("test/blob/foobar/");
    expect(await version.updateLatestVersion("test", "blob")).toBe("v1");
    expect((await (await BOUND_BUCKET.get("test/blob/..latest")).json()).version).toBe("v1");

    await s3.quickRecursiveDelete("test/blob/v1/");
    expect(await version.updateLatestVersion("test", "blob")).toBeNull();
    expect(await BOUND_BUCKET.get("test/blob/..latest")).toBeNull();
})

test("updateLatestVersion doesn't save anything if there are no versions", async () => {
    await setup.createMockProject("test");
    expect(await version.updateLatestVersion("test", "not-present")).toBeNull();

    let listing = [];
    await s3.listApply("test/not-present/", f => listing.push(f));
    expect(listing.length).toEqual(0);
})

test("updateLatestVersion skips probational versions", async () => {
    await setup.simpleMockProject();
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "foobar");
    await new Promise(r => setTimeout(r, 100));
    await setup.mockProjectVersion("test", "blob", "whee");

    await setup.probationalize("test", "blob", "whee");
    expect(await version.updateLatestVersion("test", "blob")).toBe("foobar");
    expect((await (await BOUND_BUCKET.get("test/blob/..latest")).json()).version).toBe("foobar");

    await setup.probationalize("test", "blob", "foobar");
    expect(await version.updateLatestVersion("test", "blob")).toBe("v1");
    expect((await (await BOUND_BUCKET.get("test/blob/..latest")).json()).version).toBe("v1");

    await setup.probationalize("test", "blob", "v1");
    expect(await version.updateLatestVersion("test", "blob")).toBeNull();
    expect(await BOUND_BUCKET.get("test/blob/..latest")).toBeNull();
})
