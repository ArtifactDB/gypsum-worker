import * as init from "../../scripts/initializerFromSchema.js";
import schema from "../../schemas/bioconductor.json";
import { createSQLiteDB } from "@miniflare/shared";
import { D1Database, D1DatabaseAPI } from "@miniflare/d1";

test("initializerFromSchema works as expected", async () => {
    const cmd = init.initializerFromSchema(schema, { name: null });
    let initialize = eval(cmd);
    let initialized = initialize();

    const sqliteDb = await createSQLiteDB(":memory:");
    const db = new D1Database(new D1DatabaseAPI(sqliteDb));
    await db.exec(initialized);

    let listing = await db.batch([db.prepare("PRAGMA table_list")]);
    let available = listing[0].results.map(y => y.name);
    expect(available.indexOf("overlord") >= 0).toBe(true);
    expect(available.indexOf("free_text") >= 0).toBe(true);
    expect(available.indexOf("multi_sources") >= 0).toBe(true);
    expect(available.indexOf("multi_genome") >= 0).toBe(true);
    expect(available.indexOf("multi_taxonomy_id") >= 0).toBe(true);

    // Running again on existing tables will wipe existing results.
    await db.prepare("INSERT INTO multi_genome(_key, item) VALUES('foo', 'blah')").run();
    let res = await db.prepare("SELECT COUNT(*) FROM multi_genome").all();
    expect(res.results[0]["COUNT(*)"]).toBe(1);

    await db.exec(initialized);
    res = await db.prepare("SELECT COUNT(*) FROM multi_genome").all();
    expect(res.results[0]["COUNT(*)"]).toBe(0);
})
