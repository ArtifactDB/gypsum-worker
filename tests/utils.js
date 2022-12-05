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
