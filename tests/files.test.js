import * as f_ from "../src/index.js";
import * as files from "../src/files.js";
import * as setup from "./setup.js";

beforeAll(async () => setup.mockPublicProject());

test("version metadata getter works correctly", async () => {
    let nb = [];
    let deets = await files.getVersionMetadataOrNull("test-public", "base", nb);
    expect(deets).not.toBeNull();
    expect("upload_time" in deets).toBe(true);
    expect(nb.length).toBeGreaterThan(0);
    await Promise.all(nb);

    // Successfully pulls it out of the cache.
    {
        let nb2 = [];
        let deets2 = await files.getVersionMetadataOrNull("test-public", "base", nb2);
        expect(deets2).toEqual(deets);
        expect(nb2.length).toBe(0);
    }

    // Returns null if the project or version doesn't exist.
    {
        let nb2 = [];
        let deets2 = await files.getVersionMetadataOrNull("test-public", "foo", nb2);
        expect(deets2).toBeNull();
    }
});
