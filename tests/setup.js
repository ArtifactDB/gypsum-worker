import * as fs from "fs";

export async function mockProject(project, version) {
    let promises = [];
    let base = project + "/" + version;

    let basic = {
        "$schema": "generic_file/v1.json",
        "generic_file": {
            "format": "text"
        }
    };

    let jsonmeta = {
        httpMetadata: { contentType: "application/json" }
    };

    {
        let rpath = "whee.txt"
        let rpath0  = rpath + ".json";
        let contents = "A\nB\nC\nD\nE\nF\nG\nH\nI\nJ\nK\nL\nM\nN\nO\nP\nQ\nR\nS\nT\nU\nV\nW\nX\nY\nZ\n";
        promises.push(BOUND_BUCKET.put(base + "/" + rpath, contents));
        let meta = { ...basic, md5sum: "xxxxx", path: rpath };
        promises.push(BOUND_BUCKET.put(base + "/" + rpath + ".json", JSON.stringify(meta), jsonmeta)); 
    }
}
