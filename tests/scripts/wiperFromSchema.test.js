import * as init from "../../scripts/initializerFromSchema.js";
import * as convert from "../../scripts/converterFromSchema.js";
import * as wipe from "../../scripts/wiperFromSchema.js";
import schema from "../../schemas/bioconductor.json";
import { examples } from "./examples.js";
import { createSQLiteDB } from "@miniflare/shared";
import { D1Database, D1DatabaseAPI } from "@miniflare/d1";

test("converterFromSchema works as expected", async () => {
    const icmd = init.initializerFromSchema(schema, { name: null });
    let initialize = eval(icmd);
    let initialized = initialize();

    const ccmd = convert.converterFromSchema(schema, { name: null });
    let converter = eval(ccmd);
    let statements0 = converter("foo", "bar", "v1", "asd/asd", "summarized_experiment", examples[0]); 
    let statements1 = converter("blam", "bloo", "v1", "asd/asd", "summarized_experiment", examples[1]); 

    const wcmd = wipe.wiperFromSchema(schema, { name: null });
    console.log(wcmd);
    let wiper = eval(wcmd);
    let wstatements = wiper("foo", "bar");

    // Now checking whether they run.
    const sqliteDb = await createSQLiteDB(":memory:");
    const db = new D1Database(new D1DatabaseAPI(sqliteDb));
    await db.exec(initialized);

    let batched0 = [];
    for (const s of statements0) {
        batched0.push(db.prepare(s.statement).bind(...(s.parameters)));
    }
    await db.batch(batched0);

    let batched1 = [];
    for (const s of statements1) {
        batched1.push(db.prepare(s.statement).bind(...(s.parameters)));
    }
    await db.batch(batched1);

    // Checking that we have entries in each of the tables.
    let res = await db.prepare("SELECT COUNT(*) FROM multi_genome").all();
    expect(res.results[0]["COUNT(*)"]).toBe(4);

    res = await db.prepare("SELECT COUNT(*) FROM multi_taxonomy_id").all();
    expect(res.results[0]["COUNT(*)"]).toBe(3);

    res = await db.prepare("SELECT COUNT(*) FROM overlord").all();
    expect(res.results[0]["COUNT(*)"]).toBe(2);

    res = await db.prepare("SELECT COUNT(*) FROM free_text").all();
    expect(res.results[0]["COUNT(*)"]).toBe(2);

    // Now, wiping one of the assets.
    let wipes = [];
    for (const s of wstatements) {
        let prep = db.prepare(s.statement);
        if (s.parameters !== null) {
            prep = prep.bind(...(s.parameters));
        }
        wipes.push(prep);
    }
    await db.batch(wipes);

    // Checking that the wipe was successful.
    res = await db.prepare("SELECT COUNT(*) FROM multi_genome").all();
    expect(res.results[0]["COUNT(*)"]).toBe(1);

    res = await db.prepare("SELECT COUNT(*) FROM multi_taxonomy_id").all();
    expect(res.results[0]["COUNT(*)"]).toBe(1);

    res = await db.prepare("SELECT COUNT(*) FROM overlord").all();
    expect(res.results[0]["COUNT(*)"]).toBe(1);

    res = await db.prepare("SELECT COUNT(*) FROM free_text").all();
    expect(res.results[0]["COUNT(*)"]).toBe(1);
})
