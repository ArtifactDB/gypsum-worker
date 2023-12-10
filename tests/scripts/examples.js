export const examples = [
    {
        title: "asdasd",
        description: "FOOBAR",
        bioconductor_version: "4.10",
        taxonomy_id: [ "9606", "10090" ],
        genome: [ "GRCm38", "GRCh38", "TAIR10" ],
        sources: [
            { provider: "GEO", id: "GSE12345" },
            { provider: "ArrayExpress", id: "E-MTAB-12345" },
            { provider: "PubMed", id: "12332423" },
            { provider: "other", id: "https://123213.com" }
        ],
        maintainer_name: "Aaron Lun",
        maintainer_email: "aaron@aaron.com"
    },
    {
        title: "animus",
        description: "stuff stuff stuff",
        bioconductor_version: "3.11",
        taxonomy_id: [ "9606" ],
        genome: [ "GRCm38" ],
        sources: [
            { provider: "GEO", id: "GSE9873" },
        ],
        maintainer_name: "Jaya Ram Kancherla",
        maintainer_email: "jaya.ram@kancherla.com"
    }
];
