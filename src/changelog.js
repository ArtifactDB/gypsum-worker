import * as s3 from "./utils/s3.js";

export async function flushOldChangelogsHandler(event, env, { expiry = 7 } = {}) {
    let limit = new Date(event.scheduledTime - expiry * 24 * 60 * 60 * 1000)
    let limitstr = limit.toISOString();

    let allocated = [];
    await s3.listApply(
        "..logs/",
        f => {
            if (f < limitstr) {
                allocated.push(env.BOUND_BUCKET.delete("..logs/" + f));
            }
        },
        env
    );

    await Promise.all(allocated);
    return;
}
