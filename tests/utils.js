export const testauth = ("GITHUB_TEST_TOKEN" in process.env ? test : test.skip);

export function fetchTestPAT() {
    return process.env.GITHUB_TEST_TOKEN;
}
