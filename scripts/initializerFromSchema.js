const known_mappings = { integer: "INTEGER", number: "REAL", boolean: "INTEGER", string: "TEXT" };

export function initializerFromSchema(schema, { name = "initialize" } = {}) {
    let main_table = [
        ["_project", "TEXT"],
        ["_asset", "TEXT"],
        ["_version", "TEXT"],
        ["_path", "TEXT"],
        ["_object", "TEXT"]
    ];
    let fts_table = [];
    let commands = [];

    for (const [n, x] of Object.entries(schema.properties)) {
        if (x.type == "string") {
            if ("_attributes" in x && x._attributes.indexOf("free_text") >= 0) {
                fts_table.push(n);
            } else {
                main_table.push([n, known_mappings[x.type]]);
            }

        } else if (x.type == "array") {
            let table_name = "multi_" + n;
            commands.push(`DROP TABLE IF EXISTS ${table_name}`);
            let itype = x.items.type;

            if (itype in known_mappings) {
                commands.push(`CREATE TABLE ${table_name} (_key TEXT NOT NULL, item ${known_mappings[itype]});`);
                commands.push(`CREATE INDEX index_${table_name} ON ${table_name} (item);`);

            } else if (x.items.type == "object") {
                let components = [];
                for (const [n2, x2] of Object.entries(x.items.properties)) {
                    let ptype = x2.type;
                    if (!(ptype in known_mappings)) {
                        throw new Error("don't know how to convert type '" + ptype + "' for property '" + n + "." + n2 + "' into a SQL field");
                    }
                    components.push(n2 + " " + known_mappings[ptype]);
                }
                commands.push(`CREATE TABLE ${table_name} (_key TEXT NOT NULL, ${components});`);
                for (const n2 of Object.keys(x.items.properties)) {
                    commands.push(`CREATE INDEX index_${table_name}_${n2} ON ${table_name} (${n2});`);
                }

            } else {
                throw new Error("don't know how to convert type '" + itype + "' for items of property '" + n + "' into a SQL field");
            }

        } else if (x.type in known_mappings) {
            main_table.push([n, known_mappings[x.type]]);

        } else {
            throw new Error("don't know how to convert type '" + x.type + "' for property '" + n + "' into a SQL field");
        }
    }

    commands.push("DROP TABLE IF EXISTS overlord;");
    commands.push(`CREATE TABLE overlord (_key TEXT PRIMARY_KEY, ${main_table.map(y => y[0] + " " + y[1])});`);
    for (const y of main_table) {
        commands.push(`CREATE INDEX index_overlord_${y[0]} ON overlord(${y[0]});`);
    }

    commands.push("DROP TABLE IF EXISTS free_text;");
    if (fts_table.length) {
        commands.push(`CREATE VIRTUAL TABLE free_text USING fts5(_key, ${fts_table});`);
    }

    // Formatting the output.
    let body = "{\n    return `\n" + commands.join("\n") + "`;\n}";
    if (name !== null) {
        return "function " + name + "() " + body;
    } else {
        return "() => " + body;
    }
}
