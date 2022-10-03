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
- `GET /projects/{project}/version/{version}/info`
- [`GET /projects/{project}/permissions`](https://github.com/ArtifactDB/ArtifactDB-api-contract#get-project-permissions)
- `GET /projects`
- `GET /projects/{project}/versions`
- `PUT /projects/{project}/permissions`
  - Only `"scope": "project"` is supported.
- `PUT /link/{source}/to/{target}`
- `POST /projects/{id}/version/{version}/upload` 
- `PUT /projects/{id}/version/{version}/complete`
- `PUT /projects/{id}/version/{version}/abort`
- `GET /jobs/{jobid}`

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

Add the following secrets via `wrangler secret put`:

- `ACCOUNT_ID`, for the R2 account ID (32-character string at the top-right corner of the R2 tab on the Cloudflare dashboard).
- `ACCESS_KEY_ID`, for the access key ID (click "manage API tokens" at the top-right corner of the R2 tab on the Cloudflare dashboard).
- `SECRET_ACCESS_KEY`, for the access secret associated with the access key ID.
- `GITHUB_PAT`, for the GitHub personal access token of the CI/CD user account. 
  This should have `repo:public` permissions.

### Step 5: deployment

Run `wrangler publish` to deploy to Cloudflare Workers.
This will create an API at `https://<WORKER_NAME>.<ACCOUNT_NAME>.workers.dev`.
See [here](https://developers.cloudflare.com/workers/platform/environments) for instructions on publishing to a custom domain.
