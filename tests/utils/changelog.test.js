import * as change from "../../src/utils/changelog.js";

test("changelog addition works as expected", async () => {
    const env = getMiniflareBindings();

    let path = await change.addChangelog({ whee: 1, blah: 2 }, env);
    expect(path).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/);
    expect(path).toMatch(/_[0-9]{6}$/);
    expect(await (await env.BOUND_BUCKET.get("..logs/" + path)).json()).toEqual({whee:1, blah:2});

    let path2 = await change.addChangelog({ foo: 1, bar: 2 }, env, { time: new Date(Date.now() + 10000) });
    expect(path2 > path);

    let path3 = await change.addChangelog({ foo: 1, bar: 2 }, env, { time: new Date(Date.now() - 100000) });
    expect(path3 < path);
})
