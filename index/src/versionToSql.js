import * as fs from "fs";
import * as ajv from "ajv";

export function versionToSql(project, asset, version, workingDir) {
    let pairs = {};
    function list_files(dir, sofar="") {
        let out = fs.readdirSync(dir);
        let nextdir = sofar;
        if (nextdir != "") {
            nextdir += "/";
        }

        for (const f of out) {
            if (f.isDirectory()) {
                list_files(path.resolve(dir, f.name), nextdir + f.name); 
            } else if (f.name == metadata_file || f.name == object_file) {
                if (!(sofar in pairs)) {
                    pairs[sofar] = new Set;
                }
                pairs[sofar].add(f.name);
            }
        }
    }

    // Scanning through them and validating them.
    for (const [k, v] of Object.entries(pairs)) {
        if (!v.has(metadata_file)) {
            throw new Error("detected '" + object_file + "' without '" + metadata_file + "' at '" + k + "'");
        } else if (!v.has(object_file)) {
            throw new Error("detected '" + metadata_file + "' without '" + object_file + "' at '" + k + "'");
        }

        let meta = JSON.parse(fs.readFileSync(workingDir + "/" + k + "/" + metadata_file, "utf8"));
        let obj = fs.readFileSync(workingDir + "/" + k + "/" + object_file, "utf8");
    }
}
