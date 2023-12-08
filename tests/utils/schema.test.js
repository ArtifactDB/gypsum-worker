import * as schemas from "../../src/utils/schema.js";

test("validateMetadata behaves as expected", () => {
    expect(() => schemas.validateMetadata([])).toThrow("expected a JSON object");

    let obj = {};
    expect(() => schemas.validateMetadata(obj)).toThrow("missing a 'title'");
    obj.title = 2;
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'title'");
    obj.title = "sdasdA";

    expect(() => schemas.validateMetadata(obj)).toThrow("missing a 'description'");
    obj.description = 2;
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'description'");
    obj.description = "asda";

    expect(() => schemas.validateMetadata(obj)).toThrow("missing a 'bioc_version'");
    obj.bioc_version = 2;
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'bioc_version'");
    obj.bioc_version = "FOOBAR";
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'bioc_version'");
    obj.bioc_version = "4.10";

    expect(() => schemas.validateMetadata(obj)).toThrow("missing a 'taxonomy_id'");
    obj.taxonomy_id = 2;
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'taxonomy_id'");
    obj.taxonomy_id = "urmom";
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'taxonomy_id'");
    obj.taxonomy_id = "9606";

    expect(() => schemas.validateMetadata(obj)).toThrow("missing a 'source'");
    obj.genome = 2;
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'genome'");
    obj.genome = "foo";
    expect(() => schemas.validateMetadata(obj)).toThrow("unsupported 'genome'");
    obj.genome = "GRCm38";

    expect(() => schemas.validateMetadata(obj)).toThrow("missing a 'source'");
    obj.source = [];
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'source'");
    obj.source = {};
    expect(() => schemas.validateMetadata(obj)).toThrow("missing a 'source.provider'");
    obj.source = { provider: 2 };
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'source.provider'");
    obj.source = { provider: "random" };
    expect(() => schemas.validateMetadata(obj)).toThrow("missing a 'source.id'");
    obj.source = { provider: "GEO", id: 5 };
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'source.id'");
    obj.source = { provider: "GEO", id: "foo" };
    expect(() => schemas.validateMetadata(obj)).toThrow("GSE");
    obj.source = { provider: "GEO", id: "GSE111111" };
    expect(() => schemas.validateMetadata(obj)).toThrow("maintainer");
    obj.source = { provider: "ArrayExpress", id: "foo" };
    expect(() => schemas.validateMetadata(obj)).toThrow("E-MTAB");
    obj.source = { provider: "ArrayExpress", id: "E-MTAB-12313" };
    expect(() => schemas.validateMetadata(obj)).toThrow("maintainer");
    obj.source = { provider: "PubMed", id: "foo" };
    expect(() => schemas.validateMetadata(obj)).toThrow("digits");
    obj.source = { provider: "PubMed", id: "12398761" };
    expect(() => schemas.validateMetadata(obj)).toThrow("maintainer");
    obj.source = { provider: "other", id: "foo" };
    expect(() => schemas.validateMetadata(obj)).toThrow("URL");
    obj.source = { provider: "other", id: "http://123123.com" };
    expect(() => schemas.validateMetadata(obj)).toThrow("maintainer");
    obj.source = { provider: "random", id: "foobar" };
    expect(() => schemas.validateMetadata(obj)).toThrow("unknown value");
    obj.source = { provider: "ArrayExpress", id: "E-MTAB-12313" };

    expect(() => schemas.validateMetadata(obj)).toThrow("missing a 'maintainer'");
    obj.maintainer = [];
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'maintainer'");
    obj.maintainer = {};
    expect(() => schemas.validateMetadata(obj)).toThrow("missing a 'maintainer.name'");
    obj.maintainer = { name: 2 };
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'maintainer.name'");
    obj.maintainer = { name: "FOO" };
    expect(() => schemas.validateMetadata(obj)).toThrow("at least a first");
    obj.maintainer = { name: "FOO asdasd" };
    expect(() => schemas.validateMetadata(obj)).toThrow("missing a 'maintainer.email'");
    obj.maintainer = { name: "FOO asdasd", email: 2 };
    expect(() => schemas.validateMetadata(obj)).toThrow("expected 'maintainer.email'");
    obj.maintainer = { name: "FOO asdasd", email: "foobar" };
    expect(() => schemas.validateMetadata(obj)).toThrow("email");
    obj.maintainer = { name: "FOO asdasd", email: "foo@bar.com" };

    schemas.validateMetadata(obj);
})
