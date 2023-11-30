import * as f_ from "../src/index.js";
import * as other from "../src/utils.js";
import * as utils from "./utils.js";

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

test("caching of JSON payloads works correctly", async () => {
    const testcache = await caches.open("test_cache");
    let key = new Request("https://www.foobar.com/downloads");
    await other.quickCacheJson(testcache, key, { "eagle": 1, "falcon": 2 }, 2); // expires in a few seconds.

    let res = await testcache.match(key);
    let body = await res.json();
    expect(body.eagle).toBe(1);
    expect(body.falcon).toBe(2);

    // Check that it expired properly.
    await new Promise(resolve => setTimeout(resolve, 2000));
    let res2 = await testcache.match(key);
    expect(res2).toBeUndefined();
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
