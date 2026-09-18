import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DutyAPI } from "@ronin/types/index.js";
import { runArtifactMigrations } from "../src/artifacts/migrations.js";
import ChattyAgent from "../duties/chatty.js";

function localReq(url: string, init: RequestInit = {}): Request {
  return new Request(url, { ...init, headers: { ...init.headers, Host: "localhost" } });
}

function createMockAPI(dataDir: string): { api: DutyAPI; routes: Map<string, (req: Request) => Response | Promise<Response>> } {
  const Database = require("bun:sqlite").Database;
  const db = new Database(":memory:");
  const routes = new Map<string, (req: Request) => Response | Promise<Response>>();

  const api = {
    config: {
      getAI: () => ({ models: { default: "test-model" }, ollamaModel: "test-model", provider: "ollama" }),
      getSystem: () => ({ dataDir }),
    },
    db: {
      query: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        return params && params.length > 0 ? stmt.all(...params) : stmt.all();
      },
      execute: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        return params && params.length > 0 ? stmt.run(...params) : stmt.run();
      },
    },
    http: { registerRoute: (path: string, handler: (req: Request) => Response | Promise<Response>) => routes.set(path, handler) },
    events: { emit: () => {}, on: () => {}, off: () => {} },
    tools: { getSchemas: () => [] },
    plugins: { has: () => false },
  } as unknown as DutyAPI;

  return { api, routes, rawDb: db } as any;
}

describe("/api/chat/artifact/* routes", () => {
  let scratchDir: string;

  afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  });

  it("save: creates a new artifact on first save and returns a working download url", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-chat-artifact-"));
    const { api, routes } = createMockAPI(scratchDir);
    await runArtifactMigrations((api as any).db);
    new ChattyAgent(api);

    const res = await routes.get("/api/chat/artifact/save")!(localReq("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "hello.js", content: "console.log('hi');" }),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.artifactId).toBeTruthy();
    expect(body.storedPath).toBe("hello.js");
    expect(body.url).toBe(`/api/artifact/${body.artifactId}/asset/hello.js`);

    // The asset route it just registered should actually serve the bytes.
    const assetRoute = routes.get(body.url);
    expect(assetRoute).toBeDefined();
    const assetRes = await assetRoute!(localReq("http://localhost" + body.url));
    expect(await assetRes.text()).toBe("console.log('hi');");
  });

  it("save: reuses the same artifact when artifactId is passed, appending a second asset", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-chat-artifact-"));
    const { api, routes } = createMockAPI(scratchDir);
    await runArtifactMigrations((api as any).db);
    new ChattyAgent(api);
    const saveHandler = routes.get("/api/chat/artifact/save")!;

    const first = await (await saveHandler(localReq("http://localhost/x", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "a.js", content: "one" }),
    }))).json();

    const second = await (await saveHandler(localReq("http://localhost/x", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "b.js", content: "two", artifactId: first.artifactId }),
    }))).json();

    expect(second.artifactId).toBe(first.artifactId);

    const loadHandler = routes.get("/api/chat/artifact/load")!;
    const loaded = await (await loadHandler(localReq(`http://localhost/x?id=${first.artifactId}`))).json();
    expect(loaded.files.length).toBe(2);
    expect(loaded.files.map((f: any) => f.filename).sort()).toEqual(["a.js", "b.js"]);
  });

  it("save: dedupes a filename collision within the same artifact by suffixing", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-chat-artifact-"));
    const { api, routes } = createMockAPI(scratchDir);
    await runArtifactMigrations((api as any).db);
    new ChattyAgent(api);
    const saveHandler = routes.get("/api/chat/artifact/save")!;

    const first = await (await saveHandler(localReq("http://localhost/x", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "dup.js", content: "one" }),
    }))).json();
    const second = await (await saveHandler(localReq("http://localhost/x", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "dup.js", content: "two", artifactId: first.artifactId }),
    }))).json();

    expect(second.storedPath).not.toBe(first.storedPath);
    expect(second.storedPath).toBe("dup-1.js");
  });

  it("save: 400 when filename or content is missing", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-chat-artifact-"));
    const { api, routes } = createMockAPI(scratchDir);
    await runArtifactMigrations((api as any).db);
    new ChattyAgent(api);
    const res = await routes.get("/api/chat/artifact/save")!(localReq("http://localhost/x", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "x.js" }),
    }));
    expect(res.status).toBe(400);
  });

  it("library: lists artifacts created via save", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-chat-artifact-"));
    const { api, routes } = createMockAPI(scratchDir);
    await runArtifactMigrations((api as any).db);
    new ChattyAgent(api);

    await routes.get("/api/chat/artifact/save")!(localReq("http://localhost/x", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "x.py", content: "print(1)" }),
    }));

    const res = await routes.get("/api/chat/artifact/library")!(localReq("http://localhost/x"));
    const body = await res.json();
    expect(body.artifacts.length).toBe(1);
    expect(body.artifacts[0].name).toBe("Chat Session Files");
  });

  it("load: inlines text content for code files and 404s for an unknown id", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-chat-artifact-"));
    const { api, routes } = createMockAPI(scratchDir);
    await runArtifactMigrations((api as any).db);
    new ChattyAgent(api);

    const saved = await (await routes.get("/api/chat/artifact/save")!(localReq("http://localhost/x", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "readme.md", content: "# hi" }),
    }))).json();

    const loadRes = await routes.get("/api/chat/artifact/load")!(localReq(`http://localhost/x?id=${saved.artifactId}`));
    const loaded = await loadRes.json();
    expect(loaded.success).toBe(true);
    expect(loaded.files[0].content).toBe("# hi");

    const missingRes = await routes.get("/api/chat/artifact/load")!(localReq("http://localhost/x?id=does-not-exist"));
    expect(missingRes.status).toBe(404);
  });

  it("all three routes require the remote token for non-local requests", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-chat-artifact-"));
    const { api, routes } = createMockAPI(scratchDir);
    await runArtifactMigrations((api as any).db);
    new ChattyAgent(api);
    process.env.CLOUDFLARE_ROUTE_TOKEN = "secret";
    try {
      const remoteReq = new Request("http://random.trycloudflare.com/x", { headers: { Host: "random.trycloudflare.com" } });
      expect((await routes.get("/api/chat/artifact/library")!(remoteReq)).status).toBe(401);
      expect((await routes.get("/api/chat/artifact/load")!(remoteReq)).status).toBe(401);
      expect((await routes.get("/api/chat/artifact/save")!(remoteReq)).status).toBe(401);
    } finally {
      delete process.env.CLOUDFLARE_ROUTE_TOKEN;
    }
  });
});
