import { describe, it, expect } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import ChattyAgent from "../duties/chatty.js";

function localReq(url: string, init: RequestInit = {}): Request {
  return new Request(url, { ...init, headers: { ...init.headers, Host: "localhost" } });
}

function createMockAPI(options: {
  hasStt?: boolean;
  sttCall?: (method: string, args: unknown[]) => Promise<unknown>;
  toolsExecute?: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; error?: string | null }>;
}): { api: DutyAPI; routes: Map<string, (req: Request) => Response | Promise<Response>> } {
  const routes = new Map<string, (req: Request) => Response | Promise<Response>>();

  const api = {
    config: {
      getAI: () => ({ models: { default: "test-model" }, ollamaModel: "test-model" }),
    },
    db: {
      query: async () => [],
      execute: async () => {},
    },
    http: {
      registerRoute: (path: string, handler: (req: Request) => Response | Promise<Response>) => {
        routes.set(path, handler);
      },
    },
    events: { emit: () => {}, on: () => {}, off: () => {} },
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
  } as unknown as DutyAPI;

  new ChattyAgent(api);
  return { api, routes };
}

describe("POST /api/chat/transcribe", () => {
  it("returns 503 when the stt plugin isn't loaded", async () => {
    const { routes } = createMockAPI({ hasStt: false });
    const handler = routes.get("/api/chat/transcribe")!;
    const res = await handler(localReq("http://localhost/x", { method: "POST", body: new Uint8Array([1, 2, 3]) }));
    expect(res.status).toBe(503);
  });

  it("returns 400 for an empty audio body", async () => {
    const { routes } = createMockAPI({});
    const handler = routes.get("/api/chat/transcribe")!;
    const res = await handler(localReq("http://localhost/x", { method: "POST", body: new Uint8Array([]) }));
    expect(res.status).toBe(400);
  });

  it("rejects non-POST requests", async () => {
    const { routes } = createMockAPI({});
    const handler = routes.get("/api/chat/transcribe")!;
    const res = await handler(localReq("http://localhost/x", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("returns 500 with a clear error when ffmpeg conversion fails (e.g. not installed)", async () => {
    // Real end-to-end call with garbage audio bytes — ffmpeg (or its absence)
    // will reject this, exercising the actual conversion failure path rather
    // than a mocked one.
    const { routes } = createMockAPI({});
    const handler = routes.get("/api/chat/transcribe")!;
    const res = await handler(localReq("http://localhost/x", { method: "POST", body: new Uint8Array([1, 2, 3, 4, 5]) }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});

describe("POST /api/chat/speak", () => {
  it("rejects non-POST requests", async () => {
    const { routes } = createMockAPI({});
    const handler = routes.get("/api/chat/speak")!;
    const res = await handler(localReq("http://localhost/x", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("returns 400 for missing/empty text", async () => {
    const { routes } = createMockAPI({});
    const handler = routes.get("/api/chat/speak")!;
    const res = await handler(localReq("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "  " }),
    }));
    expect(res.status).toBe(400);
  });

  it("delegates to the local.speech.say tool with the given text", async () => {
    let calledWith: unknown;
    const { routes } = createMockAPI({
      toolsExecute: async (name, args) => {
        calledWith = { name, args };
        return { success: true };
      },
    });
    const handler = routes.get("/api/chat/speak")!;
    const res = await handler(localReq("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello there" }),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(calledWith).toEqual({ name: "local.speech.say", args: { text: "hello there" } });
  });

  it("surfaces a tool failure without throwing", async () => {
    const { routes } = createMockAPI({
      toolsExecute: async () => ({ success: false, error: "No TTS backend available." }),
    });
    const handler = routes.get("/api/chat/speak")!;
    const res = await handler(localReq("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("No TTS backend available.");
  });
});
