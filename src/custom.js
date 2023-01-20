import * as utils from "./utils.js";

// Central file for applying common customizations in forks of this worker.
// These customizations are "supported" in the sense that they are treated as
// part of the developer's API and will not be affected by merge conflicts.
// Edits anywhere else in the worker code may be subject to merge conflicts.

// This function should check the names of the project and version to use. It
// may throw HttpErrors if the names are 'invalid' (for some arbitrary
// definition of validity). Return value is ignored.
export function checkProjectVersionName(project, version) {
}
