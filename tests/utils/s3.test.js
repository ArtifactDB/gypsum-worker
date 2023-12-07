import * as f_ from "../../src/index.js";
import * as s3 from "../../src/utils/s3.js";

test("quick JSON uploading works as expected", async () => {
    // No custom metadata.
    {
        await s3.quickUploadJson("urmom.txt", { "name": "Your", "value": "Mom" });
        let res = await BOUND_BUCKET.get("urmom.txt");
        let body = await res.json();
        expect(body.name).toBe("Your");
        expect(body.value).toBe("Mom");
        await BOUND_BUCKET.delete("urmom.txt");
    }

    // Adding custom metadata.
    {
        await s3.quickUploadJson("urmom.txt", { "name": "Your", "value": "Mom" }, { "link": "FOO" });
        let res = await BOUND_BUCKET.head("urmom.txt");
        expect(res.customMetadata.link).toBe("FOO");
        await BOUND_BUCKET.delete("urmom.txt");
    }
})

test("listApply works as expected", async () => {
    await s3.quickUploadJson("alpha/alex.txt", [ "Union" ]);
    await s3.quickUploadJson("alpha/bravo/bar.txt", [ "Flyers!!!" ]);
    await s3.quickUploadJson("alpha/bravo2/stuff.txt", [ "Glow Map" ]);
    await s3.quickUploadJson("charlie/whee.txt", [ "Harmony 4 You" ]);

    // Recursive mode:
    {
        let survivors = [];
        await s3.listApply("alpha/", f => survivors.push(f));
        survivors.sort();
        expect(survivors).toEqual(["alex.txt", "bravo/bar.txt", "bravo2/stuff.txt"]);
    }

    {
        let survivors = [];
        await s3.listApply("alpha/", f => survivors.push(f), { trimPrefix: false });
        survivors.sort();
        expect(survivors).toEqual(["alpha/alex.txt", "alpha/bravo/bar.txt", "alpha/bravo2/stuff.txt"]);
    }

    {
        let survivors = [];
        await s3.listApply("alpha/", f => survivors.push(f.key), { namesOnly: false });
        survivors.sort();
        expect(survivors).toEqual(["alpha/alex.txt", "alpha/bravo/bar.txt", "alpha/bravo2/stuff.txt"]);
    }

    {
        let survivors = [];
        await s3.listApply("alpha/bravo", f => survivors.push(f.key), { namesOnly: false });
        survivors.sort();
        expect(survivors).toEqual(["alpha/bravo/bar.txt", "alpha/bravo2/stuff.txt"]);
    }

    {
        let survivors = [];
        await s3.listApply("alpha/bravo/", f => survivors.push(f));
        survivors.sort();
        expect(survivors).toEqual(["bar.txt"]);
    }

    {
        let survivors = [];
        await s3.listApply(null, f => { survivors.push(f.key); }, { list_limit: 1, namesOnly: false }); // forcing iteration.
        survivors.sort();
        expect(survivors).toEqual(["alpha/alex.txt", "alpha/bravo/bar.txt", "alpha/bravo2/stuff.txt", "charlie/whee.txt"]);
    }

    // Non-recursive mode:
    {
        let survivors = [];
        await s3.listApply("alpha/", p => survivors.push(p), { local: true });
        survivors.sort();
        expect(survivors).toEqual(["alex.txt", "bravo", "bravo2"]);
    }

    {
        let survivors = [];
        await s3.listApply("alpha/", p => survivors.push(p), { local: true, trimPrefix: false });
        survivors.sort();
        expect(survivors).toEqual(["alpha/alex.txt", "alpha/bravo", "alpha/bravo2"]);
    }
})

test("quick recursive delete works as expected", async () => {
    var it = 0;
    while (true) {
        await s3.quickUploadJson("alpha/foo.txt", [ "Yuka Nakano", "Yukino Aihara" ]);
        await s3.quickUploadJson("alpha/bravo/bar.txt", [ "Kanako Mimura" ]);
        await s3.quickUploadJson("alpha/bravo/stuff.txt", [ "Miria Akagi" ]);
        await s3.quickUploadJson("alpha/bravo-foo/whee.txt", [ "Yumi Aiba" ]);

        if (it == 0) {
            await s3.quickRecursiveDelete("alpha/bravo/");
            expect(await BOUND_BUCKET.head("alpha/foo.txt")).not.toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo/bar.txt")).toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo/stuff.txt")).toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo-foo/whee.txt")).not.toBeNull();
        } else if (it == 1) {
            await s3.quickRecursiveDelete("alpha/bravo-foo/whee.txt");
            expect(await BOUND_BUCKET.head("alpha/foo.txt")).not.toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo/bar.txt")).not.toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo/stuff.txt")).not.toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo-foo/whee.txt")).toBeNull();
        } else if (it == 2) {
            await s3.quickRecursiveDelete("alpha/");
            expect(await BOUND_BUCKET.head("alpha/foo.txt")).toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo/bar.txt")).toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo/stuff.txt")).toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo-foo/whee.txt")).toBeNull();
        } else if (it == 3) {
            await s3.quickRecursiveDelete("alpha/", { list_limit: 1 }); // setting a list limit of 1 to force iteration.
            expect(await BOUND_BUCKET.head("alpha/foo.txt")).toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo/bar.txt")).toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo/stuff.txt")).toBeNull();
            expect(await BOUND_BUCKET.head("alpha/bravo-foo/whee.txt")).toBeNull();
        } else {
            break;
        }
        it++;
    }
})
