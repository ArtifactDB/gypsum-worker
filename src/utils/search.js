import * as s3 from "./s3.js";
import * as http from "./http.js";
import * as generated from "./generated.js";

async function constructMetadataStatement(project, asset, version, path, metadataSource, objectSource, env) {
    let meta = await s3.quickFetchJson(metadataSource, env);

    let raw_obj = await env.BOUND_BUCKET.get(objectSource);
    if (raw_obj === null) {
        throw new http.HttpError("no file at '" + objectSource + "'", 500);
    }
    let obj = await raw_obj.text();

    // Removing some trailing whitespace.
    if (obj.endsWith("\n")) {
        obj = obj.replace(/\n+$/, "");
    }
    if (obj.match(/\s/)) {
        throw new http.HttpError("contents of '" + objectSource + "' should not contain whitespace", 400);
    }

    return generated.converter(project, asset, version, path, obj, meta);
}

export async function indexLatest(project, asset, version, manifest, env) {
    let statements = generated.wiper(project, asset);

    let pairs = {};
    for (const m of manifest) {
        let i = m.path.find("/");
        let basename = m.path; 
        if (i >= 0) {
            basename = basename.slice(i + 1);
        }

        let match_meta = (basename == "_metadata.json");
        let match_obj = (basename == "OBJECT");
        if (match_meta || match_obj) {
            let dirname = m.path.slice(0, i);
            if (!(dirname in pairs)) {
                pairs[dirname] = { metadata: null, object: null };
            }

            let src = null;
            if ("link" in m) {
                // TODO: replace with the ancestor.
                src = m.link.project + "/" + m.link.asset + "/" + m.link.version + "/" + m.link.path;
            } else {
                src = project + "/" + asset + "/" + version + "/" + m.path;
            }

            if (match_meta) {
                pairs[dirname].metadata = src;
            } else {
                pairs[dirname].object = src;
            }
        }
    }

    let add_statements = [];
    for (const [k, v] of Object.entries(pairs)) {
        if (v.metadata !== null && v.object !== null) {
            add_statements.push(constructIndexingCommand(project, asset, version, v.metadata, v.object, env));
        }
    }
    let resolved_statements = await Promise.all(add_statements);
    for (const r of resolved_statements) {
        statements.push(r);
    }

    const db = env.BOUND_DATABASE;
    for (var i = 0; i < statements.length; i++) {
        let current = statements[i];
        let stmt = db.prepare(current.statement);

        let params = current.parameters;
        if (params !== null) {
            stmt = stmt.bind(...params);
        }
        statements[i] = stmt;
    }
    await db.batch(statements);
}
