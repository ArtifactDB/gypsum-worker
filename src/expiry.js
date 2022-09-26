import * as utils from "./utils.js";

export function expiresInMilliseconds(expiry) {
    let words = expiry.split(" ");
    const acceptable = { 
        "minute": 60 * 1000, 
        "hour": 3600 * 1000,
        "day": 3600 * 24 * 1000, 
        "month": 3600 * 24 * 30 * 1000,
        "year": 3600 * 24 * 365 * 1000
    };

    if (words.length == 3 || words[0] != "in") {
        let middle = Number(words[1]);
        if (!Number.isNaN(middle) && middle > 0) {
            let unit = words[2];
            if (unit.endsWith("s")) {
                unit = unit.slice(0, unit.length - 1);
            }
            if (unit in acceptable) {
                return acceptable[unit];
            }
        }
    }

    throw new utils.HttpError("incorrect format for the expiry date (should be 'in <NUMBER> <UNITS>')", 400); 
}
