import * as f_ from "../../src/index.js"; // need this to set the bucket bindings.
import * as quot from "../../src/utils/quota.js";
import * as setup from "../setup.js";

test("getProjectUsage works correctly", async () => {
    await setup.simpleMockProject();

    let raw_manifest = await BOUND_BUCKET.get("test/blob/v1/..manifest");
    let manifest = await raw_manifest.json();
    let expected = 0;
    for (const x of Object.values(manifest)) {
        expected += x.size;
    }

    let total = await quot.getProjectUsage("test");
    expect(total).toBe(expected);
})

test("validateQuota works correctly", () => {
    expect(quot.validateQuota({ baseline: 1e9, growth_rate: 2e9 })).toBeUndefined();
    expect(quot.validateQuota({})).toBeUndefined();

    expect(() => quot.validateQuota([])).toThrow("JSON object");
    expect(() => quot.validateQuota({ baseline: "foo" })).toThrow("'baseline' to be a number");
    expect(() => quot.validateQuota({ baseline: -1 })).toThrow("'baseline' to be a non-negative number");
    expect(() => quot.validateQuota({ growth_rate: "foo" })).toThrow("'growth_rate' to be a number");
    expect(() => quot.validateQuota({ growth_rate: -1 })).toThrow("'growth_rate' to be a non-negative number");
    expect(() => quot.validateQuota({ year: "foo" })).toThrow("'year' to be a number");
    expect(() => quot.validateQuota({ year: -1 })).toThrow("'year' to be a non-negative number");
})

test("computeQuota works correctly", async () => {
    await setup.createMockProject("test");
    let val = await quot.computeQuota("test");
    expect(typeof val).toBe("number"); // can't do better than this as we don't know the year of the CI machine.
    expect(Number.isNaN(val)).toBe(false);
})