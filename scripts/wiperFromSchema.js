export function wiperFromSchema(schema, { name = "wipe" } = {}) {
    const tables = new Set(["overlord"]);

    for (const [n, x] of Object.entries(schema.properties)) {
        if (x.type == "string") {
            if ("_attributes" in x && x._attributes.indexOf("free_text") >= 0) {
                tables.add("free_text");
            }
        } else if (x.type == "array") {
            tables.add("multi_" + n);
        }
    }

    let commands = [];
    commands.push(`
statements.push({
    statement: \`CREATE TEMP TABLE tmp_deleted AS SELECT _key FROM overlord WHERE _project = ? AND _asset = ?;\`,
    parameters: [ project, asset ]
});`)

    for (const tab of tables) {
        commands.push(`
statements.push({
    statement: "DELETE FROM ${tab} WHERE _key IN (SELECT _key FROM tmp_deleted);",
    parameters: null
});`);
    }

    // Formatting the output.
    let code = "";
    if (name !== null) {
        code += "function " + name;
    }
    code += "(project, asset)";
    if (name === null) {
        code += " =>"
    }
    code += " {\n";
    code += "    const statements = [];\n";
    for (const cmd of commands) {
        code += cmd.replaceAll("\n", "\n    ");
    }
    code += "\n    return statements;\n}";

    return code;
}
