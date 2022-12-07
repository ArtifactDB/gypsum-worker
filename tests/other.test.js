import * as f_ from "../src/index.js";
import * as other from "../src/utils.js";
import * as utils from "./utils.js";

test("ID packing and unpacking works correctly", () => {
    let packed = other.packId("test-public", "whee.txt", "base");
    expect(packed).toBe("test-public:whee.txt@base");

    let unpacked = other.unpackId(packed);
    expect(unpacked.project).toBe("test-public");
    expect(unpacked.path).toBe("whee.txt");
    expect(unpacked.version).toBe("base");

    expect(() => other.unpackId("test-public@base")).toThrow("could not identify project");
    expect(() => other.unpackId(":whee.txt@base")).toThrow("empty project");
    expect(() => other.unpackId("test-public:base")).toThrow("could not identify version");
    expect(() => other.unpackId("test-public:whee.txt@")).toThrow("empty version");

    expect(() => other.unpackId("test-public@whee.txt:base")).toThrow("could not identify path");
    expect(() => other.unpackId("test-public:@base")).toThrow("empty path");
})

test("JSON responses are correctly constructed", async () => {
    {
        let basic = other.jsonResponse({ "foo": "BAR" }, 202)
        expect(basic.headers.get("Content-Type")).toBe("application/json");
        expect(basic.status).toBe(202);

        let body = await basic.json();
        expect(body.foo).toBe("BAR");
    }

    // Responds to custom headers.
    {
        let basic = other.jsonResponse({ "foo": "BAR" }, 202, { "Content-MD5": "xxxx" })
        expect(basic.headers.get("Content-Type")).toBe("application/json");
        expect(basic.headers.get("Content-MD5")).toBe("xxxx");
    }
})

test("error responses are correctly constructed", async () => {
    let err = other.errorResponse("u suck", 401)
    expect(err.headers.get("Content-Type")).toBe("application/json");
    expect(err.status).toBe(401);

    let body = await err.json();
    expect(body.reason).toBe("u suck");
    expect(body.status).toBe("error");
})

test("time conversions are performed properly", () => {
    {
        let now = Date.now();
        let newtime = other.minutesFromNow(10);
        let delta = new Date(newtime) - now
        let expected = 10 * 60 * 1000;
        expect(Math.abs(delta - expected)).toBeLessThan(1000);
    }

    {
        let now = Date.now();
        let newtime = other.hoursFromNow(10);
        let delta = new Date(newtime) - now
        let expected = 10 * 3600 * 1000;
        expect(Math.abs(delta - expected)).toBeLessThan(1000);
    }
})

test("caching of JSON payloads works correctly", async () => {
    const testcache = await caches.open("test_cache");
    let key = "https://www.foobar.com/downloads";
    await other.quickCacheJson(testcache, key, { "eagle": 1, "falcon": 2 }, 2000); // expires in a few seconds.

    let res = await testcache.match(key);
    if (res) { // miniflare's cache API implementation doesn't seem to actually cache?
        let body = await res.json();
        expect(body.eagle).toBe(1);
        expect(body.falcon).toBe(2);

        await new Promise(resolve => setTimeout(2000, resolve));

        let res2 = await caches.get(key);
        expect(res2).toBeNull();
    }
})

test("quick JSON uploading works as expected", async () => {
    // No custom metadata.
    {
        await other.quickUploadJson("urmom.txt", { "name": "Your", "value": "Mom" });
        let res = await BOUND_BUCKET.get("urmom.txt");
        let body = await res.json();
        expect(body.name).toBe("Your");
        expect(body.value).toBe("Mom");
        await BOUND_BUCKET.delete("urmom.txt");
    }

    // Adding custom metadata.
    {
        await other.quickUploadJson("urmom.txt", { "name": "Your", "value": "Mom" }, { "link": "FOO" });
        let res = await BOUND_BUCKET.head("urmom.txt");
        expect(res.customMetadata.link).toBe("FOO");
        await BOUND_BUCKET.delete("urmom.txt");
    }
})

test("named resolve works as expected", async () => {
    let res = await other.namedResolve({
        A: new Promise(resolve => resolve(1)),
        B: new Promise(resolve => resolve(2))
    });
    expect(res.A).toBe(1);
    expect(res.B).toBe(2);

    // Works empty.
    let eres = await other.namedResolve({});
    expect(eres).toEqual({});
});
