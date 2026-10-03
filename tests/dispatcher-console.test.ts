import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { DutyAPI } from "../src/types/index.js";
import DispatcherConsoleDuty from "../duties/dispatcher-console.js";

function localReq(url: string, init: RequestInit = {}): Request {
  return new Request(url, { ...init, headers: { ...init.headers, Host: "localhost" } });
}

function createMockAPI(options: {
  hasStt?: boolean;
  sttCall?: (method: string, args: unknown[]) => Promise<unknown>;
  toolsExecute?: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; error?: string | null }>;
  callTools?: () => Promise<{ message: { content: string }; toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> }>;
}): { api: DutyAPI; routes: Map<string, (req: Request) => Response | Promise<Response>> } {
  const routes = new Map<string, (req: Request) => Response | Promise<Response>>();

  const api = {
    config: {
      getAll: () => ({}),
      set: async () => {},
    },
    ai: {
      callTools: options.callTools ?? (async () => ({ message: { content: "" }, toolCalls: [] })),
    },
    tools: {
      getSchemas: () => [],
      execute: options.toolsExecute ?? (async () => ({ success: true })),
    },
    plugins: {
      has: (name: string) => (name === "stt" ? (options.hasStt ?? true) : false),
      call: async (_pluginName: string, method: string, ...args: unknown[]) => {
        if (options.sttCall) return options.sttCall(method, args);
        return { text: "" };
      },
    },
    http: {
      registerRoute: (path: string, handler: (req: Request) => Response | Promise<Response>) => {
        routes.set(path, handler);
      },
    },
    events: { emit: () => {}, on: () => {}, off: () => {} },
  } as unknown as DutyAPI;

  new DispatcherConsoleDuty(api);
  return { api, routes };
}

const ROLLUP = {
  projects: [
    { id: "p1", paused: false, agents: [], tasks: [], review: [], questions: [], blocked: [], jobs: [], spend: {} },
  ],
};
const HEALTH = { ok: true, home: "h", pid: 123, projects: 1 };

describe("dispatcher-console routes", () => {
  const realFetch = globalThis.fetch;
  const realEnv = { ...process.env };
  let fetchUrls: string[];

  beforeEach(() => {
    fetchUrls = [];
    globalThis.fetch = (async (url: string) => {
      fetchUrls.push(String(url));
      if (String(url).endsWith("/dispatcher")) return Response.json(ROLLUP);
      if (String(url).endsWith("/health")) return Response.json(HEALTH);
      return Response.json({});
    }) as unknown as typeof fetch;
    process.env.CREW_TOKEN = "test-token";
    process.env.CREW_BASE_URL = "http://127.0.0.1:7717";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it("registers the console page and all four API routes", () => {
    const { routes } = createMockAPI({});
    for (const path of ["/dispatcher", "/api/dispatcher/status", "/api/dispatcher/ask", "/api/dispatcher/transcribe", "/api/dispatcher/speak"]) {
      expect(routes.has(path)).toBe(true);
    }
  });

  it("serves an HTML console page with the mic flow and status sections", async () => {
    const { routes } = createMockAPI({});
    const res = await routes.get("/dispatcher")!(localReq("http://localhost/dispatcher"));
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Dispatcher Console");
    expect(html).toContain("mic-button");
    expect(html).toContain("/api/dispatcher/transcribe");
    expect(html).toContain("/api/dispatcher/ask");
  });

  it("GET /api/dispatcher/status returns crew health + projects read-only", async () => {
    const { routes } = createMockAPI({});
    const res = await routes.get("/api/dispatcher/status")!(localReq("http://localhost/x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.health.pid).toBe(123);
    expect(body.projects).toHaveLength(1);
    expect(fetchUrls.every((u) => !u.endsWith("/cmd"))).toBe(true);
  });

  it("GET /api/dispatcher/status returns 502 with a clear error when crew is down", async () => {
    globalThis.fetch = (async () => { throw new Error("Connection refused"); }) as unknown as typeof fetch;
    const { routes } = createMockAPI({});
    const res = await routes.get("/api/dispatcher/status")!(localReq("http://localhost/x"));
    expect(res.status).toBe(502);
    expect(typeof (await res.json()).error).toBe("string");
  });

  it("POST /api/dispatcher/ask answers over live state and never executes proposals", async () => {
    const { routes } = createMockAPI({
      callTools: async () => ({
        message: { content: "worker looks idle" },
        toolCalls: [{ name: "crew_wake", arguments: { project: "p1", agent: "worker", reason: "idle" } }],
      }),
    });
    const res = await routes.get("/api/dispatcher/ask")!(
      localReq("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "what needs attention?" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe("worker looks idle");
    expect(body.proposedActions).toHaveLength(1);
    // Read-only proof: ask may sense crew but must never POST /cmd.
    expect(fetchUrls.every((u) => !u.endsWith("/cmd"))).toBe(true);
  });

  it("POST /api/dispatcher/ask returns 400 for missing/empty text", async () => {
    const { routes } = createMockAPI({});
    const res = await routes.get("/api/dispatcher/ask")!(
      localReq("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "  " }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/dispatcher/transcribe returns 503 when the stt plugin isn't loaded", async () => {
    const { routes } = createMockAPI({ hasStt: false });
    const res = await routes.get("/api/dispatcher/transcribe")!(
      localReq("http://localhost/x", { method: "POST", body: new Uint8Array([1, 2, 3]) }),
    );
    expect(res.status).toBe(503);
  });

  it("POST /api/dispatcher/transcribe returns 400 for an empty audio body", async () => {
    const { routes } = createMockAPI({});
    const res = await routes.get("/api/dispatcher/transcribe")!(
      localReq("http://localhost/x", { method: "POST", body: new Uint8Array([]) }),
    );
    expect(res.status).toBe(400);
  });

  it("POST /api/dispatcher/speak delegates to local.speech.say", async () => {
    let calledWith: unknown;
    const { routes } = createMockAPI({
      toolsExecute: async (name, args) => {
        calledWith = { name, args };
        return { success: true };
      },
    });
    const res = await routes.get("/api/dispatcher/speak")!(
      localReq("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello there" }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(calledWith).toEqual({ name: "local.speech.say", args: { text: "hello there" } });
  });
});
