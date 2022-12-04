# ArtifactDB on the Cloudflare stack

## Overview

**gypsum** uses Cloudflare Workers and R2 storage to provide a bare-bones deployment of an ArtifactDB API.
We use Cloudflare as it provides a generous free tier for both Worker activity and R2 storage space, which is often sufficient for casual use.
Pricing also seems fairly reasonable when scaling up for more demanding applications.

## Endpoint support

**gypsum** supports a subset of the [standard ArtifactDB endpoints](https://github.com/ArtifactDB/ArtifactDB-api-contract):

- [`GET /files/{id}`](https://github.com/ArtifactDB/ArtifactDB-api-contract#get-file-contents)
- [`GET /files/{id}/metadata`](https://github.com/ArtifactDB/ArtifactDB-api-contract#get-file-metadata)
- [`GET /projects/{project}/metadata`](https://github.com/ArtifactDB/ArtifactDB-api-contract#get-project-metadata)
- [`GET /projects/{project}/version/{version}/metadata`](https://github.com/ArtifactDB/ArtifactDB-api-contract#get-project-version-metadata)
- [`GET /projects/{project}/version/{version}/info`](https://github.com/ArtifactDB/ArtifactDB-api-contract#get-version-information)
- [`GET /projects/{project}/permissions`](https://github.com/ArtifactDB/ArtifactDB-api-contract#get-project-permissions)
- [`GET /projects`](https://github.com/ArtifactDB/ArtifactDB-api-contract#list-projects)
- [`GET /projects/{project}/versions`](https://github.com/ArtifactDB/ArtifactDB-api-contract#list-project-versions)
- [`PUT /projects/{project}/permissions`](https://github.com/ArtifactDB/ArtifactDB-api-contract#set-project-permissions)
  - Only `"scope": "project"` is supported.
- [`POST /projects/{id}/version/{version}/upload`](https://github.com/ArtifactDb/ArtifactDB-api-contract#start-version-upload)
- [`PUT /projects/{id}/version/{version}/complete`](https://github.com/ArtifactDb/ArtifactDB-api-contract#complete-version-upload)
- [`PUT /projects/{id}/version/{version}/abort`](https://github.com/ArtifactDb/ArtifactDB-api-contract#abort-version-upload)
- [`GET /jobs/{jobid}`](https://github.com/ArtifactDB/ArtifactDB-api-contract#get-post-upload-job-status)

The most obvious omission is the unavailability of search endpoints, as we currently can't host a search index inside the Cloudflare ecosystem.

## Deployment instructions

### Step 1: Cloudflare 

Register for a [Cloudflare account](https://cloudflare.com) if you don't already have one.

Go to the "R2" tab on the sidebar and follow the instructions to set up a R2 bucket.
This will require some credit card details, but for casual use, you are unlikely to incur charges.

### Step 2: local environment

Fork this repository and clone it into your local environment. 

Follow [these](https://developers.cloudflare.com/workers/wrangler/get-started/) instructions to install the `wrangler` tool.

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
  This should have `repo:public` permissions.

### Step 5: deployment

Run `wrangler publish` to deploy to Cloudflare Workers.
This will create an API at `https://<WORKER_NAME>.<ACCOUNT_NAME>.workers.dev`.
See [here](https://developers.cloudflare.com/workers/platform/environments) for instructions on publishing to a custom domain.

## Maintainer notes

We use the request schemas from the [**ArtifactDB-api-contract**](https://github.com/ArtifactDB/ArtifactDB-api-contract) repository to validate non-trivial request bodies.
These are pre-compiled by [**ajv**](https://ajv.js.org) to produce [`src/validators.js`](src/validators.js) for direct use in the worker;
we can update this file by simply running the [`create_validators.js`](create_validators.js) script.
