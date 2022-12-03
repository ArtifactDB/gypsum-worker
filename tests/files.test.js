import * as f_ from "../src/index.js";
import * as files from "../src/files.js";
import * as setup from "./setup.js";

beforeAll(async () => setup.mockProject("test-public", "base"));

test("version metadata getter works correctly", async () => {
    let stuff = await BOUND_BUCKET.get("test-public/base/whee.txt.json");
    console.log(await stuff.json());
//    let deets = await files.getVersionMetadataOrNull("test-public", "base", []);
//    console.log(deets);
});
