import * as lock from "../../src/utils/lock.js";
import * as setup from "../setup.js";

test("project locking works as expected", async () => {
    const env = getMiniflareBindings();

    let token = crypto.randomUUID();
    await lock.lockProject("test-lock-test", "locker", "v1", token, env);

    let lck = await env.BOUND_BUCKET.get("test-lock-test/..LOCK");
    let lckbody = await lck.json();
    expect(typeof lckbody.session_hash).toBe("string");
    expect(lckbody.session_hash).not.toBe(token);

    await lock.checkLock("test-lock-test", "locker", "v1", token, env); // OK
    await setup.expectError(lock.checkLock("test-lock-test", "locker", "v1", crypto.randomUUID(), env), "different upload session");
    await setup.expectError(lock.checkLock("test-lock-test", "locker", "v1", "chihaya-kisaragi", env), "v4 UUID");
    await setup.expectError(lock.checkLock("test-lock-test", "foobar", "v1", token, env), "different asset");
    await setup.expectError(lock.checkLock("test-lock-test", "locker", "v2", token, env), "different version");
    await setup.expectError(lock.checkLock("test-lock-test2", "locker", "v1", token, env), "not been previously locked");

    expect(await lock.isLocked("test-lock-test", env)).toBe(true);
    await lock.unlockProject("test-lock-test", env);
    expect(await lock.isLocked("test-lock-test", env)).toBe(false);
})
