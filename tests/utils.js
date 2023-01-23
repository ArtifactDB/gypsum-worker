export const mockToken = "gh_auth_mock_token_for_ArtifactDB-bot";
export const mockTokenOther = "gh_auth_mock_token_for_SomeoneElse";
export const mockTokenAaron = "gh_auth_mock_token_for_LTLA";

export function mockGitHubIdentities(rigging) {
    rigging.identifyUser[mockToken] = { login: "ArtifactDB-bot" };
    rigging.identifyUserOrgs[mockToken] = [];
    rigging.identifyUser[mockTokenOther] = { login: "SomeoneElse" };
    rigging.identifyUserOrgs[mockTokenOther] = [ "FOO", "BAR" ];
    rigging.identifyUser[mockTokenAaron] = { login: "LTLA" };
    rigging.identifyUserOrgs[mockTokenAaron] = [];
    return;
}

export const testauth = ("BOT_TEST_TOKEN" in process.env ? test : test.skip);

export function fetchTestPAT() {
    return process.env.BOT_TEST_TOKEN;
}

// Providing our own checks for errors, as sometimes toThrow doesn't work. It
// seems like the mocked-up R2 bucket somehow gets reset by Jest, and any extra
// files that were added will not show up in the test. So we force it to run in
// the same thread and context by using a simple try/catch block.
export async function expectError(promise, message) {
    try {
        await promise;
        throw new Error("didn't throw");
    } catch (e){
        expect(e.message).toMatch(message);
    }
}
