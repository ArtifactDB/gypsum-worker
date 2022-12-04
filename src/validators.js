"use strict";

export const upload_project_version = validate10;
const schema11 = {
    $id: "upload_project_version.json",
    $schema: "http://json-schema.org/draft-07/schema",
    description: "JSON body of the request for the `POST /projects/{project}/version/{version}/upload` endpoint.",
    properties: {
        completed_by: {
            description: "When is the project upload expected to finish? The completion time is computed as an interval from the time of the request. ArtifactDB backend implementations may use this to set a timeout on the upload.",
            pattern: "^in [0-9]+ (hours|days|weeks|months|years)$",
            type: "string"
        },
        expires_in: {
            description: "When does this project version expire? The expiry time is computed as an interval from the indexing time. If omitted, it is expected that the project will not expire.",
            pattern: "^in [0-9]+ (hours|days|weeks|months|years)$",
            type: "string"
        },
        filenames: {
            description: "Files to be uploaded to this version of the project.",
            items: {
                anyOf: [
                    {
                        description: "Relative path to the file inside the project.",
                        properties: {
                            check: {
                                "const": "simple",
                                description: "Simple upload with no deduplication, but with MD5 checksum checks for integerity.",
                                type: "string"
                            },
                            filename: {
                                description: "Relative path to the file inside the project.",
                                type: "string"
                            },
                            value: {
                                description: "Parameters for checking the MD5 checksum.",
                                properties: {
                                    md5sum: {
                                        description: "MD5 checksum of the current version of the file to be uploaded.",
                                        type: "string"
                                    }
                                },
                                required: [
                                    "md5sum"
                                ],
                                type: "object"
                            }
                        },
                        required: [
                            "check",
                            "filename",
                            "value"
                        ],
                        type: "object"
                    },
                    {
                        properties: {
                            check: {
                                "const": "md5",
                                description: "Deduplication should be performed based on detection of an identical MD5 checksum in a previous version of the file.",
                                type: "string"
                            },
                            filename: {
                                description: "Relative path to the file inside the project.",
                                type: "string"
                            },
                            value: {
                                description: "Parameters for checking the MD5 checksum.",
                                properties: {
                                    field: {
                                        description: "Field of the metadata that contains the MD5 checksum of the previous version of the file.",
                                        type: "string"
                                    },
                                    md5sum: {
                                        description: "MD5 checksum of the current version of the file to be uploaded.",
                                        type: "string"
                                    }
                                },
                                required: [
                                    "md5sum",
                                    "field"
                                ],
                                type: "object"
                            }
                        },
                        required: [
                            "check",
                            "filename",
                            "value"
                        ],
                        type: "object"
                    },
                    {
                        properties: {
                            check: {
                                "const": "link",
                                description: "Deduplication should be performed based on an explicit link to another ArtifactDB resource.",
                                type: "string"
                            },
                            filename: {
                                description: "Relative path to the file inside the project.",
                                type: "string"
                            },
                            value: {
                                description: "Parameters for linking.",
                                properties: {
                                    artifactdb_id: {
                                        description: "An ArtifactDB identifier to be linked from the file in `filename`.",
                                        type: "string"
                                    }
                                },
                                required: [
                                    "artifactdb_id"
                                ],
                                type: "object"
                            }
                        },
                        required: [
                            "check",
                            "filename",
                            "value"
                        ],
                        type: "object"
                    }
                ]
            },
            type: "array"
        }
    },
    required: [
        "filenames"
    ],
    title: "Upload project version request",
    type: "object"
};
const pattern0 = new RegExp("^in [0-9]+ (hours|days|weeks|months|years)$", "u");

