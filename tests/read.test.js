import * as read from "../src/read.js";
import * as setup from "./setup.js";

beforeAll(async () => {
    const env = getMiniflareBindings();
    await setup.simpleMockProject(env);
})

test("headFileHandler works correctly", async () => {
    const env = getMiniflareBindings();
    const req = new Request("http://localhost", { method: "HEAD" });

    {
        req.params = { key: "test/blob/v1/whee.txt" };
        const res = await read.headFileHandler(req, env, []);
        expect(res.body).toBeNull();
        const hh = res.headers;
        expect(hh.get("Last-Modified").length).toBeGreaterThan(0);
        expect(hh.get("etag").length).toBeGreaterThan(0);
        expect(Number(hh.get("Content-Length"))).toBeGreaterThan(0);
    }

    {
        req.params = { key: "test/blob/v1/..summary" };
        const res = await read.headFileHandler(req, env, []);
        expect(res.body).toBeNull();
        const hh = res.headers;
        expect(hh.get("content-type")).toBe("application/json");
    }
})

test("downloadFileHandler works correctly", async () => {
    const env = getMiniflareBindings();
    const req = new Request("http://localhost", { method: "GET" });

    {
        req.params = { key: "test/blob/v1/whee.txt" };
        const res = await read.downloadFileHandler(req, env, []);
        const body = await res.text();
        expect(body.startsWith("Aaron")).toBe(true);

        const hh = res.headers;
        expect(hh.get("Last-Modified").length).toBeGreaterThan(0);
        expect(hh.get("etag").length).toBeGreaterThan(0);
        expect(Number(hh.get("Content-Length"))).toBeGreaterThan(0);
    }

    {
        req.params = { key: "test/blob/v1/..summary" };
        const res = await read.downloadFileHandler(req, env, []);
        const body = await res.json();
        expect("upload_user_id" in body).toBe(true);

        const hh = res.headers;
        expect(hh.get("content-type")).toBe("application/json");
    }

    {
        req.params = { key: "test/blob/v1/foo/bar.txt" };
        const res = await read.downloadFileHandler(req, env, []);
        const body = await res.text();
        expect(body.startsWith("1\n")).toBe(true);
    }

    {
        req.params = { key: "test/blob/v1/absent.txt" };
        await expect(read.downloadFileHandler(req, env, [])).rejects.toThrow("not found");
    }
})

test("listFilesHandler works correctly", async () => {
    const env = getMiniflareBindings();
    const req = new Request("http://localhost", { method: "GET" });

    {
        req.query = {};
        const res = await read.listFilesHandler(req, env, []);
        const body = await res.json();
        expect(body.indexOf("test/") >= 0).toBe(true);
    }

    {
        req.query = { prefix: "test/blob" };
        const res = await read.listFilesHandler(req, env, []);
        const body = await res.json();
        expect(body.indexOf("test/blob/") >= 0).toBe(true);
    }

    {
        req.query = { prefix: "test/blob/" };
        const res = await read.listFilesHandler(req, env, []);
        const body = await res.json();
        expect(body.indexOf("test/blob/..latest") >= 0).toBe(true);
        expect(body.indexOf("test/blob/v1/") >= 0).toBe(true);
    }

    {
        req.query = { prefix: "test/blob", recursive: "true" };
        const res = await read.listFilesHandler(req, env, []);
        const body = await res.json();
        expect(body.indexOf("test/blob/v1/..summary") >= 0).toBe(true);
        expect(body.indexOf("test/blob/v1/foo/bar.txt") >= 0).toBe(true);
        expect(body.indexOf("test/..permissions") == -1).toBe(true);
    }
})
