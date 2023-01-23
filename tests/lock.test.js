import * as f_ from "../src/index.js";
import * as lock from "../src/lock.js";
import * as utils from "./utils.js";

test("project locking works as expected", async () => {
    await lock.lockProject("test-lock-test", "locker", "chihaya-kisaragi");

    let lck = await BOUND_BUCKET.get("test-lock-test/locker/..LOCK");
    let lckbody = await lck.json();
    expect(lckbody.user_name).toBe("chihaya-kisaragi");

    await lock.checkLock("test-lock-test", "locker", "chihaya-kisaragi"); // OK
    utils.expectError(lock.checkLock("test-lock-test", "locker", "allisonvuong"), "different user");
    utils.expectError(lock.checkLock("test-lock-test2", "locker", "chihaya-kisaragi"), "not been previously locked");

    expect(await lock.isLocked("test-lock-test", "locker")).toBe(true);
    expect(await lock.isLocked("test-lock-test", "other")).toBe(false);
})