function validate10(data, {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data
}
= {}) {
    /*# sourceURL="upload_project_version.json" */;
    let vErrors = null;
    let errors = 0;

    if (errors === 0) {
        if (data && typeof data == "object" && !Array.isArray(data)) {
            let missing0;

            if ((data.filenames === undefined) && (missing0 = "filenames")) {
                validate10.errors = [
                    {
                        instancePath,
                        schemaPath: "#/required",
                        keyword: "required",
                        params: {
                            missingProperty: missing0
                        },
                        message: "must have required property '" + missing0 + "'"
                    }
                ];

                return false;
            } else {
                if (data.completed_by !== undefined) {
                    let data0 = data.completed_by;
                    const _errs1 = errors;

                    if (errors === _errs1) {
                        if (typeof data0 === "string") {
                            if (!pattern0.test(data0)) {
                                validate10.errors = [
                                    {
                                        instancePath: instancePath + "/completed_by",
                                        schemaPath: "#/properties/completed_by/pattern",
                                        keyword: "pattern",
                                        params: {
                                            pattern: "^in [0-9]+ (hours|days|weeks|months|years)$"
                                        },
                                        message: "must match pattern \"" + "^in [0-9]+ (hours|days|weeks|months|years)$" + "\""
                                    }
                                ];

                                return false;
                            }
                        } else {
                            validate10.errors = [
                                {
                                    instancePath: instancePath + "/completed_by",
                                    schemaPath: "#/properties/completed_by/type",
                                    keyword: "type",
                                    params: {
                                        type: "string"
                                    },
                                    message: "must be string"
                                }
                            ];

                            return false;
                        }
                    }

                    var valid0 = _errs1 === errors;
                } else {
                    var valid0 = true;
                }

                if (valid0) {
                    if (data.expires_in !== undefined) {
                        let data1 = data.expires_in;
                        const _errs3 = errors;

                        if (errors === _errs3) {
                            if (typeof data1 === "string") {
                                if (!pattern0.test(data1)) {
                                    validate10.errors = [
                                        {
                                            instancePath: instancePath + "/expires_in",
                                            schemaPath: "#/properties/expires_in/pattern",
                                            keyword: "pattern",
                                            params: {
                                                pattern: "^in [0-9]+ (hours|days|weeks|months|years)$"
                                            },
                                            message: "must match pattern \"" + "^in [0-9]+ (hours|days|weeks|months|years)$" + "\""
                                        }
                                    ];

                                    return false;
                                }
                            } else {
                                validate10.errors = [
                                    {
                                        instancePath: instancePath + "/expires_in",
                                        schemaPath: "#/properties/expires_in/type",
                                        keyword: "type",
                                        params: {
                                            type: "string"
                                        },
                                        message: "must be string"
                                    }
                                ];

                                return false;
                            }
                        }

                        var valid0 = _errs3 === errors;
                    } else {
                        var valid0 = true;
                    }

                    if (valid0) {
                        if (data.filenames !== undefined) {
                            let data2 = data.filenames;
                            const _errs5 = errors;

                            if (errors === _errs5) {
                                if (Array.isArray(data2)) {
                                    var valid1 = true;

                                    const len0 = data2.length;

                                    for (let i0 = 0; i0 < len0; i0 ++) {
                                        let data3 = data2[i0];
                                        const _errs7 = errors;
                                        const _errs8 = errors;
                                        let valid2 = false;
                                        const _errs9 = errors;

                                        if (errors === _errs9) {
                                            if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                                                let missing1;

                                                if ((((data3.check === undefined) && (missing1 = "check")) || ((data3.filename === undefined) && (missing1 = "filename"))) || ((data3.value === undefined) && (missing1 = "value"))) {
                                                    const err0 = {
                                                        instancePath: instancePath + "/filenames/" + i0,
                                                        schemaPath: "#/properties/filenames/items/anyOf/0/required",
                                                        keyword: "required",
                                                        params: {
                                                            missingProperty: missing1
                                                        },
                                                        message: "must have required property '" + missing1 + "'"
                                                    };

                                                    if (vErrors === null) {
                                                        vErrors = [
                                                            err0
                                                        ];
                                                    } else {
                                                        vErrors.push(err0);
                                                    }

                                                    errors ++;
                                                } else {
                                                    if (data3.check !== undefined) {
                                                        let data4 = data3.check;
                                                        const _errs11 = errors;

                                                        if (typeof data4 !== "string") {
                                                            const err1 = {
                                                                instancePath: instancePath + "/filenames/" + i0 + "/check",
                                                                schemaPath: "#/properties/filenames/items/anyOf/0/properties/check/type",
                                                                keyword: "type",
                                                                params: {
                                                                    type: "string"
                                                                },
                                                                message: "must be string"
                                                            };

                                                            if (vErrors === null) {
                                                                vErrors = [
                                                                    err1
                                                                ];
                                                            } else {
                                                                vErrors.push(err1);
                                                            }

                                                            errors ++;
                                                        }

                                                        if ("simple" !== data4) {
                                                            const err2 = {
                                                                instancePath: instancePath + "/filenames/" + i0 + "/check",
                                                                schemaPath: "#/properties/filenames/items/anyOf/0/properties/check/const",
                                                                keyword: "const",
                                                                params: {
                                                                    allowedValue: "simple"
                                                                },
                                                                message: "must be equal to constant"
                                                            };

                                                            if (vErrors === null) {
                                                                vErrors = [
                                                                    err2
                                                                ];
                                                            } else {
                                                                vErrors.push(err2);
                                                            }

                                                            errors ++;
                                                        }

                                                        var valid3 = _errs11 === errors;
                                                    } else {
                                                        var valid3 = true;
                                                    }

                                                    if (valid3) {
                                                        if (data3.filename !== undefined) {
                                                            const _errs13 = errors;

                                                            if (typeof data3.filename !== "string") {
                                                                const err3 = {
                                                                    instancePath: instancePath + "/filenames/" + i0 + "/filename",
                                                                    schemaPath: "#/properties/filenames/items/anyOf/0/properties/filename/type",
                                                                    keyword: "type",
                                                                    params: {
                                                                        type: "string"
                                                                    },
                                                                    message: "must be string"
                                                                };

                                                                if (vErrors === null) {
                                                                    vErrors = [
                                                                        err3
                                                                    ];
                                                                } else {
                                                                    vErrors.push(err3);
                                                                }

                                                                errors ++;
                                                            }

                                                            var valid3 = _errs13 === errors;
                                                        } else {
                                                            var valid3 = true;
                                                        }

                                                        if (valid3) {
                                                            if (data3.value !== undefined) {
                                                                let data6 = data3.value;
                                                                const _errs15 = errors;

                                                                if (errors === _errs15) {
                                                                    if (data6 && typeof data6 == "object" && !Array.isArray(data6)) {
                                                                        let missing2;

                                                                        if ((data6.md5sum === undefined) && (missing2 = "md5sum")) {
                                                                            const err4 = {
                                                                                instancePath: instancePath + "/filenames/" + i0 + "/value",
                                                                                schemaPath: "#/properties/filenames/items/anyOf/0/properties/value/required",
                                                                                keyword: "required",
                                                                                params: {
                                                                                    missingProperty: missing2
                                                                                },
                                                                                message: "must have required property '" + missing2 + "'"
                                                                            };

                                                                            if (vErrors === null) {
                                                                                vErrors = [
                                                                                    err4
                                                                                ];
                                                                            } else {
                                                                                vErrors.push(err4);
                                                                            }

                                                                            errors ++;
                                                                        } else {
                                                                            if (data6.md5sum !== undefined) {
                                                                                if (typeof data6.md5sum !== "string") {
                                                                                    const err5 = {
                                                                                        instancePath: instancePath + "/filenames/" + i0 + "/value/md5sum",
                                                                                        schemaPath: "#/properties/filenames/items/anyOf/0/properties/value/properties/md5sum/type",
                                                                                        keyword: "type",
                                                                                        params: {
                                                                                            type: "string"
                                                                                        },
                                                                                        message: "must be string"
                                                                                    };

                                                                                    if (vErrors === null) {
                                                                                        vErrors = [
                                                                                            err5
                                                                                        ];
                                                                                    } else {
                                                                                        vErrors.push(err5);
                                                                                    }

                                                                                    errors ++;
                                                                                }
                                                                            }
                                                                        }
                                                                    } else {
                                                                        const err6 = {
                                                                            instancePath: instancePath + "/filenames/" + i0 + "/value",
                                                                            schemaPath: "#/properties/filenames/items/anyOf/0/properties/value/type",
                                                                            keyword: "type",
                                                                            params: {
                                                                                type: "object"
                                                                            },
                                                                            message: "must be object"
                                                                        };

                                                                        if (vErrors === null) {
                                                                            vErrors = [
                                                                                err6
                                                                            ];
                                                                        } else {
                                                                            vErrors.push(err6);
                                                                        }

                                                                        errors ++;
                                                                    }
                                                                }

                                                                var valid3 = _errs15 === errors;
                                                            } else {
                                                                var valid3 = true;
                                                            }
                                                        }
                                                    }
                                                }
                                            } else {
                                                const err7 = {
                                                    instancePath: instancePath + "/filenames/" + i0,
                                                    schemaPath: "#/properties/filenames/items/anyOf/0/type",
                                                    keyword: "type",
                                                    params: {
                                                        type: "object"
                                                    },
                                                    message: "must be object"
                                                };

                                                if (vErrors === null) {
                                                    vErrors = [
                                                        err7
                                                    ];
                                                } else {
                                                    vErrors.push(err7);
                                                }

                                                errors ++;
                                            }
                                        }

                                        var _valid0 = _errs9 === errors;

                                        valid2 = valid2 || _valid0;

                                        if (!valid2) {
                                            const _errs19 = errors;

                                            if (errors === _errs19) {
                                                if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                                                    let missing3;

                                                    if ((((data3.check === undefined) && (missing3 = "check")) || ((data3.filename === undefined) && (missing3 = "filename"))) || ((data3.value === undefined) && (missing3 = "value"))) {
                                                        const err8 = {
                                                            instancePath: instancePath + "/filenames/" + i0,
                                                            schemaPath: "#/properties/filenames/items/anyOf/1/required",
                                                            keyword: "required",
                                                            params: {
                                                                missingProperty: missing3
                                                            },
                                                            message: "must have required property '" + missing3 + "'"
                                                        };

                                                        if (vErrors === null) {
                                                            vErrors = [
                                                                err8
                                                            ];
                                                        } else {
                                                            vErrors.push(err8);
                                                        }

                                                        errors ++;
                                                    } else {
                                                        if (data3.check !== undefined) {
                                                            let data8 = data3.check;
                                                            const _errs21 = errors;

                                                            if (typeof data8 !== "string") {
                                                                const err9 = {
                                                                    instancePath: instancePath + "/filenames/" + i0 + "/check",
                                                                    schemaPath: "#/properties/filenames/items/anyOf/1/properties/check/type",
                                                                    keyword: "type",
                                                                    params: {
                                                                        type: "string"
                                                                    },
                                                                    message: "must be string"
                                                                };

                                                                if (vErrors === null) {
                                                                    vErrors = [
                                                                        err9
                                                                    ];
                                                                } else {
                                                                    vErrors.push(err9);
                                                                }

                                                                errors ++;
                                                            }

                                                            if ("md5" !== data8) {
                                                                const err10 = {
                                                                    instancePath: instancePath + "/filenames/" + i0 + "/check",
                                                                    schemaPath: "#/properties/filenames/items/anyOf/1/properties/check/const",
                                                                    keyword: "const",
                                                                    params: {
                                                                        allowedValue: "md5"
                                                                    },
                                                                    message: "must be equal to constant"
                                                                };

                                                                if (vErrors === null) {
                                                                    vErrors = [
                                                                        err10
                                                                    ];
                                                                } else {
                                                                    vErrors.push(err10);
                                                                }

                                                                errors ++;
                                                            }

                                                            var valid5 = _errs21 === errors;
                                                        } else {
                                                            var valid5 = true;
                                                        }

                                                        if (valid5) {
                                                            if (data3.filename !== undefined) {
                                                                const _errs23 = errors;

                                                                if (typeof data3.filename !== "string") {
                                                                    const err11 = {
                                                                        instancePath: instancePath + "/filenames/" + i0 + "/filename",
                                                                        schemaPath: "#/properties/filenames/items/anyOf/1/properties/filename/type",
                                                                        keyword: "type",
                                                                        params: {
                                                                            type: "string"
                                                                        },
                                                                        message: "must be string"
                                                                    };

                                                                    if (vErrors === null) {
                                                                        vErrors = [
                                                                            err11
                                                                        ];
                                                                    } else {
                                                                        vErrors.push(err11);
                                                                    }

                                                                    errors ++;
                                                                }

                                                                var valid5 = _errs23 === errors;
                                                            } else {
                                                                var valid5 = true;
                                                            }

                                                            if (valid5) {
                                                                if (data3.value !== undefined) {
                                                                    let data10 = data3.value;
                                                                    const _errs25 = errors;

                                                                    if (errors === _errs25) {
                                                                        if (data10 && typeof data10 == "object" && !Array.isArray(data10)) {
                                                                            let missing4;

                                                                            if (((data10.md5sum === undefined) && (missing4 = "md5sum")) || ((data10.field === undefined) && (missing4 = "field"))) {
                                                                                const err12 = {
                                                                                    instancePath: instancePath + "/filenames/" + i0 + "/value",
                                                                                    schemaPath: "#/properties/filenames/items/anyOf/1/properties/value/required",
                                                                                    keyword: "required",
                                                                                    params: {
                                                                                        missingProperty: missing4
                                                                                    },
                                                                                    message: "must have required property '" + missing4 + "'"
                                                                                };

                                                                                if (vErrors === null) {
                                                                                    vErrors = [
                                                                                        err12
                                                                                    ];
                                                                                } else {
                                                                                    vErrors.push(err12);
                                                                                }

                                                                                errors ++;
                                                                            } else {
                                                                                if (data10.field !== undefined) {
                                                                                    const _errs27 = errors;

                                                                                    if (typeof data10.field !== "string") {
                                                                                        const err13 = {
                                                                                            instancePath: instancePath + "/filenames/" + i0 + "/value/field",
                                                                                            schemaPath: "#/properties/filenames/items/anyOf/1/properties/value/properties/field/type",
                                                                                            keyword: "type",
                                                                                            params: {
                                                                                                type: "string"
                                                                                            },
                                                                                            message: "must be string"
                                                                                        };

                                                                                        if (vErrors === null) {
                                                                                            vErrors = [
                                                                                                err13
                                                                                            ];
                                                                                        } else {
                                                                                            vErrors.push(err13);
                                                                                        }

                                                                                        errors ++;
                                                                                    }

                                                                                    var valid6 = _errs27 === errors;
                                                                                } else {
                                                                                    var valid6 = true;
                                                                                }

                                                                                if (valid6) {
                                                                                    if (data10.md5sum !== undefined) {
                                                                                        const _errs29 = errors;

                                                                                        if (typeof data10.md5sum !== "string") {
                                                                                            const err14 = {
                                                                                                instancePath: instancePath + "/filenames/" + i0 + "/value/md5sum",
                                                                                                schemaPath: "#/properties/filenames/items/anyOf/1/properties/value/properties/md5sum/type",
                                                                                                keyword: "type",
                                                                                                params: {
                                                                                                    type: "string"
                                                                                                },
                                                                                                message: "must be string"
                                                                                            };

                                                                                            if (vErrors === null) {
                                                                                                vErrors = [
                                                                                                    err14
                                                                                                ];
                                                                                            } else {
                                                                                                vErrors.push(err14);
                                                                                            }

                                                                                            errors ++;
                                                                                        }

                                                                                        var valid6 = _errs29 === errors;
                                                                                    } else {
                                                                                        var valid6 = true;
                                                                                    }
                                                                                }
                                                                            }
                                                                        } else {
                                                                            const err15 = {
                                                                                instancePath: instancePath + "/filenames/" + i0 + "/value",
                                                                                schemaPath: "#/properties/filenames/items/anyOf/1/properties/value/type",
                                                                                keyword: "type",
                                                                                params: {
                                                                                    type: "object"
                                                                                },
                                                                                message: "must be object"
                                                                            };

                                                                            if (vErrors === null) {
                                                                                vErrors = [
                                                                                    err15
                                                                                ];
                                                                            } else {
                                                                                vErrors.push(err15);
                                                                            }

                                                                            errors ++;
                                                                        }
                                                                    }

                                                                    var valid5 = _errs25 === errors;
                                                                } else {
                                                                    var valid5 = true;
                                                                }
                                                            }
                                                        }
                                                    }
                                                } else {
                                                    const err16 = {
                                                        instancePath: instancePath + "/filenames/" + i0,
                                                        schemaPath: "#/properties/filenames/items/anyOf/1/type",
                                                        keyword: "type",
                                                        params: {
                                                            type: "object"
                                                        },
                                                        message: "must be object"
                                                    };

                                                    if (vErrors === null) {
                                                        vErrors = [
                                                            err16
                                                        ];
                                                    } else {
                                                        vErrors.push(err16);
                                                    }

                                                    errors ++;
                                                }
                                            }

                                            var _valid0 = _errs19 === errors;

                                            valid2 = valid2 || _valid0;

                                            if (!valid2) {
                                                const _errs31 = errors;

                                                if (errors === _errs31) {
                                                    if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
                                                        let missing5;

                                                        if ((((data3.check === undefined) && (missing5 = "check")) || ((data3.filename === undefined) && (missing5 = "filename"))) || ((data3.value === undefined) && (missing5 = "value"))) {
                                                            const err17 = {
                                                                instancePath: instancePath + "/filenames/" + i0,
                                                                schemaPath: "#/properties/filenames/items/anyOf/2/required",
                                                                keyword: "required",
                                                                params: {
                                                                    missingProperty: missing5
                                                                },
                                                                message: "must have required property '" + missing5 + "'"
                                                            };

                                                            if (vErrors === null) {
                                                                vErrors = [
                                                                    err17
                                                                ];
                                                            } else {
                                                                vErrors.push(err17);
                                                            }

                                                            errors ++;
                                                        } else {
                                                            if (data3.check !== undefined) {
                                                                let data13 = data3.check;
                                                                const _errs33 = errors;

                                                                if (typeof data13 !== "string") {
                                                                    const err18 = {
                                                                        instancePath: instancePath + "/filenames/" + i0 + "/check",
                                                                        schemaPath: "#/properties/filenames/items/anyOf/2/properties/check/type",
                                                                        keyword: "type",
                                                                        params: {
                                                                            type: "string"
                                                                        },
                                                                        message: "must be string"
                                                                    };

                                                                    if (vErrors === null) {
                                                                        vErrors = [
                                                                            err18
                                                                        ];
                                                                    } else {
                                                                        vErrors.push(err18);
                                                                    }

                                                                    errors ++;
                                                                }

                                                                if ("link" !== data13) {
                                                                    const err19 = {
                                                                        instancePath: instancePath + "/filenames/" + i0 + "/check",
                                                                        schemaPath: "#/properties/filenames/items/anyOf/2/properties/check/const",
                                                                        keyword: "const",
                                                                        params: {
                                                                            allowedValue: "link"
                                                                        },
                                                                        message: "must be equal to constant"
                                                                    };

                                                                    if (vErrors === null) {
                                                                        vErrors = [
                                                                            err19
                                                                        ];
                                                                    } else {
                                                                        vErrors.push(err19);
                                                                    }

                                                                    errors ++;
                                                                }

                                                                var valid7 = _errs33 === errors;
                                                            } else {
                                                                var valid7 = true;
                                                            }

                                                            if (valid7) {
                                                                if (data3.filename !== undefined) {
                                                                    const _errs35 = errors;

                                                                    if (typeof data3.filename !== "string") {
                                                                        const err20 = {
                                                                            instancePath: instancePath + "/filenames/" + i0 + "/filename",
                                                                            schemaPath: "#/properties/filenames/items/anyOf/2/properties/filename/type",
                                                                            keyword: "type",
                                                                            params: {
                                                                                type: "string"
                                                                            },
                                                                            message: "must be string"
                                                                        };

                                                                        if (vErrors === null) {
                                                                            vErrors = [
                                                                                err20
                                                                            ];
                                                                        } else {
                                                                            vErrors.push(err20);
                                                                        }

                                                                        errors ++;
                                                                    }

                                                                    var valid7 = _errs35 === errors;
                                                                } else {
                                                                    var valid7 = true;
                                                                }

                                                                if (valid7) {
                                                                    if (data3.value !== undefined) {
                                                                        let data15 = data3.value;
                                                                        const _errs37 = errors;

                                                                        if (errors === _errs37) {
                                                                            if (data15 && typeof data15 == "object" && !Array.isArray(data15)) {
                                                                                let missing6;

                                                                                if ((data15.artifactdb_id === undefined) && (missing6 = "artifactdb_id")) {
                                                                                    const err21 = {
                                                                                        instancePath: instancePath + "/filenames/" + i0 + "/value",
                                                                                        schemaPath: "#/properties/filenames/items/anyOf/2/properties/value/required",
                                                                                        keyword: "required",
                                                                                        params: {
                                                                                            missingProperty: missing6
                                                                                        },
                                                                                        message: "must have required property '" + missing6 + "'"
                                                                                    };

                                                                                    if (vErrors === null) {
                                                                                        vErrors = [
                                                                                            err21
                                                                                        ];
                                                                                    } else {
                                                                                        vErrors.push(err21);
                                                                                    }

                                                                                    errors ++;
                                                                                } else {
                                                                                    if (data15.artifactdb_id !== undefined) {
                                                                                        if (typeof data15.artifactdb_id !== "string") {
                                                                                            const err22 = {
                                                                                                instancePath: instancePath + "/filenames/" + i0 + "/value/artifactdb_id",
                                                                                                schemaPath: "#/properties/filenames/items/anyOf/2/properties/value/properties/artifactdb_id/type",
                                                                                                keyword: "type",
                                                                                                params: {
                                                                                                    type: "string"
                                                                                                },
                                                                                                message: "must be string"
                                                                                            };

                                                                                            if (vErrors === null) {
                                                                                                vErrors = [
                                                                                                    err22
                                                                                                ];
                                                                                            } else {
                                                                                                vErrors.push(err22);
                                                                                            }

                                                                                            errors ++;
                                                                                        }
                                                                                    }
                                                                                }
                                                                            } else {
                                                                                const err23 = {
                                                                                    instancePath: instancePath + "/filenames/" + i0 + "/value",
                                                                                    schemaPath: "#/properties/filenames/items/anyOf/2/properties/value/type",
                                                                                    keyword: "type",
                                                                                    params: {
                                                                                        type: "object"
                                                                                    },
                                                                                    message: "must be object"
                                                                                };

                                                                                if (vErrors === null) {
                                                                                    vErrors = [
                                                                                        err23
                                                                                    ];
                                                                                } else {
                                                                                    vErrors.push(err23);
                                                                                }

                                                                                errors ++;
                                                                            }
                                                                        }

                                                                        var valid7 = _errs37 === errors;
                                                                    } else {
                                                                        var valid7 = true;
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    } else {
                                                        const err24 = {
                                                            instancePath: instancePath + "/filenames/" + i0,
                                                            schemaPath: "#/properties/filenames/items/anyOf/2/type",
                                                            keyword: "type",
                                                            params: {
                                                                type: "object"
                                                            },
                                                            message: "must be object"
                                                        };

                                                        if (vErrors === null) {
                                                            vErrors = [
                                                                err24
                                                            ];
                                                        } else {
                                                            vErrors.push(err24);
                                                        }

                                                        errors ++;
                                                    }
                                                }

                                                var _valid0 = _errs31 === errors;

                                                valid2 = valid2 || _valid0;
                                            }
                                        }

                                        if (!valid2) {
                                            const err25 = {
                                                instancePath: instancePath + "/filenames/" + i0,
                                                schemaPath: "#/properties/filenames/items/anyOf",
                                                keyword: "anyOf",
                                                params: {},
                                                message: "must match a schema in anyOf"
                                            };

                                            if (vErrors === null) {
                                                vErrors = [
                                                    err25
                                                ];
                                            } else {
                                                vErrors.push(err25);
                                            }

                                            errors ++;
                                            validate10.errors = vErrors;

                                            return false;
                                        } else {
                                            errors = _errs8;

                                            if (vErrors !== null) {
                                                if (_errs8) {
                                                    vErrors.length = _errs8;
                                                } else {
                                                    vErrors = null;
                                                }
                                            }
                                        }

                                        var valid1 = _errs7 === errors;

                                        if (!valid1) {
                                            break;
                                        }
                                    }
                                } else {
                                    validate10.errors = [
                                        {
                                            instancePath: instancePath + "/filenames",
                                            schemaPath: "#/properties/filenames/type",
                                            keyword: "type",
                                            params: {
                                                type: "array"
                                            },
                                            message: "must be array"
                                        }
                                    ];

                                    return false;
                                }
                            }

                            var valid0 = _errs5 === errors;
                        } else {
                            var valid0 = true;
                        }
                    }
                }
            }
        } else {
            validate10.errors = [
                {
                    instancePath,
                    schemaPath: "#/type",
                    keyword: "type",
                    params: {
                        type: "object"
                    },
                    message: "must be object"
                }
            ];

            return false;
        }
    }

    validate10.errors = vErrors;

    return errors === 0;
}

export const complete_project_version = validate11;
const schema12 = {
    $id: "complete_project_version.json",
    $schema: "http://json-schema.org/draft-07/schema",
    description: "JSON body of the request for the `POST /projects/{project}/version/{version}/upload` endpoint.",
    properties: {
        owners: {
            "default": [],
            description: "Array of users who own the resource, i.e., can change permissions or create new versions.",
            items: {
                type: "string"
            },
            type: "array"
        },
        read_access: {
            "default": "public",
            description: "Type of read access.",
            "enum": [
                "none",
                "viewers",
                "public"
            ],
            type: "string"
        },
        scope: {
            "default": "project",
            description: "Scope of the permissions",
            "enum": [
                "project",
                "version"
            ],
            type: "string"
        },
        viewers: {
            "default": [],
            description: "Array of users who are allowed to view the resource.",
            items: {
                type: "string"
            },
            type: "array"
        },
        write_access: {
            "default": "owners",
            description: "Type of write access.",
            "enum": [
                "none",
                "owners"
            ],
            type: "string"
        }
    },
    title: "Complete project version upload request",
    type: "object"
};

function validate11(data, {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data
}
= {}) {
    /*# sourceURL="complete_project_version.json" */;
    let vErrors = null;
    let errors = 0;

    if (errors === 0) {
        if (data && typeof data == "object" && !Array.isArray(data)) {
            if (data.owners !== undefined) {
                let data0 = data.owners;
                const _errs1 = errors;

                if (errors === _errs1) {
                    if (Array.isArray(data0)) {
                        var valid1 = true;

                        const len0 = data0.length;

                        for (let i0 = 0; i0 < len0; i0 ++) {
                            const _errs3 = errors;

                            if (typeof data0[i0] !== "string") {
                                validate11.errors = [
                                    {
                                        instancePath: instancePath + "/owners/" + i0,
                                        schemaPath: "#/properties/owners/items/type",
                                        keyword: "type",
                                        params: {
                                            type: "string"
                                        },
                                        message: "must be string"
                                    }
                                ];

                                return false;
                            }

                            var valid1 = _errs3 === errors;

                            if (!valid1) {
                                break;
                            }
                        }
                    } else {
                        validate11.errors = [
                            {
                                instancePath: instancePath + "/owners",
                                schemaPath: "#/properties/owners/type",
                                keyword: "type",
                                params: {
                                    type: "array"
                                },
                                message: "must be array"
                            }
                        ];

                        return false;
                    }
                }

                var valid0 = _errs1 === errors;
            } else {
                var valid0 = true;
            }

            if (valid0) {
                if (data.read_access !== undefined) {
                    let data2 = data.read_access;
                    const _errs5 = errors;

                    if (typeof data2 !== "string") {
                        validate11.errors = [
                            {
                                instancePath: instancePath + "/read_access",
                                schemaPath: "#/properties/read_access/type",
                                keyword: "type",
                                params: {
                                    type: "string"
                                },
                                message: "must be string"
                            }
                        ];

                        return false;
                    }

                    if (!(((data2 === "none") || (data2 === "viewers")) || (data2 === "public"))) {
                        validate11.errors = [
                            {
                                instancePath: instancePath + "/read_access",
                                schemaPath: "#/properties/read_access/enum",
                                keyword: "enum",
                                params: {
                                    allowedValues: schema12.properties.read_access.enum
                                },
                                message: "must be equal to one of the allowed values"
                            }
                        ];

                        return false;
                    }

                    var valid0 = _errs5 === errors;
                } else {
                    var valid0 = true;
                }

                if (valid0) {
                    if (data.scope !== undefined) {
                        let data3 = data.scope;
                        const _errs7 = errors;

                        if (typeof data3 !== "string") {
                            validate11.errors = [
                                {
                                    instancePath: instancePath + "/scope",
                                    schemaPath: "#/properties/scope/type",
                                    keyword: "type",
                                    params: {
                                        type: "string"
                                    },
                                    message: "must be string"
                                }
                            ];

                            return false;
                        }

                        if (!((data3 === "project") || (data3 === "version"))) {
                            validate11.errors = [
                                {
                                    instancePath: instancePath + "/scope",
                                    schemaPath: "#/properties/scope/enum",
                                    keyword: "enum",
                                    params: {
                                        allowedValues: schema12.properties.scope.enum
                                    },
                                    message: "must be equal to one of the allowed values"
                                }
                            ];

                            return false;
                        }

                        var valid0 = _errs7 === errors;
                    } else {
                        var valid0 = true;
                    }

                    if (valid0) {
                        if (data.viewers !== undefined) {
                            let data4 = data.viewers;
                            const _errs9 = errors;

                            if (errors === _errs9) {
                                if (Array.isArray(data4)) {
                                    var valid2 = true;

                                    const len1 = data4.length;

                                    for (let i1 = 0; i1 < len1; i1 ++) {
                                        const _errs11 = errors;

                                        if (typeof data4[i1] !== "string") {
                                            validate11.errors = [
                                                {
                                                    instancePath: instancePath + "/viewers/" + i1,
                                                    schemaPath: "#/properties/viewers/items/type",
                                                    keyword: "type",
                                                    params: {
                                                        type: "string"
                                                    },
                                                    message: "must be string"
                                                }
                                            ];

                                            return false;
                                        }

                                        var valid2 = _errs11 === errors;

                                        if (!valid2) {
                                            break;
                                        }
                                    }
                                } else {
                                    validate11.errors = [
                                        {
                                            instancePath: instancePath + "/viewers",
                                            schemaPath: "#/properties/viewers/type",
                                            keyword: "type",
                                            params: {
                                                type: "array"
                                            },
                                            message: "must be array"
                                        }
                                    ];

                                    return false;
                                }
                            }

                            var valid0 = _errs9 === errors;
                        } else {
                            var valid0 = true;
                        }

                        if (valid0) {
                            if (data.write_access !== undefined) {
                                let data6 = data.write_access;
                                const _errs13 = errors;

                                if (typeof data6 !== "string") {
                                    validate11.errors = [
                                        {
                                            instancePath: instancePath + "/write_access",
                                            schemaPath: "#/properties/write_access/type",
                                            keyword: "type",
                                            params: {
                                                type: "string"
                                            },
                                            message: "must be string"
                                        }
                                    ];

                                    return false;
                                }

                                if (!((data6 === "none") || (data6 === "owners"))) {
                                    validate11.errors = [
                                        {
                                            instancePath: instancePath + "/write_access",
                                            schemaPath: "#/properties/write_access/enum",
                                            keyword: "enum",
                                            params: {
                                                allowedValues: schema12.properties.write_access.enum
                                            },
                                            message: "must be equal to one of the allowed values"
                                        }
                                    ];

                                    return false;
                                }

                                var valid0 = _errs13 === errors;
                            } else {
                                var valid0 = true;
                            }
                        }
                    }
                }
            }
        } else {
            validate11.errors = [
                {
                    instancePath,
                    schemaPath: "#/type",
                    keyword: "type",
                    params: {
                        type: "object"
                    },
                    message: "must be object"
                }
            ];

            return false;
        }
    }

    validate11.errors = vErrors;

    return errors === 0;
}

export const permissions = validate12;
const schema13 = {
    $id: "permissions.json",
    $schema: "http://json-schema.org/draft-07/schema",
    description: "JSON body of the request for the `PUT /projects/{project}/permissions` endpoint. If any property is missing, it is assumed to be unchanged from the existing value of that property in the ArtifactDB permissions. See the `GET /projects/{project}/permissions` endpoint for the existing permissions.",
    properties: {
        owners: {
            description: "Array of users who own the resource, i.e., can change permissions or create new versions.",
            items: {
                type: "string"
            },
            type: "array"
        },
        read_access: {
            description: "Type of read access.",
            "enum": [
                "none",
                "viewers",
                "public"
            ],
            type: "string"
        },
        scope: {
            description: "Scope of the permissions",
            "enum": [
                "project",
                "version"
            ],
            type: "string"
        },
        viewers: {
            description: "Array of users who are allowed to view the resource.",
            items: {
                type: "string"
            },
            type: "array"
        },
        write_access: {
            description: "Type of write access.",
            "enum": [
                "none",
                "owners"
            ],
            type: "string"
        }
    },
    title: "Permissions request",
    type: "object"
};

function validate12(data, {
    instancePath = "",
    parentData,
    parentDataProperty,
    rootData = data
}
= {}) {
    /*# sourceURL="permissions.json" */;
    let vErrors = null;
    let errors = 0;

    if (errors === 0) {
        if (data && typeof data == "object" && !Array.isArray(data)) {
            if (data.owners !== undefined) {
                let data0 = data.owners;
                const _errs1 = errors;

                if (errors === _errs1) {
                    if (Array.isArray(data0)) {
                        var valid1 = true;

                        const len0 = data0.length;

                        for (let i0 = 0; i0 < len0; i0 ++) {
                            const _errs3 = errors;

                            if (typeof data0[i0] !== "string") {
                                validate12.errors = [
                                    {
                                        instancePath: instancePath + "/owners/" + i0,
                                        schemaPath: "#/properties/owners/items/type",
                                        keyword: "type",
                                        params: {
                                            type: "string"
                                        },
                                        message: "must be string"
                                    }
                                ];

                                return false;
                            }

                            var valid1 = _errs3 === errors;

                            if (!valid1) {
                                break;
                            }
                        }
                    } else {
                        validate12.errors = [
                            {
                                instancePath: instancePath + "/owners",
                                schemaPath: "#/properties/owners/type",
                                keyword: "type",
                                params: {
                                    type: "array"
                                },
                                message: "must be array"
                            }
                        ];

                        return false;
                    }
                }

                var valid0 = _errs1 === errors;
            } else {
                var valid0 = true;
            }

            if (valid0) {
                if (data.read_access !== undefined) {
                    let data2 = data.read_access;
                    const _errs5 = errors;

                    if (typeof data2 !== "string") {
                        validate12.errors = [
                            {
                                instancePath: instancePath + "/read_access",
                                schemaPath: "#/properties/read_access/type",
                                keyword: "type",
                                params: {
                                    type: "string"
                                },
                                message: "must be string"
                            }
                        ];

                        return false;
                    }

                    if (!(((data2 === "none") || (data2 === "viewers")) || (data2 === "public"))) {
                        validate12.errors = [
                            {
                                instancePath: instancePath + "/read_access",
                                schemaPath: "#/properties/read_access/enum",
                                keyword: "enum",
                                params: {
                                    allowedValues: schema13.properties.read_access.enum
                                },
                                message: "must be equal to one of the allowed values"
                            }
                        ];

                        return false;
                    }

                    var valid0 = _errs5 === errors;
                } else {
                    var valid0 = true;
                }

                if (valid0) {
                    if (data.scope !== undefined) {
                        let data3 = data.scope;
                        const _errs7 = errors;

                        if (typeof data3 !== "string") {
                            validate12.errors = [
                                {
                                    instancePath: instancePath + "/scope",
                                    schemaPath: "#/properties/scope/type",
                                    keyword: "type",
                                    params: {
                                        type: "string"
                                    },
                                    message: "must be string"
                                }
                            ];

                            return false;
                        }

                        if (!((data3 === "project") || (data3 === "version"))) {
                            validate12.errors = [
                                {
                                    instancePath: instancePath + "/scope",
                                    schemaPath: "#/properties/scope/enum",
                                    keyword: "enum",
                                    params: {
                                        allowedValues: schema13.properties.scope.enum
                                    },
                                    message: "must be equal to one of the allowed values"
                                }
                            ];

                            return false;
                        }

                        var valid0 = _errs7 === errors;
                    } else {
                        var valid0 = true;
                    }

                    if (valid0) {
                        if (data.viewers !== undefined) {
                            let data4 = data.viewers;
                            const _errs9 = errors;

                            if (errors === _errs9) {
                                if (Array.isArray(data4)) {
                                    var valid2 = true;

                                    const len1 = data4.length;

                                    for (let i1 = 0; i1 < len1; i1 ++) {
                                        const _errs11 = errors;

                                        if (typeof data4[i1] !== "string") {
                                            validate12.errors = [
                                                {
                                                    instancePath: instancePath + "/viewers/" + i1,
                                                    schemaPath: "#/properties/viewers/items/type",
                                                    keyword: "type",
                                                    params: {
                                                        type: "string"
                                                    },
                                                    message: "must be string"
                                                }
                                            ];

                                            return false;
                                        }

                                        var valid2 = _errs11 === errors;

                                        if (!valid2) {
                                            break;
                                        }
                                    }
                                } else {
                                    validate12.errors = [
                                        {
                                            instancePath: instancePath + "/viewers",
                                            schemaPath: "#/properties/viewers/type",
                                            keyword: "type",
                                            params: {
                                                type: "array"
                                            },
                                            message: "must be array"
                                        }
                                    ];

                                    return false;
                                }
                            }

                            var valid0 = _errs9 === errors;
                        } else {
                            var valid0 = true;
                        }

                        if (valid0) {
                            if (data.write_access !== undefined) {
                                let data6 = data.write_access;
                                const _errs13 = errors;

                                if (typeof data6 !== "string") {
                                    validate12.errors = [
                                        {
                                            instancePath: instancePath + "/write_access",
                                            schemaPath: "#/properties/write_access/type",
                                            keyword: "type",
                                            params: {
                                                type: "string"
                                            },
                                            message: "must be string"
                                        }
                                    ];

                                    return false;
                                }

                                if (!((data6 === "none") || (data6 === "owners"))) {
                                    validate12.errors = [
                                        {
                                            instancePath: instancePath + "/write_access",
                                            schemaPath: "#/properties/write_access/enum",
                                            keyword: "enum",
                                            params: {
                                                allowedValues: schema13.properties.write_access.enum
                                            },
                                            message: "must be equal to one of the allowed values"
                                        }
                                    ];

                                    return false;
                                }

                                var valid0 = _errs13 === errors;
                            } else {
                                var valid0 = true;
                            }
                        }
                    }
                }
            }
        } else {
            validate12.errors = [
                {
                    instancePath,
                    schemaPath: "#/type",
                    keyword: "type",
                    params: {
                        type: "object"
                    },
                    message: "must be object"
                }
            ];

            return false;
        }
    }

    validate12.errors = vErrors;

    return errors === 0;
}