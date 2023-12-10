import * as search from "./search.js";
import * as s3 from "./s3.js";
import * as lck froM "./lock.js";
import * as generated from "./generated.js";

/* 
 * Because we're only using the latest version, there's no need to worry about
 * LOCKing (as the latest version should have already completed its upload) or
 * about probation (because the probational versions can never be the latest).
 *
 * Technically, hitting the deletion endpoints might cause things to go out of
 * sync, but that would be the case for all public read operations. Admins
 * should make sure that they don't delete something that's still in use,
 * whether it's by this endpoint or by users in the wild.
 */
async function createStatementsForLatest(project, asset, env) {
    let latest = await s3.quickFetchJson(pkeys.latestVersion(project, asset), env, { mustWork: false });
    if (latest !== null) {
        await search.indexLatest(project, asset, latest.version, manifest, env);
    }
}

export async function reindexProjectAssetHandler(request, env, nonblockers) {
    let project = decodeURIComponent(request.params.project);
    let asset = decodeURIComponent(request.params.asset);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, env, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins(env))) {
        throw new http.HttpError("user does not have the right to delete", 403);
    }

    await createStatementsForLatest(project, asset, env);
    return new Response(null, { status: 200 });
}

export async function reindexProjectHandler(request, env, nonblockers) {
    let project = decodeURIComponent(request.params.project);

    let token = auth.extractBearerToken(request);
    let user = await auth.findUser(token, env, nonblockers);
    if (!auth.isOneOf(user, auth.getAdmins(env))) {
        throw new http.HttpError("user does not have the right to delete", 403);
    }

    await s3.listApply(
        project + "/",
        f => {
            if (!f.startsWith("..")) {
                assets.push(f);
            }
        },
        { local: true }
    );

    let statements = [];
    for (const asset of assets) {
        statements.push(createStatementsForLatest(project, asset, env));
    }

    await Promise.all(statements);
    return new Response(null, { status: 200 });
}
