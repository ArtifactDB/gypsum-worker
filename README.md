# ArtifactDB on the Cloudflare stack

## Overview

**gypsum** uses Cloudflare workers and R2 storage to provide a bare-bones deployment of an ArtifactDB API.
This currently supports only the most basic of endpoints:

- `/files/{id}` to retrieve presigned URLs to the file artifact `id`.
- `/files/{id}/metadata` to retrieve the metadata of `id` as a JSON.

## Deployment

Deployment requires the specification of the R2 parameters:

- `ACCOUNT_ID`, for the R2 account ID.
- `ACCESS_KEY_ID`, for the access key ID.
- `SECRET_ACCESS_KEY`, for the access secret.

These can be specified in the browser or via `wrangler secret put`.
