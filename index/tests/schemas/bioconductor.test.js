import schema from "../../schemas/bioconductor.json";
import Ajv from "ajv";

test("Bioconductor schema behaves as expected", () => {
    const ajv = new Ajv();
    let validator = ajv.compile(schema);
    function validate(x) {
        if (!validator(x)) {
            throw new Error(validator.errors[0].message);
        }
    }

    expect(() => validate([])).toThrow("object");

    let obj = {
        title: "asdasd",
        description: "FOOBAR",
        bioconductor_version: "4.10",
        taxonomy_id: [ "9606" ],
        genome: [ "GRCm38" ],
        sources: [
            { provider: "GEO", id: "GSE12345" },
            { provider: "ArrayExpress", id: "E-MTAB-12345" },
            { provider: "PubMed", id: "12332423" },
            { provider: "other", id: "https://123213.com" }
        ],
        maintainer: {
            name: [ "Aaron", "Lun" ],
            email: "aaron@aaron.com"
        }
    };
    validate(obj);

    delete obj.title; 
    expect(() => validate(obj)).toThrow("title");
    obj.title = 2;
    expect(() => validate(obj)).toThrow("string");
    obj.title = "sdasdA";

    delete obj.description;
    expect(() => validate(obj)).toThrow("description");
    obj.description = 2;
    expect(() => validate(obj)).toThrow("string");
    obj.description = "asda";

    delete obj.bioconductor_version;
    expect(() => validate(obj)).toThrow("bioconductor_version");
    obj.bioconductor_version = 2;
    expect(() => validate(obj)).toThrow("string");
    obj.bioconductor_version = "FOOBAR";
    expect(() => validate(obj)).toThrow("must match");
    obj.bioconductor_version = "4.10";

    delete obj.taxonomy_id;
    expect(() => validate(obj)).toThrow("taxonomy_id");
    obj.taxonomy_id = "9606";
    expect(() => validate(obj)).toThrow("array");
    obj.taxonomy_id = [ "urmom" ];
    expect(() => validate(obj)).toThrow("must match pattern");
    obj.taxonomy_id = [ "9606", "9606" ];
    expect(() => validate(obj)).toThrow("duplicate");
    obj.taxonomy_id = [ "9606" ];

    delete obj.genome;
    expect(() => validate(obj)).toThrow("genome");
    obj.genome = "GRCh38";
    expect(() => validate(obj)).toThrow("array");
    obj.genome = [ "foo" ];
    expect(() => validate(obj)).toThrow("one of");
    obj.genome = [ "GRCm38", "GRCm38" ];
    expect(() => validate(obj)).toThrow("duplicate");
    obj.genome = [ "GRCm38" ];

    delete obj.sources;
    expect(() => validate(obj)).toThrow("source");
    obj.sources = 2;
    expect(() => validate(obj)).toThrow("array");
    obj.sources = [];
    expect(() => validate(obj)).toThrow("fewer");
    obj.sources = [{ provider: 2, id: "123123" }];
    expect(() => validate(obj)).toThrow("string");
    obj.sources = [{ provider: "GEO" }];
    expect(() => validate(obj)).toThrow("id");
    obj.sources = [{ provider: "GEO", id: 5 }];
    expect(() => validate(obj)).toThrow("string");

    obj.sources = [{ provider: "GEO", id: "foo" }];
    expect(() => validate(obj)).toThrow("pattern");
    obj.sources = [{ provider: "ArrayExpress", id: "foo" }];
    expect(() => validate(obj)).toThrow("pattern");
    obj.sources = [{ provider: "PubMed", id: "foo" }];
    expect(() => validate(obj)).toThrow("pattern");
    obj.sources = [{ provider: "other", id: "foo" }];
    expect(() => validate(obj)).toThrow("pattern");
    obj.sources = [{ provider: "random", id: "123123" }];
    expect(() => validate(obj)).toThrow("one of");
    obj.sources = [{ provider: "ArrayExpress", id: "E-MTAB-12313" }];

    delete obj.maintainer;
    expect(() => validate(obj)).toThrow("maintainer");
    obj.maintainer = [];
    expect(() => validate(obj)).toThrow("object");
    obj.maintainer = { email: "foo@bar.com" };
    expect(() => validate(obj)).toThrow("name");
    obj.maintainer = { name: [ "A", "B" ] };
    expect(() => validate(obj)).toThrow("email");
    obj.maintainer = { name: 2, email: "foo@bar.com" };
    expect(() => validate(obj)).toThrow("array");
    obj.maintainer = { name: ["FOO"], email: "foo@bar.com" };
    expect(() => validate(obj)).toThrow("fewer");
    obj.maintainer = { name: ["FOO", "  "], email: "foo@bar.com" };
    expect(() => validate(obj)).toThrow("pattern");
    obj.maintainer = { name: ["FOO", ""], email: "foo@bar.com" };
    expect(() => validate(obj)).toThrow("pattern");

    obj.maintainer = { name: ["FOO", "BAR"] };
    expect(() => validate(obj)).toThrow("email");
    obj.maintainer = { name: ["FOO", "BAR"], email: "foo@barcom" };
    expect(() => validate(obj)).toThrow("pattern");
})
