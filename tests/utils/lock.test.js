import * as f_ from "../../src/index.js";
import * as lock from "../../src/utils/lock.js";
import * as setup from "../setup.js";

test("project locking works as expected", async () => {
    let token = crypto.randomUUID();
    await lock.lockProject("test-lock-test", "locker", "v1", token);

    let lck = await BOUND_BUCKET.get("test-lock-test/..LOCK");
    let lckbody = await lck.json();
    expect(typeof lckbody.session_hash).toBe("string");
    expect(lckbody.session_hash).not.toBe(token);

    await lock.checkLock("test-lock-test", "locker", "v1", token); // OK
    await setup.expectError(lock.checkLock("test-lock-test", "locker", "v1", crypto.randomUUID()), "different upload session");
    await setup.expectError(lock.checkLock("test-lock-test", "locker", "v1", "chihaya-kisaragi"), "v4 UUID");
    await setup.expectError(lock.checkLock("test-lock-test", "foobar", "v1", token), "different asset");
    await setup.expectError(lock.checkLock("test-lock-test", "locker", "v2", token), "different version");
    await setup.expectError(lock.checkLock("test-lock-test2", "locker", "v1", token), "not been previously locked");

    expect(await lock.isLocked("test-lock-test")).toBe(true);
    await lock.unlockProject("test-lock-test");
    expect(await lock.isLocked("test-lock-test")).toBe(false);
})
