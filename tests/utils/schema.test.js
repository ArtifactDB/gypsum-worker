import * as schemas from "../../src/schemas/standard.js";

test("validateMetadata behaves as expected", () => {
    expect(() => schemas.validateMetadata([])).toThrow("expected a JSON object");

    let obj = {};
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'title'");
    obj.title = 2;
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'title'");

    obj.title = "sdasdA";
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'description'");
    obj.description = 2;
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'description'");

    obj.description = "asda";
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'bioc_version'");
    obj.bioc_version = 2;
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'bioc_version'");
    obj.bioc_version = "FOOBAR";
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'bioc_version'");

    obj.bioc_version = "4.10";
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'taxonomy_id'");
    obj.taxonomy_id = 2;
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'taxonomy_id'");
    obj.taxonomy_id = "urmom";
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'taxonomy_id'");

    obj.taxonomy_id = "9606";
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'genome'");
    obj.genome = 2;
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'genome'");

    obj.genome = null;
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'source'");
    obj.genome = "mm10";
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'source'");

    obj.source = [];
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'source'");
    obj.source = {};
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'source'");
    obj.source = { provider: 2 };
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'source.provider'");
    obj.source = { provider: "random" };
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'source.provider'");
    obj.source = { provider: "GEO" };
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'source.id'");
})
