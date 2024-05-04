import * as s3 from "../../src/utils/s3.js";

test("quick JSON uploading works as expected", async () => {
    const env = getMiniflareBindings();

    // No custom metadata.
    {
        await s3.quickUploadJson("urmom.txt", { "name": "Your", "value": "Mom" }, env);
        let res = await env.BOUND_BUCKET.get("urmom.txt");
        let body = await res.json();
        expect(body.name).toBe("Your");
        expect(body.value).toBe("Mom");
        await env.BOUND_BUCKET.delete("urmom.txt");
    }

    // Adding custom metadata.
    {
        await s3.quickUploadJson("urmom.txt", { "name": "Your", "value": "Mom" }, env, { custom: { "link": "FOO" } });
        let res = await env.BOUND_BUCKET.head("urmom.txt");
        expect(res.customMetadata.link).toBe("FOO");
        await env.BOUND_BUCKET.delete("urmom.txt");
    }
})

test("listApply works as expected", async () => {
    const env = getMiniflareBindings();
    await s3.quickUploadJson("alpha/alex.txt", [ "Union" ], env);
    await s3.quickUploadJson("alpha/bravo/bar.txt", [ "Flyers!!!" ], env);
    await s3.quickUploadJson("alpha/bravo2/stuff.txt", [ "Glow Map" ], env);
    await s3.quickUploadJson("charlie/whee.txt", [ "Harmony 4 You" ], env);

    // Recursive mode:
    {
        let survivors = [];
        await s3.listApply("alpha/", f => survivors.push(f), env);
        survivors.sort();
        expect(survivors).toEqual(["alex.txt", "bravo/bar.txt", "bravo2/stuff.txt"]);
    }

    {
        let survivors = [];
        await s3.listApply("alpha/", f => survivors.push(f), env, { trimPrefix: false });
        survivors.sort();
        expect(survivors).toEqual(["alpha/alex.txt", "alpha/bravo/bar.txt", "alpha/bravo2/stuff.txt"]);
    }

    {
        let survivors = [];
        await s3.listApply("alpha/", f => survivors.push(f.key), env, { namesOnly: false });
        survivors.sort();
        expect(survivors).toEqual(["alpha/alex.txt", "alpha/bravo/bar.txt", "alpha/bravo2/stuff.txt"]);
    }

    {
        let survivors = [];
        await s3.listApply("alpha/bravo", f => survivors.push(f.key), env, { namesOnly: false });
        survivors.sort();
        expect(survivors).toEqual(["alpha/bravo/bar.txt", "alpha/bravo2/stuff.txt"]);
    }

    {
        let survivors = [];
        await s3.listApply("alpha/bravo/", f => survivors.push(f), env);
        survivors.sort();
        expect(survivors).toEqual(["bar.txt"]);
    }

    {
        let survivors = [];
        await s3.listApply(null, f => { survivors.push(f.key); }, env, { list_limit: 1, namesOnly: false }); // forcing iteration.
        survivors.sort();
        expect(survivors).toEqual(["alpha/alex.txt", "alpha/bravo/bar.txt", "alpha/bravo2/stuff.txt", "charlie/whee.txt"]);
    }

    // Non-recursive mode:
    {
        let survivors = [];
        await s3.listApply("alpha/", p => survivors.push(p), env, { local: true });
        survivors.sort();
        expect(survivors).toEqual(["alex.txt", "bravo", "bravo2"]);
    }

    {
        let survivors = [];
        await s3.listApply("alpha/", p => survivors.push(p), env, { local: true, trimPrefix: false });
        survivors.sort();
        expect(survivors).toEqual(["alpha/alex.txt", "alpha/bravo", "alpha/bravo2"]);
    }

    // Don't trim the trailing slash.
    {
        let survivors = [];
        await s3.listApply("alpha/", p => survivors.push(p), env, { local: true, stripTrailingSlash: false });
        survivors.sort();
        expect(survivors).toEqual(["alex.txt", "bravo/", "bravo2/"]);
    }
})

test("quick recursive delete works as expected", async () => {
    const env = getMiniflareBindings();

    var it = 0;
    while (true) {
        await s3.quickUploadJson("alpha/foo.txt", [ "Yuka Nakano", "Yukino Aihara" ], env);
        await s3.quickUploadJson("alpha/bravo/bar.txt", [ "Kanako Mimura" ], env);
        await s3.quickUploadJson("alpha/bravo/stuff.txt", [ "Miria Akagi" ], env);
        await s3.quickUploadJson("alpha/bravo-foo/whee.txt", [ "Yumi Aiba" ], env);

        if (it == 0) {
            await s3.quickRecursiveDelete("alpha/bravo/", env);
            expect(await env.BOUND_BUCKET.head("alpha/foo.txt")).not.toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo/bar.txt")).toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo/stuff.txt")).toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo-foo/whee.txt")).not.toBeNull();
        } else if (it == 1) {
            await s3.quickRecursiveDelete("alpha/bravo-foo/whee.txt", env);
            expect(await env.BOUND_BUCKET.head("alpha/foo.txt")).not.toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo/bar.txt")).not.toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo/stuff.txt")).not.toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo-foo/whee.txt")).toBeNull();
        } else if (it == 2) {
            await s3.quickRecursiveDelete("alpha/", env);
            expect(await env.BOUND_BUCKET.head("alpha/foo.txt")).toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo/bar.txt")).toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo/stuff.txt")).toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo-foo/whee.txt")).toBeNull();
        } else if (it == 3) {
            await s3.quickRecursiveDelete("alpha/", env, { list_limit: 1 }); // setting a list limit of 1 to force iteration.
            expect(await env.BOUND_BUCKET.head("alpha/foo.txt")).toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo/bar.txt")).toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo/stuff.txt")).toBeNull();
            expect(await env.BOUND_BUCKET.head("alpha/bravo-foo/whee.txt")).toBeNull();
        } else {
            break;
        }
        it++;
    }
})
