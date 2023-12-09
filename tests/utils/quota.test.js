import * as quot from "../../src/utils/quota.js";
import * as setup from "../setup.js";

test("getProjectUsage works correctly", async () => {
    const env = getMiniflareBindings();
    await setup.simpleMockProject(env);

    let raw_manifest = await env.BOUND_BUCKET.get("test/blob/v1/..manifest");
    let manifest = await raw_manifest.json();
    let expected = 0;
    for (const x of Object.values(manifest)) {
        expected += x.size;
    }

    let total = await quot.getProjectUsage("test", env);
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
    const env = getMiniflareBindings();
    await setup.createMockProject("test", env);
    let val = await quot.computeQuota("test", env);
    expect(typeof val).toBe("number"); // can't do better than this as we don't know the year of the CI machine.
    expect(Number.isNaN(val)).toBe(false);
})

test("updateQuotaOnDeletion works correctly", async () => {
    const env = getMiniflareBindings();
    await setup.createMockProject("test", env, { usage: { total: 10 } });

    await quot.updateQuotaOnDeletion("test", 1, env);
    let usage = await (await env.BOUND_BUCKET.get("test/..usage")).json();
    expect(usage.total).toBe(9);

    await quot.updateQuotaOnDeletion("test", 1000000, env);
    usage = await (await env.BOUND_BUCKET.get("test/..usage")).json();
    expect(usage.total).toBe(0);
})
