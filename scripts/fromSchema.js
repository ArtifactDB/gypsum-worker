import * as fs from "fs";
import * as path from "path";
import Ajv from "ajv";
import { default as standaloneCode } from "ajv/dist/standalone/index.js";
import "isomorphic-fetch";
import pretty from "pretty-js";

export function validatorFromSchema(schema, output) {
    const ajv = new Ajv({ schemas: [collected], code: {source: true, esm: true}})
    let moduleCode = standaloneCode(ajv, {
        "validate": "bioconductor.json",
    })

    const dir = path.dirname(output); 
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
    fs.writeFileSync(output, pretty(moduleCode));
}

const known_mappings = { integer: "INTEGER", number: "REAL", boolean: "INTEGER", string: "TEXT" };

export function initializerFromSchema(schema, output) {
    let main_table = [];
    let fts_table = [];
    let commands = [];

    for (const [n, x] of Object.entries(schema.properties)) {
        if (x.type == "string") {
            if ("_attributes" in x && x._attributes.indexOf("free_text")) {
                fts_table.push(n);
            } else {
                main_table.push(n + " " + known_mappings[x.type]);
            }

        } else if (x.type == "array") {
            let table_name = "multi_" + n;
            commands.push(`DROP TABLE IF EXISTS ${table_name}`);
            let itype = x.items.type;

            if (itype in known_mappings) {
                commands.push(`CREATE TABLE ${table_name} (_path TEXT NOT NULL, item ${known_mappings[itype]});`);
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
                commands.push(`CREATE TABLE ${table_name} (_path TEXT NOT NULL, ${components});`);
                for (const n2 of Object.keys(x.items.properties)) {
                    commands.push(`CREATE INDEX index_${table_name}_${n2} ON ${table_name} (${n2});`);
                }


            } else {
                throw new Error("don't know how to convert type '" + itype + "' for items of property '" + n + "' into a SQL field");
            }

        } else if (x.type in known_mappings) {
            main_table.push(n + " " + known_mappings[x.type]);

        } else {
            throw new Error("don't know how to convert type '" + x.type + "' for property '" + n + "' into a SQL field");
        }
    }

    commands.push("DROP TABLE IF EXISTS overlord;");
    commands.push(`CREATE TABLE overlord (_path TEXT PRIMARY_KEY, _object TEXT, ${main_table});`);
    for (const y of main_table) {
        commands.push(`CREATE INDEX index_overlord_${y} ON overlord(${y});`);
    }

    commands.push("DROP TABLE IF EXISTS fts;");
    if (fts_table.length) {
        commands.push(`CREATE VIRTUAL TABLE fts USING (_path, ${fts_table});`);
    }

    // Formatting the output.
    let code = "export function initialize() {\n    return `\n" + commands.join("\n") + "`;\n}";
    fs.writeFileSync(output, code);
}

export function converterFromSchema(schema, output) {
    let inserts = { "overlord": [], "fts": [] };
    let array_simple = {};
    let array_complex = {};

    for (const [n, x] of Object.entries(schema.properties)) {
        if (x.type == "string") {
            if ("_attributes" in x && x._attributes.indexOf("free_text")) {
                inserts.fts.push(n);
            } else {
                inserts.overlord.push(n);
            }

        } else if (x.type == "array") {
            let table_name = "multi_" + n;
            if (itype in known_mappings) {
                array_simple[table_name] = n;
            } else if (x.items.type == "object") {
                array_complex[table_name] = Object.keys(x.items.properties);
            }

        } else {
            inserts.overlord.push(n);
        }
    }

    let commands = [];

    // Looping through each regular table and adding code to insert into it.
    for (const [tab, fields] of Object.entries(inserts)) {
        let field_str = fields.map(n => '"' + n + '"');
        let cmd = `
let current_values = [];
let current_columns = [];
for (const y of [${field_str}]) {
    if (y in metadata) {
        current_columns.push(y);
        current_values.push(metadata[y]);
    }
}
commands.push({
    command: \`DELETE FROM ${tab} WHERE _path == ?;\`,
    parameters: [path]
});
insertions.push({ 
    command: \`INSERT INTO ${tab} (_path, _object, \${current_columns}) VALUES(\${Array(current_columns.length + 2).fill('?')});\`,
    parameters: [path, object, ...current_values]
});`
        commands.push(cmd);
    }

    // Loop through the difficult tables.
    for (const [tab, field] of Object.entries(array_simple)) {
        let field_str = fields.map(n => '"' + n + '"');
        let cmd = `
commands.push({
    command: \`DELETE FROM ${tab} WHERE _path == ?;\`,
    parameters: [path]
});
if ("${field}" in metadata) {
    for (const y of metadata["${field}"]) {
        insertions.push({ 
            command: \`INSERT INTO ${tab} (_path, item) VALUES(?);\`,
            parameters: [path, y]
        });
    }
}`
        commands.push(cmd);
    }

    for (const [tab, fields] of Object.entries(array_complex)) {
        let field_str = fields.map(n => '"' + n + '"');
        let cmd = `
commands.push({
    command: \`DELETE FROM ${tab} WHERE _path == ?;\`,
    parameters: [path]
});
if ("${field}" in metadata) {
    for (const meta of metadata["${field}"]) {
        for (const y of [${field_str}]) {
            if (y in meta) {
                current_columns.push(y);
                current_values.push(meta[y]);
            }
        }
        insertions.push({ 
            command: \`INSERT INTO ${tab} (_path, \${current_columns}) VALUES(\${Array(current_columns.length + 1).fill('?')});\`,
            parameters: [path, ...current_values]
        });
    }
}`
        commands.push(cmd);
    }

    // Formatting the output.
    let code = "export function convert(path, object, metadata) {\n    const commands = [];";
    for (const cmd of commands) {
        code += cmd.replaceAll("\n", "\n    ");
    }
    code += "\n    return commands;\n}";

    fs.writeFileSync(output, code);
}
