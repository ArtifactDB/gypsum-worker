import * as change from "../src/changelog.js";
import * as uchange from "../src/utils/changelog.js";
import * as s3 from "../src/utils/s3.js";

test("changelog flushing works as expected", async () => {
    const env = getMiniflareBindings();
    let path = await uchange.addChangelog({ whee: 1, blah: 2 }, env);

    let now = Date.now();
    let path2 = await uchange.addChangelog({ foo: 1, bar: 2 }, env, { time: new Date(now - 6 * 24 * 60 * 60 * 1000) });
    let path3 = await uchange.addChangelog({ foo: 1, bar: 2 }, env, { time: new Date(now - 10 * 24 * 60 * 60 * 1000) });

    await change.flushOldChangelogsHandler({ scheduledTime: Date.now() }, env);
    {
        let remaining = [];
        await s3.listApply("..logs/", f => remaining.push(f), env);
        remaining.sort();
        expect(remaining).toEqual([path2, path]);
    }

    await change.flushOldChangelogsHandler({ scheduledTime: Date.now() + 7 * 24 * 60 * 60 * 1000 }, env);
    {
        let remaining = [];
        await s3.listApply("..logs/", f => remaining.push(f), env);
        expect(remaining.length).toBe(0);
    }
})
