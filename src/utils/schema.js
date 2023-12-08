import * as misc from "../utils/misc.js";
import * as http from "../utils/http.js";

const allowed_genomes = new Set(["GRCm38", "GRCh38"]);

function extractStringOrFail(obj, name, context) {
    if (!(name in obj)) {
        let full = (context === null ? name : context + "." + name);
        throw new http.HttpError("missing a '" + full + "' property", 400);
    }

    let val = obj[name];
    if (typeof val !== "string") {
        let full = (context === null ? name : context + "." + name);
        throw new http.HttpError("expected '" + full + "' property to be a string", 400);
    }

    return val;
}

export function validateMetadata(val) {
    if (!misc.isJsonObject(val)) {
        throw new http.HttpError("expected a JSON object", 400);
    }

    let freetext = ["title", "description"];
    for (const field of freetext) {
        extractStringOrFail(val, field, null);
    }

    let bioc_version = extractStringOrFail(val, "bioc_version", null);
    if (!bioc_version.match(/^[0-9]+\.[0-9]+$/)) {
        throw new http.HttpError("expected 'bioc_version' property to be a versioned string", 400);
    }

    let taxonomy_id = extractStringOrFail(val, "taxonomy_id", null);
    if (!taxonomy_id.match(/^[0-9]+$/)) {
        throw new http.HttpError("expected 'taxonomy_id' property to be a string of digits", 400);
    }

    if ("genome" in val) {
        let genome = val["genome"];
        if (typeof genome != "string") {
            throw new http.HttpError("expected 'genome' property to be a string or null", 400);
        }
        if (!allowed_genomes.has(genome)) {
            throw new http.HttpError("unsupported 'genome' value ('" + genome + "')", 400);
        }
    }

    // Holding onto the source information.
    if (!("source" in val)) {
        throw new http.HttpError("missing a 'source' property", 400);
    }
    let src = val["source"];
    if (!misc.isJsonObject(src)) {
        throw new http.HttpError("expected 'source' property to be an object", 400);
    }

    let provider = extractStringOrFail(src, "provider", "source");
    let id = extractStringOrFail(src, "id", "source");

    if (provider == "other") {
        if (!id.startsWith("http") && !id.startsWith("ftp") && !id.startsWith("s3")) {
            throw new http.HttpError("expected 'source.id' property to be a string containing a URL", 400);
        }
    } else if (provider == "GEO" ) {
        if (!id.match(/^GSE[0-9]+$/)) {
            throw new http.HttpError("expected 'source.id' property to follow the 'GSExxx' format", 400);
        }
    } else if (provider == "ArrayExpress") {
        if (!id.match(/^E-MTAB-[0-9]+$/)) {
            throw new http.HttpError("expected 'source.id' property to follow the 'E-MTAB-xxx' format", 400);
        }
    } else if (provider == "PubMed") {
        if (!id.match(/^[0-9]+$/)) {
            throw new http.HttpError("expected 'source.id' property to be a string containing digits", 400);
        }
    } else {
        throw new http.HttpError("unknown value for the 'source.id' property ('" + provider + "')", 400);
    }

    // Maintainer information.
    if (!("maintainer" in val)) {
        throw new http.HttpError("missing a 'maintainer' property", 400);
    }
    let mtr = val["maintainer"];
    if (!misc.isJsonObject(mtr)) {
        throw new http.HttpError("expected 'maintainer' property to be an object", 400);
    }

    let name = extractStringOrFail(mtr, "name", "maintainer");
    let fragmented = name.split(" ");
    if (fragmented.length < 2) {
        throw new http.HttpError("expected 'maintainer.name' property to contain at least a first and last name", 400);
    }
    for (const frag of fragmented) {
        if (frag.length == 0 || frag.match(/\s/)) {
            throw new http.HttpError("expected names to be separated by exactly one whitespace in 'maintainer.name'", 400);
        }
    }

    let email = extractStringOrFail(mtr, "email", "maintainer");
    if (!email.match(/^[^@]+@[^@\.]+\.[^@\.]+/)) {
        throw new http.HttpError("expected 'maintainer.email' property to be an email", 400);
    }
}
