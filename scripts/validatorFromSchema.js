import * as fs from "fs";
import * as path from "path";
import Ajv from "ajv";
import { default as standaloneCode } from "ajv/dist/standalone/index.js";
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
