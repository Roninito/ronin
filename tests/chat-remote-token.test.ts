import { describe, it, expect, afterEach } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import ChattyAgent from "../duties/chatty.js";

function createMockAPI(): { api: DutyAPI; routes: Map<string, (req: Request) => Response | Promise<Response>> } {
  const routes = new Map<string, (req: Request) => Response | Promise<Response>>();
  const api = {
    config: { getAI: () => ({ models: { default: "test-model" }, ollamaModel: "test-model" }) },
    db: { query: async () => [], execute: async () => {} },
    http: { registerRoute: (path: string, handler: (req: Request) => Response | Promise<Response>) => routes.set(path, handler) },
    events: { emit: () => {}, on: () => {}, off: () => {} },
    tools: { getSchemas: () => [], execute: async () => ({ success: true }) },
    plugins: { has: () => false, call: async () => ({ text: "" }) },
  } as unknown as DutyAPI;

  new ChattyAgent(api);
  return { api, routes };
}

function localReq(url: string, init: RequestInit = {}): Request {
  return new Request(url, { ...init, headers: { ...init.headers, Host: "localhost" } });
}

function remoteReq(url: string, init: RequestInit = {}): Request {
  return new Request(url, { ...init, headers: { ...init.headers, Host: "random.trycloudflare.com" } });
}

describe("Remote-access token gate on /chat routes", () => {
  const originalEnv = process.env.CLOUDFLARE_ROUTE_TOKEN;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.CLOUDFLARE_ROUTE_TOKEN;
    else process.env.CLOUDFLARE_ROUTE_TOKEN = originalEnv;
  });

  it("a local request reaches /chat with no token at all", async () => {
    const { routes } = createMockAPI();
    const res = await routes.get("/chat")!(localReq("http://localhost/chat"));
    expect(res.status).toBe(200);
  });

  it("a remote request with no token is rejected with 401", async () => {
    process.env.CLOUDFLARE_ROUTE_TOKEN = "secret123";
    const { routes } = createMockAPI();
    const res = await routes.get("/chat")!(remoteReq("http://random.trycloudflare.com/chat"));
    expect(res.status).toBe(401);
  });

  it("a remote request with the correct ?token= query param is let through", async () => {
    process.env.CLOUDFLARE_ROUTE_TOKEN = "secret123";
    const { routes } = createMockAPI();
    const res = await routes.get("/chat")!(remoteReq("http://random.trycloudflare.com/chat?token=secret123"));
    expect(res.status).toBe(200);
  });

  it("a remote request with the correct Authorization header is let through on /api/chats", async () => {
    process.env.CLOUDFLARE_ROUTE_TOKEN = "secret123";
    const { routes } = createMockAPI();
    const res = await routes.get("/api/chats")!(
      remoteReq("http://random.trycloudflare.com/api/chats", { headers: { Authorization: "Bearer secret123" } }),
    );
    expect(res.status).toBe(200);
  });

  it("a remote request with the wrong token is rejected on /api/chat/speak", async () => {
    process.env.CLOUDFLARE_ROUTE_TOKEN = "secret123";
    const { routes } = createMockAPI();
    const res = await routes.get("/api/chat/speak")!(
      remoteReq("http://random.trycloudflare.com/api/chat/speak", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-token" },
      }),
    );
    expect(res.status).toBe(401);
  });
});
