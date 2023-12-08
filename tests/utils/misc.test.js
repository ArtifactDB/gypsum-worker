import * as f_ from "../../src/index.js";
import * as misc from "../../src/utils/misc.js";

test("named resolve works as expected", async () => {
    let res = await misc.namedResolve({
        A: new Promise(resolve => resolve(1)),
        B: new Promise(resolve => resolve(2))
    });
    expect(res.A).toBe(1);
    expect(res.B).toBe(2);

    // Works empty.
    let eres = await misc.namedResolve({});
    expect(eres).toEqual({});
});

test("splitPath works correctly", () => {
    let split = misc.splitPath("asdasd");
    expect(split[0]).toBe("");
    expect(split[1]).toBe("asdasd");

    split = misc.splitPath("asd/whee/foobar");
    expect(split[0]).toBe("asd/whee");
    expect(split[1]).toBe("foobar");
})
