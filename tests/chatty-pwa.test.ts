import { describe, it, expect, beforeAll } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import ChattyAgent from "../duties/chatty.js";

// Same mock-API pattern as tests/chatty-proposal-card-ui.test.ts.
function mockApi(): { api: DutyAPI; routes: Map<string, (req: Request) => Response | Promise<Response>> } {
  const routes = new Map<string, (req: Request) => Response | Promise<Response>>();
  const api = {
    config: { getAI: () => ({ models: { default: "test-model" }, ollamaModel: "test-model" }) },
    db: { query: async () => [], execute: async () => {} },
    http: {
      registerRoute: (path: string, handler: (req: Request) => Response | Promise<Response>) => {
        routes.set(path, handler);
      },
    },
    events: { emit: () => {}, on: () => {}, off: () => {} },
    tools: { getSchemas: () => [] },
    plugins: { has: () => false },
  } as unknown as DutyAPI;
  return { api, routes };
}

describe("Chatty PWA install support", () => {
  let routes: Map<string, (req: Request) => Response | Promise<Response>>;

  beforeAll(() => {
    const m = mockApi();
    routes = m.routes;
    new ChattyAgent(m.api);
  });

  it("serves a valid web app manifest with start_url/scope pinned to /chat", async () => {
    const handler = routes.get("/chat/manifest.json");
    expect(handler).toBeDefined();
    const res = await handler!(new Request("http://localhost/chat/manifest.json"));
    expect(res.headers.get("Content-Type")).toContain("manifest+json");
    const manifest = await res.json();
    expect(manifest.start_url).toBe("/chat");
    expect(manifest.scope).toBe("/chat");
    expect(manifest.display).toBe("standalone");
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src).toBe("/chat/icon.svg");
    }
  });

  it("serves a service worker with a fetch listener (the actual install-prompt requirement)", async () => {
    const handler = routes.get("/chat/sw.js");
    expect(handler).toBeDefined();
    const res = await handler!(new Request("http://localhost/chat/sw.js"));
    expect(res.headers.get("Content-Type")).toContain("javascript");
    const body = await res.text();
    expect(body).toContain('addEventListener("fetch"');
    // Must actually compile as JS, not just look like it.
    expect(() => new Function(body)).not.toThrow();
  });

  it("serves a valid SVG icon", async () => {
    const handler = routes.get("/chat/icon.svg");
    expect(handler).toBeDefined();
    const res = await handler!(new Request("http://localhost/chat/icon.svg"));
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    const body = await res.text();
    expect(body).toContain("<svg");
    expect(body).toContain("</svg>");
  });

  it("/chat's <head> links the manifest and icon, and registers the service worker", async () => {
    const handler = routes.get("/chat");
    const html = await (await handler!(new Request("http://localhost/chat"))).text();
    expect(html).toContain('<link rel="manifest" href="/chat/manifest.json">');
    expect(html).toContain('<link rel="icon" href="/chat/icon.svg"');
    expect(html).toContain("navigator.serviceWorker.register('/chat/sw.js')");
  });
});
