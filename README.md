# ArtifactDB on the Cloudflare stack

## Overview

**gypsum** uses Cloudflare Workers and R2 storage to provide a simple REST API for storing ArtifactDB-managed files grouped by project, asset and version.
Unlike the original ArtifactDB API, all files are intended to be publicly accessible for download, allowing us to simplify **gypsum**'s design.
A variety of permission schemes are available for maintainers to control uploads, e.g., from external contributors.

## Concepts

### File organization

Each project may have multiple assets, and each asset may have multiple versions.
All user-supplied files are associated with a particular project-asset-version combination, and thus will always have a `{project}/{asset}/{version}/` prefix in their R2 bucket path.
This hierarchy is motivated by usage scenarios in Bioconductor packages;
each project corresponds to a single package, but different parts of the package may require different data assets, each of which may have different update frequencies.
Each version of an asset is immutable for reproducibility purposes, and **gypsum** keeps track of the latest version for "live at head" applications.

### Link deduplication

When creating a new version of a project's assets, **gypsum** can be instructed to attempt deduplication based on file size and MD5 checksum.
The API will inspect the immediate previous version of the asset to see if any other files have a matching size/checksum.
If so, it will create a link to the file in the previous version rather than uploading a redundant copy.
This improves efficiency by reducing storage and data transfer.
Uploaders can also directly instruct **gypsum** to create links if the original identity of the copied file is known in advance.

Note that "linked-from" files (i.e., those identified as copies of other existing files) will not be represented in the bucket - not even as a placeholder.
Readers will have to inspect the manifest or link files to retrieve the contents of each linked-from file, see below for details.

### Permissions

**gypsum** supports three levels of permissions - adminstrators, project owners and uploaders.

- Uploaders can upload new assets or versions to an existing project.
  Upload authorization is provided by the project's owners, and can be limited to particular asset/version names, or within a certain time frame.
  Project owners can also specify whether an uploader is untrusted (and thus whether their uploads should be probational, see below).
- Project owners can modify the permissions of their project, including the addition/removal of new owners or changes to uploader authorizations.
  They can also do anything that uploaders can do.
- Adminstrators can create projects and projects (or particular assets/versions thereof).
  They can also do anything that project owners can do.

All users are authenticated by their GitHub personal access tokens.
Permissions can also be extended to GitHub organizations, in which case each user's organization membership may also be inspected.

### Upload probation

Uploads can be specified as "probational" if they come from untrusted sources.
The uploaded files are present in the bucket and accessible to readers;
however, they are not immutable and are not used to set the latest version of an asset.
This is useful when considering third-party contributions to a project, where project owners can review the upload and approve/reject it.
Approved probational uploads have the same status as a trusted upload from the project owner themselves, while rejected probational uploads are deleted entirely from the bucket.
Probational uploads can also be rejected by the uploading user themselves, e.g., to fix known problems before a project owner's review.

Uploads from untrusted uploaders are always probational.
For trusted uploaders or project owners, users can specify whether their upload is probational.
This is useful for testing before committing to the long-term immutability of the uploaded files. 

## Interacting with the API

**gypsum** stores its files in a public R2 bucket that can be accessed by any S3-compatible client.
As mentioned before, all files associated with a particular project-asset-version always have a `{project}/{asset}/{version}/` prefix and can be retrieved accordingly.

**gypsum** itself adds some further metadata in the form of `..`-named files.
Each of these can be inspected for more details about each project:

- `{project}/{asset}/{version}/..summary`: a JSON-formatted file that contains a JSON object with the following properties:
  - `upload_user_id`, a string containing the identity of the uploading user.
  - `upload_start`, an Internet date/time-formatted string containing the upload start time.
  - `upload_finish`, an Internet date/time-formatted string containing the upload finish time.
  - `on_probation`, a boolean indicating whether this upload is on probation.
- `{project}/{asset}/{version}/..manifest`: a JSON-formatted file that contains a JSON object.
  Each key/value pair describes a user-supplied file, where the key is the relative file path that should be appended to the `{project}/{asset}/{version}/` prefix to obtain the full bucket path.
  and the value is another object with the following properties:
  - `size`: an integer specifying the size of the file in bytes.
  - `md5sum`: a string containing the hex-encoded MD5 checksum of the file.
  - `link` (optional): an object specifying the link destination for a file.
    This contains the strings `project`, `asset`, `version` and `path`.
