import * as f_ from "../../src/index.js";
import * as lock from "../../src/utils/lock.js";
import * as setup from "../setup.js";

test("project locking works as expected", async () => {
    await lock.lockProject("test-lock-test", "locker", "v1", "chihaya-kisaragi");

    let lck = await BOUND_BUCKET.get("test-lock-test/..LOCK");
    let lckbody = await lck.json();
    expect(lckbody.user_name).toBe("chihaya-kisaragi");

    await lock.checkLock("test-lock-test", "locker", "v1", "chihaya-kisaragi"); // OK
    setup.expectError(lock.checkLock("test-lock-test", "locker", "v1", "allisonvuong"), "different user");
    setup.expectError(lock.checkLock("test-lock-test", "foobar", "v1", "chihaya-kisaragi"), "different asset");
    setup.expectError(lock.checkLock("test-lock-test", "locker", "v2", "chihaya-kisaragi"), "different version");
    setup.expectError(lock.checkLock("test-lock-test2", "locker", "v1", "chihaya-kisaragi"), "not been previously locked");

    expect(await lock.isLocked("test-lock-test")).toBe(true);
    await lock.unlockProject("test-lock-test");
    expect(await lock.isLocked("test-lock-test")).toBe(false);
})
