export function converterFromSchema(schema, { name = "convert" } = {}) {
    let overlord_inserts = [];
    let free_text_inserts = [];
    let array_simple = {};
    let array_complex = {};

    for (const [n, x] of Object.entries(schema.properties)) {
        if (x.type == "string") {
            if ("_attributes" in x && x._attributes.indexOf("free_text") >= 0) {
                free_text_inserts.push(n);
            } else {
                overlord_inserts.push(n);
            }

        } else if (x.type == "array") {
            let table_name = "multi_" + n;
            if (x.items.type == "object") {
                array_complex[table_name] = { name: n, fields: Object.keys(x.items.properties) };
            } else {
                array_simple[table_name] = n;
            }

        } else {
            overlord_inserts.push(n);
        }
    }

    let commands = [];

    let field_str = overlord_inserts.map(n => '"' + n + '"');
    commands.push(`
{
    let current_values = [];
    let current_columns = [];
    for (const y of [${field_str}]) {
        if (y in metadata) {
            current_columns.push(y);
            current_values.push(metadata[y]);
        }
    }
    statements.push({ 
        statement: \`INSERT INTO overlord (_key, _project, _asset, _version, _path, _object, \${current_columns}) VALUES(\${Array(current_columns.length + 6).fill('?')});\`,
        parameters: [key, project, asset, version, path, object, ...current_values]
    });
}
`);

    field_str = free_text_inserts.map(n => '"' + n + '"');
    commands.push(`
{
    let current_values = [];
    let current_columns = [];
    for (const y of [${field_str}]) {
        if (y in metadata) {
            current_columns.push(y);
            current_values.push(metadata[y]);
        }
    }
    statements.push({ 
        statement: \`INSERT INTO free_text (_key, \${current_columns}) VALUES(\${Array(current_columns.length + 1).fill('?')});\`,
        parameters: [key, ...current_values]
    });
}
`);

    // Loop through the difficult tables.
    for (const [tab, field] of Object.entries(array_simple)) {
        let cmd = `
if ("${field}" in metadata) {
    for (const y of metadata["${field}"]) {
        statements.push({ 
            statement: \`INSERT INTO ${tab} (_key, item) VALUES(?, ?);\`,
            parameters: [key, y]
        });
    }
}
`
        commands.push(cmd);
    }

    for (const [tab, val] of Object.entries(array_complex)) {
        let { name, fields } = val;
        let field_str = fields.map(n => '"' + n + '"');
        let cmd = `
if ("${name}" in metadata) {
    for (const meta of metadata["${name}"]) {
        let current_values = [];
        let current_columns = [];
        for (const y of [${field_str}]) {
            if (y in meta) {
                current_columns.push(y);
                current_values.push(meta[y]);
            }
        }
        statements.push({ 
            statement: \`INSERT INTO ${tab} (_key, \${current_columns}) VALUES(\${Array(current_columns.length + 1).fill('?')});\`,
            parameters: [key, ...current_values]
        });
    }
}
`
        commands.push(cmd);
    }

    // Formatting the output.
    let code = "";
    if (name !== null) {
        code += "function " + name;
    }
    code += "(project, asset, version, path, object, metadata)";
    if (name === null) {
        code += " =>"
    }
    code += " {\n";
    code += "    let key = project + '/' + asset + '/' + version + '/' + path;\n"
    code += "    const statements = [];\n";
    for (const cmd of commands) {
        code += cmd.replaceAll("\n", "\n    ");
    }
    code += "\n    return statements;\n}";

    return code;
}
