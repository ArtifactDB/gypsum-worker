test("setPermissionsHandler works correctly", async () => {
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ read_access: "viewers" }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "test-private" };
        req.query = {};

        let nb = [];
        await utils.expectError(auth.setPermissionsHandler(req, nb), "user identity");

        // Adding the wrong credentials.
        req.headers.append("Authorization", "Bearer " + utils.mockTokenOther);
        await utils.expectError(auth.setPermissionsHandler(req, nb), "does not have write access");

        // Trying again.
        req.headers.set("Authorization", "Bearer " + utils.mockToken);
        let res = await auth.setPermissionsHandler(req, nb);
        expect(res.status).toBe(202);
    }

    // Checking that the update was propagated.
    {
        let req = new Request("http://localhost");
        req.params = { project: "test-private" };
        req.query = {};
        req.headers.append("Authorization", "Bearer " + utils.mockToken);

        let nb = [];
        let res = await auth.getPermissionsHandler(req, nb);
        expect(res.status).toBe(200);

        let body = await res.json();
        expect(body.read_access).toBe("viewers");
    }

    // Breaks correctly if project doesn't exist.
    {
        let req = new Request("http://localhost");
        req.params = { project: "test-foo" };
        req.query = {};
        req.headers.append("Authorization", "Bearer " + utils.mockToken);

        let nb = [];
        await utils.expectError(auth.getPermissionsHandler(req, nb), "does not exist");
    }

    // Breaks correctly if request body is invalid.
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ read_access: ["viewers"] }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "test-public" };
        req.query = {};
        req.headers.append("Authorization", "Bearer " + utils.mockToken);

        let nb = [];
        await utils.expectError(auth.setPermissionsHandler(req, nb), "invalid request body");
    }

    // Fails correctly if user is not authorized.
    {
        let req = new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ write_access: "none" }),
            headers: { "Content-Type": "application/json" }
        });
        req.params = { project: "test-private" };
        req.query = {};
        req.headers.append("Authorization", "Bearer " + utils.mockToken);

        let nb = [];
        let res = await auth.setPermissionsHandler(req, nb); // initial request works.
        expect(res.status).toBe(202);

        // Second request fais as ArtifactDB-bot is no longer authorized.
        await utils.expectError(auth.setPermissionsHandler(req, nb), "write access");
    }
})

