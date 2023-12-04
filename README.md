# ArtifactDB on the Cloudflare stack

## Overview

**gypsum** uses Cloudflare Workers and R2 storage to provide a simple REST API for storing ArtifactDB-managed files grouped by project, asset and version.
Unlike the original ArtifactDB API, all files are intended to be publicly accessible for download, allowing us to simplify **gypsum**'s design.
A variety of permission schemes are implemented to allow project maintainers to control and approve uploads.

## Concepts

### File organization

Each project may have multiple assets, and each asset may have multiple versions.
All user-supplied files are associated with a particular project-asset-version combination.
This hierarchy is motivated by usage scenarios in Bioconductor packages;
each project corresponds to a single package, but different parts of the package may require different data assets, each of which may update at different frequencies.
Each version of an asset is immutable to ensure that downstream analyses are reproducible.

Within the R2 bucket, files associated with a project-asset-version combination will have a `{project}/{asset}/{version}/` prefix and can be retrieved accordingly.
For each project-asset-version combination, the set of all user-supplied files is recorded in the `{project}/{asset}/{version}/..manifest` file.
This contains a JSON object where each key/value pair describes a user-supplied file.
The key is a relative path that should be appended to the `{project}/{asset}/{version}/` prefix to obtain the full bucket path to the file.
The value is another object with the following properties:
- `size`: an integer specifying the size of the file in bytes.
- `md5sum`: a string containing the hex-encoded MD5 checksum of the file.
- `link` (optional): an object specifying the link destination for a file (see [below](#link-deduplication) for details).
  This contains the strings `project`, `asset`, `version` and `path`.

**gypsum** keeps track of the latest version of each asset in the `{project}/{asset}/..latest` file.
This contains a JSON object with the following properties:
- `latest`: String containing the name of the latest version of this asset.

For any given project-asset-version combination, the `{project}/{asset}/{version}/..summary` file records some more details about the upload process.
This contains a JSON object with the following properties:
- `upload_user_id`, a string containing the identity of the uploading user.
- `upload_start`, an Internet date/time-formatted string containing the upload start time.
- `upload_finish`, an Internet date/time-formatted string containing the upload finish time.
- `on_probation` (optional), a boolean indicating whether this upload is on probation, see [below](#upload-probation).
  If not present, this can be assumed to be `false`.

### Link deduplication

When creating a new version of a project's assets, **gypsum** can be instructed to attempt deduplication based on file size and MD5 checksum.
The API will inspect the immediate previous version of the asset to see if any other files have a matching size/checksum.
If so, it will create a link to the file in the previous version rather than uploading a redundant copy.
This improves efficiency by reducing storage and data transfer.
Uploaders can also directly instruct **gypsum** to create links if the original identity of the copied file is known in advance.

Any "linked-from" files (i.e., those identified as copies of other existing files) will not actually be present in the bucket. 
The existence of linked-from files is either determined from the `..manifest` file for each project-asset-version;
or from `..links` files, which avoid the need to download the entire manifest if only a subset of files are of interest.
To illustrate, consider a hypothetical link file at the following path:

```
{project}/{asset}/{version}/x/y/z/..links
```

This contains a JSON object where each key/value pair describes a linked-from path in the same subdirectory.
The key is a relative path, to be appended to `{project}/{asset}/{version}/x/y/z/` to obtain the full bucket path of the linked-from file.
The value is another object that contains the strings `project`, `asset`, `version` and `path`, which collectively specify the link destination.

If no link file is present at a particular file prefix, it can be assumed that there are no linked-from files with that prefix.

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
    If not specified, the uploader is trusted by default.

All users are authenticated by their GitHub personal access tokens.
Permissions can also be extended to GitHub organizations, in which case each user's organization membership will be checked be inspected.

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

**gypsum** stores its files in an R2 bucket that can be accessed by any S3-compatible client.
This does require a little bit more work, unfortunately, as Cloudflare's public buckets do not expose the S3 API.
Instead, we need to request some credentials from the API first:

```shell
curl https://gypsum-test.aaron-lun.workers.dev/credentials/s3-api
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
The token can then be passed to various API endpoints to authenticate the user for uploads.
Check out the [Swagger](https://artifactdb.github.io/gypsum-worker) documentation for more details.

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

- `ACCESS_KEY_ID`, for the access key ID.
  To generate:
  1. Click "Manage R2 API tokens" at the top-right corner of the R2 tab on the Cloudflare dashboard.
  2. Click "Create API Token".
  3. Select "Admin Read & Write".
  4. Specify the token's scope to the bucket you just set up.
     The TTL can be changed at your discretion.
- `SECRET_ACCESS_KEY`, for the secret associated with the access key ID.
- `PUBLIC_S3_KEY`, for public S3 access.
  To generate:
  1. Click "Manage R2 API tokens" at the top-right corner of the R2 tab on the Cloudflare dashboard.
  2. Click "Create API Token".
  3. Select "Object Read only".
  4. Specify the token's scope to the bucket you just set up.
     The TTL can be changed at your discretion.
- `PUBLIC_S3_SECRET`, for the secret associated with the public S3 access key ID.
- `GITHUB_APP_ID`, for the GitHub Oauth2 flow.
  To generate:
  1. Go to developer settings for a user/organization.
  2. Click on "Oauth apps".
  3. Click on "New Oauth App".
  4. Set the callback URL to `https://localhost:1410`. 
     The other fields can be filled in freely.
- `GITHUB_APP_SECRET`, for the secret associated with the Github App ID.

### Step 4: deployment

Run `wrangler publish` to deploy to Cloudflare Workers.
This will create an API at `https://<WORKER_NAME>.<ACCOUNT_NAME>.workers.dev`.
See [here](https://developers.cloudflare.com/workers/platform/environments) for instructions on publishing to a custom domain.
