# ArtifactDB on the Cloudflare stack

![RunTests](https://github.com/ArtifactDB/gypsum-worker/actions/workflows/run-tests.yaml/badge.svg)
[![Swagger](https://github.com/ArtifactDB/gypsum-worker/actions/workflows/deploy-swagger.yaml/badge.svg)](https://gypsum.artifactdb.com)

## Overview

**gypsum** uses Cloudflare Workers and R2 storage to provide a simple REST API for storing ArtifactDB-managed files grouped by project, asset and version.
Unlike the original ArtifactDB API, all files are intended to be publicly accessible for download, allowing us to simplify **gypsum**'s design for read-only operations.
For writes, flexible permission schemes and project-specific storage quotas enable fine-grained control of uploads by both project owners and administrators. 
See [here](https://gypsum.artifactdb.com) for a deployed instance of the **gypsum** API.

This document is intended for system administrators who want to spin up their own instance or developers of new clients to the **gypsum** backend.
Users should never have to interact with the **gypsum** API directly, as this should be mediated by client packages in relevant frameworks like R/Bioconductor.
For example, the [**gypsum** R client](https://github.com/ArtifactDB/gypsum-R) provides functions for downloading or uploading files,
which are then called by more user-facing packages like the [**scRNAseq** R package](https://github.com/LTLA/scRNAseq).

## Concepts

### File organization

**gypsum** organizes its files in a hierarchy of projects, assets (nested in each project), and versions (nested in each asset).
That is, each project may have multiple assets, and each asset may have multiple versions.
All user-supplied files are associated with a particular project-asset-version combination.
This hierarchy is motivated by usage scenarios in Bioconductor packages;
each project corresponds to a single package, but different parts of the package may require different data assets, each of which may update at different frequencies.
Each version of an asset is immutable to ensure that downstream analyses are reproducible.

Within the R2 bucket, files associated with a project-asset-version combination will have a `{project}/{asset}/{version}/` prefix and can be retrieved accordingly.
For each project-asset-version combination, the set of all user-supplied files is recorded in the `{project}/{asset}/{version}/..manifest` file.
This contains a JSON object where each key/value pair describes a user-supplied file.
The key is a suffix that should be appended to the `{project}/{asset}/{version}/` prefix to obtain the full object key of the file.
The value is another object with the following properties:
- `size`: an integer specifying the size of the file in bytes.
- `md5sum`: a string containing the hex-encoded MD5 checksum of the file.
- `link` (optional): an object specifying the link destination for a file (see [below](#link-deduplication) for details).
  This contains the strings `project`, `asset`, `version` and `path`, and possibly an `ancestor` object.

**gypsum** keeps track of the latest version of each asset in the `{project}/{asset}/..latest` file.
This contains a JSON object with the following properties:
- `version`: String containing the name of the latest version of this asset.
  This is defined as the version with the most recent `upload_finish` time in the `..summary`.

For any given project-asset-version combination, the `{project}/{asset}/{version}/..summary` file records some more details about the upload process.
This contains a JSON object with the following properties:
- `upload_user_id`, a string containing the identity of the uploading user.
- `upload_start`, an Internet date/time-formatted string containing the upload start time.
- `upload_finish`, an Internet date/time-formatted string containing the upload finish time.
  This property is absent if the upload for this version is currently in progress, but will be added on upload completion. 
- `on_probation` (optional), a boolean indicating whether this upload is on probation, see [below](#upload-probation).
  If not present, this can be assumed to be `false`.

### Link deduplication

When creating a new version of a project's assets, **gypsum** can be instructed to attempt deduplication based on the file size and MD5 checksum.
The API will inspect the immediate previous version of the asset to see if any other files have a matching size/checksum.
If so, it will create a link to the file in the previous version rather than wasting disk space and upload bandwith on a redundant copy.
Uploaders can also directly instruct **gypsum** to create links if the original identity of the copied file is known in advance.

Any "linked-from" files (i.e., those identified as copies of other existing files) will not actually be present in the bucket. 
The existence of linked-from files is either determined from the `..manifest` file for each project-asset-version;
or from `..links` files, which describe the links present at each `/`-delimited prefix.
The latter allows clients to avoid downloading the entire manifest if only a subset of files are of interest.
To illustrate, consider a hypothetical `..links` file with the following object key:

```
{project}/{asset}/{version}/x/y/z/..links
```

This contains a JSON object where each key/value pair describes a linked-from file with the same `/`-delimited prefix.
The key is a suffix that should be appended to `{project}/{asset}/{version}/x/y/z/` to obtain the full object key of the linked-from file.
The value is another object that contains the strings `project`, `asset`, `version` and `path`.
These strings collectively specify the link destination supplied by the user - namely, the full object key of `{project}/{asset}/{version}/{path}`.
(`path` is so named because it is the relative path to the file inside the project-asset-version, if one were to treat `/`-delimited prefixes as filesystem subdirectories.)
If the user-supplied destination is itself another link, the object will contain a nested `ancestor` object that specifies the final link destination to an actual file.

If no `..links` file is present for a particular `/`-delimited prefix, it can be assumed that there are no linked-from files with the same prefix.
That is, if `{project}/{asset}/{version}/x/..links` does not exist, no file with a `{project}/{asset}/{version}/x/` prefix can be a link.
This guarantee does not extend to prefixes with more `/`, e.g., linked-from files may still be present with the prefix `{project}/{asset}/{version}/x/y/`.

### Permissions

**gypsum** supports three levels of permissions - adminstrators, project owners and uploaders.

- Uploaders can upload new assets or versions to an existing project.
  Upload authorization is provided by the project's owners, and can be limited to particular asset/version names, or within a certain time frame.
  Project owners can also specify whether an uploader is untrusted (and thus whether their uploads should be probational, see below).
- Project owners can modify the permissions of their project, including the addition/removal of new owners or changes to uploader authorizations.
  They can also do anything that uploaders can do.
- Adminstrators can create projects and projects (or particular assets/versions thereof).
  They can also do anything that project owners can do.

The permissions for a project are stored in the `{project}/..permissions` file.
This is a JSON-formatted file that contains a JSON object with the following properties:
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
    If not specified, the uploader is untrusted by default.

All users are authenticated by their GitHub personal access tokens.
GitHub organizations can also be listed as uploaders, owners or administrators, in which case the relevant authorization extends to all members of that organization.

### Upload probation

Uploads can be specified as "probational" if they come from untrusted sources.
The uploaded files are present in the bucket and accessible to readers;
however, they are not immutable and are not used to set the latest version of an asset in `..latest`.
This is useful when considering third-party contributions to a project, where project owners can review the upload before approving/rejecting it.
Approved probational uploads are immutable and have the same status as a trusted upload from the project owner themselves, while rejected probational uploads are deleted entirely from the bucket.
Probational uploads can also be rejected by the uploading user themselves, e.g., to fix known problems before a project owner's review.

Uploads from untrusted uploaders are always probational.
For trusted uploaders or project owners, users can specify whether their upload is probational.
This is useful for testing before committing to the long-term immutability of the uploaded files. 

### Storage quotas

Each project has a storage quota, and uploads that cause a project to exceed this quota will be declined.
This allows administrators to control the resource consumption of each project, limiting the potential for abuse by project owners.
The growth of the quota permits some accumulation of files, e.g., to retain older versions of assets for reproducibility purposes.
Administrators can customize the quota and its growth rate for each project.

Each project's quota specification is stored in `{project}/..quota`, which contains a JSON object with the following properties:
- `baseline`: the baseline quota (i.e., at time zero, or project creation) in bytes.
- `growth_rate`: the annual growth rate for the quota in bytes.
- `year`: the calendar year of project creation.

The total quota for each project is simply calculated by `(CURRENT_YEAR - year) * growth_rate + baseline`.

Each project's current usage is tracked in `{project}/..usage`, which contains a JSON object with the following properties:
- `total`: the total number of bytes allocated to user-supplied files (i.e., not including `..`-prefixed internal files).

## Interacting with the API

**gypsum** stores its files in an R2 bucket that can be accessed by any S3-compatible client.
As Cloudflare's public buckets do not expose the S3 API directly,
we need to request some read-only S3 credentials from the **gypsum** API:

```shell
curl https://gypsum.artifactdb.com/credentials/s3-api
## {
##     "endpoint":"https://blahblahblah.r2.cloudflarestorage.com",
##     "bucket":"gypsum-test",
##     "key":"asdasdasdasdasd",
##     "secret":"asdasdasdasdasdasdasdasd"
## }
```

We can then use these credentials in typical S3 workflows:

```shell
AWS_ACCESS_KEY_ID=asdasdasdasdasd \
AWS_SECRET_ACCESS_KEY=asdasdasdasdasdasdasdasd \
aws s3 ls --endpoint-url=https://blahblahblah.r2.cloudflarestorage.com gypsum-test
```

For uploads, clients are expected to authenticate using GitHub's Oauth workflow.
This should generate a GitHub access token with read access on the `user` and `org` scopes.
The token can then be passed to various API endpoints to authenticate the user. 
Administrators are similarly authenticated via GitHub.

Check out the [Swagger](https://gypsum.artifactdb.dom) documentation for more details.

## Parsing logs

For some actions, **gypsum** stores a log with a `..logs/` prefix.
The file is named after the date/time of the action's completion, followed by an underscore, followed by a random 6-digit integer for disambiguation purposes.
The file contains a JSON object that details the type of action in the `type` property:

- `add-version` indicates that a new version was added, or a probational version was approved.
  This has the `project`, `asset`, `version` string properties to describe the version.
  It also has the `latest` boolean property to indicate whether the added version is the latest one for its asset.
- `delete-version` indicates that a version was deleted.
  This has the `project`, `asset`, `version` string properties to describe the version.
  It also has the `latest` boolean property to indicate whether the deleted version was the latest one for its asset.
- `delete-asset` indicates that an asset was deleted.
  This has the `project` and `asset` string property.
- `delete-project` indicates that a project was deleted.
  This has the `project` string property.

Downstream systems can inspect these files to determine what changes have occurred in the **gypsum** bucket.
This is intended for applications maintaining a database index on top of the bucket's contents.
By routinely scanning the logs for changes, databases can incrementally update rather than reindexing the entire bucket.
In effect, the logs serve as a poor man's message queue.
Check out the [gypsum-metadata-index](https://github.com/ArtifactDB/gypsum-metadata-index) repository for an example -
this uses the **gypsum** logs to create and update SQLite files, though the same idea can be used for any database technology.

Log files are held for 7 days before deletion.

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

### Step 3: variables and secrets

Modify the indicated variables (denoted by `~>`) in [`wrangler.toml`](wrangler.toml).
Note that some of the variables need to be listed multiple times - this is unfortunate but necessary as `wrangler` does not automatically expose those variables to the worker's code.

Add the following secrets via `wrangler secret put`:

- `ACCESS_KEY_ID`, to allow the worker to write into the bucket.
  To generate:
  1. Click "Manage R2 API tokens" at the top-right corner of the R2 tab on the Cloudflare dashboard.
  2. Click "Create API Token".
  3. Select "Object Read & Write".
  4. Specify the token's scope to the name of the bucket you just set up.
     The TTL can be changed at your discretion.
  5. Copy the newly generated S3 client ID into the `wrangler` prompt.
- `SECRET_ACCESS_KEY`, for the secret associated with the `ACCESS_KEY_ID`.
- `PUBLIC_S3_KEY`, for public S3 access.
  To generate:
  1. Click "Manage R2 API tokens" at the top-right corner of the R2 tab on the Cloudflare dashboard.
  2. Click "Create API Token".
  3. Select "Object Read only".
  4. Specify the token's scope to the name bucket you just set up.
     The TTL can be changed at your discretion.
  5. Copy the newly generated S3 client ID into the `wrangler` prompt.
- `PUBLIC_S3_SECRET`, for the secret associated with the `PUBLIC_S3_KEY`.
- `GITHUB_APP_ID`, for the GitHub Oauth2 flow.
  To generate:
  1. Go to developer settings for a user/organization.
     Any account can be used here.
  2. Click on "Oauth apps".
  3. Click on "New Oauth App".
  4. Set the callback URL to `https://localhost:1410`. 
     The other fields can be filled in freely.
  5. Copy the newly generated client ID into the `wrangler` prompt.
- `GITHUB_APP_SECRET`, for the secret associated with the Github App ID.
  To generate, click on "Generate a new client secret" and copy the string into the `wrangler` prompt.

### Step 4: deployment

Run `wrangler publish` to deploy to Cloudflare Workers.
This will create an API at `https://<WORKER_NAME>.<ACCOUNT_NAME>.workers.dev`.
See [here](https://developers.cloudflare.com/workers/platform/environments) for instructions on publishing to a custom domain.

## Comments for administrators

Administrators have access to rather dangerous `DELETE` endpoints.
These violate **gypsum**'s immutability contract and should be used sparingly.
In particular, administrators must ensure that no other project links to the to-be-deleted files, otherwise those links will be invalidated.
This check involves going through all the manifest files and is currently a manual process.
Clients may also need to flush their caches if the `..summary` files corresponding to a deleted project cannot be found.

On rare occasions involving frequent updates, some of the inter-version statistics may not be correct.
For example, the latest version in `..latest` may not keep in sync when many probational versions are approved at once.
This can be fixed manually by hitting the `/refresh` endpoints to recompute the relevant statistics.
