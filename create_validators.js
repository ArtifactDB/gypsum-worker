import * as fs from "fs";
import Ajv from "ajv";
import { default as standaloneCode } from "ajv/dist/standalone/index.js";
import "isomorphic-fetch";
import pretty from "pretty-js";

var schemas = [ "upload_project_version.json", "permissions.json", "complete_project_version.json" ];
const base = "https://artifactdb.github.io/ArtifactDB-api-contract/request";

let collected = [];
for (const schema of schemas) {
    let res = await fetch(base + "/" + schema);
    if (!res.ok) {
        throw new Error("failed to fetch '" + schema + "'");
    }
    collected.push(await res.json());
}

const ajv = new Ajv({ schemas: collected, code: {source: true, esm: true}})
let moduleCode = standaloneCode(ajv, {
    "upload_project_version": "upload_project_version.json",
    "complete_project_version": "complete_project_version.json",
    "permissions": "permissions.json"
})

// Now you can write the module code to file
fs.writeFileSync("src/validators.js", pretty(moduleCode));
