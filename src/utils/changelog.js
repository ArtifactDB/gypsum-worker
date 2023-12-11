import * as s3 from "./s3.js";

export async function addChangelog(message, env, { time = null } = {}) {
    if (time == null) {
        time = new Date;
    }

    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    let identifier = String(array[0] % 900000 + 100000);

    let path = time.toISOString() + "_" + identifier;
    await s3.quickUploadJson("..logs/" + path, message, env);
    return path;
}