- `{project}/{asset}/..latest`: a JSON-formatted file that contains a JSON object with the following properties:
  - `latest`: String containing the name of the latest version of this asset.
- `{project}/..permissions`: a JSON-formatted file that contains a JSON object with the following properties:
  - `owners`: An array of strings containing the GitHub user names or organizations that own this project.
  - `uploaders`: An array of objects specifying GitHub users or organizations that are authorized to be uploaders.
    Each object has the following properties:
    - `id`: String containing the identity of the user/organization.
    - `asset` (optional): String containing the name of the asset that the uploader is allowed to upload to.
      If not specified, no restrictions are placed on the asset name.
    - `version` (optional): String containing the name of the version that the uploader is allowed to upload to.
      This can be used with or without `asset`, in which case it applies to all new and existing assets. 
      If not specified, no restrictions are placed on the version name.
    - `until` (optional): An Internet date/time-formatted string specifying the lifetime of the authorization.
      After this time, any upload attempt is rejected.
      If not specified, the authorization does not expire by default.
    - `trusted` (optional): Boolean indicating whether the uploader is trusted.
      If `false`, all uploads are considered to be probational.
      If not specified, the uploader is trusted by default.

As previously mentioned, linked-from files are not present in the bucket.
Link information should either be retrieved from the `..manifest` file for each project-asset-version;
or from `..links` files, which avoid the need to download the entire manifest if only a subset of files are of interest.
To illustrate, consider a hypothetical link file at `{project}/{asset}/{version}/some/extra/path/..links`.
This contains a JSON object where each key is a relative file path (appended to `{project}/{asset}/{version}/some/extra/path/` to obtain the full bucket path)
and each value is another object that contains the strings `project`, `asset`, `version` and `path`, which collectively specify the link destination.
If no link file is present at a particular file prefix, it can be assumed that there are no linked-from files with that prefix.

For uploads, check out the [Swagger](swagger.json) documentation for more details.

## Deployment instructions

### Step 1: Cloudflare 

Register for a [Cloudflare account](https://cloudflare.com) if you don't already have one.

Go to the "R2" tab on the sidebar and follow the instructions to set up a R2 bucket.
This will require some credit card details, but for casual use, you are unlikely to incur charges.

### Step 2: local environment

Fork this repository and clone it into your local environment. 

Follow [these](https://developers.cloudflare.com/workers/wrangler/get-started/) instructions to install the `wrangler` tool.
Note that we currently require version 2 of `wrangler`.

Run `wrangler login` to authenticate into your Cloudflare account.

### Step 3: GitHub CI/CD 

Follow the instructions [here](https://github.com/ArtifactDB/gypsum-actions) to set up a GitHub repository for CI/CD tasks.

Pick a GitHub user account for performing CI/CD. This may be your own, but it may be preferable to create a separate [bot account](https://github.com/ArtifactDB-bot) for this purpose.

### Step 4: variables and secrets

Modify the indicated variables (denoted by `~>`) in [`wrangler.toml`](wrangler.toml).
Note that some of the variables need to be listed multiple times - this is unfortunate but necessary as `wrangler` does not automatically expose those variables to the worker's code.

Add the following secrets via `wrangler secret put`:

- `ACCESS_KEY_ID`, for the access key ID (click "manage API tokens" at the top-right corner of the R2 tab on the Cloudflare dashboard).
- `SECRET_ACCESS_KEY`, for the access secret associated with the access key ID.
- `GITHUB_PAT`, for the GitHub personal access token of the CI/CD user account. 
  This should be capable of writing issues on a public repository; typically, we use a classic token with `repo:public` permissions.

### Step 5: deployment

Run `wrangler publish` to deploy to Cloudflare Workers.
This will create an API at `https://<WORKER_NAME>.<ACCOUNT_NAME>.workers.dev`.
See [here](https://developers.cloudflare.com/workers/platform/environments) for instructions on publishing to a custom domain.
