import { describe, it, expect, afterEach } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import ConfigEditorAgent from "../duties/config-editor.js";

function createMockAPI(ollamaUrl = "http://localhost:11434"): { api: DutyAPI; routes: Map<string, (req: Request) => Response | Promise<Response>> } {
  const routes = new Map<string, (req: Request) => Response | Promise<Response>>();
  const api = {
    config: {
      getAll: () => ({}),
      getAI: () => ({ provider: "ollama", ollamaUrl, models: {} }),
      getSystem: () => ({ dataDir: "/tmp" }),
      getConfigEditor: () => ({ password: undefined }),
    },
    http: { registerRoute: (path: string, handler: (req: Request) => Response | Promise<Response>) => routes.set(path, handler) },
    events: { emit: () => {}, on: () => {}, off: () => {} },
  } as unknown as DutyAPI;
  new ConfigEditorAgent(api);
  return { api, routes };
}

describe("GET /config/api/ollama-models", () => {
  let originalFetch: typeof fetch;
  afterEach(() => { if (originalFetch) globalThis.fetch = originalFetch; });

  it("returns the model name list from a reachable Ollama instance", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      models: [{ name: "llama3.1:8b" }, { name: "granite3.2-16k" }],
    }), { status: 200 })) as typeof fetch;

    const { routes } = createMockAPI();
    const res = await routes.get("/config/api/ollama-models")!(new Request("http://localhost/x"));
    const body = await res.json();
    expect(body.models).toEqual(["llama3.1:8b", "granite3.2-16k"]);
  });

  it("returns an empty list (not an error) when Ollama is unreachable", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("connection refused"); }) as typeof fetch;

    const { routes } = createMockAPI();
    const res = await routes.get("/config/api/ollama-models")!(new Request("http://localhost/x"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.models).toEqual([]);
  });

  it("returns an empty list when Ollama responds but with a non-OK status", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;

    const { routes } = createMockAPI();
    const res = await routes.get("/config/api/ollama-models")!(new Request("http://localhost/x"));
    const body = await res.json();
    expect(body.models).toEqual([]);
  });
});

describe("Config editor AI section schema (served via /config/api/schema)", () => {
  it("provider options include anthropic and lmstudio (previously missing)", async () => {
    const { routes } = createMockAPI();
    const res = await routes.get("/config/api/schema")!(new Request("http://localhost/x"));
    const schema = await res.json();
    expect(schema.ai.fields.provider.options).toContain("anthropic");
    expect(schema.ai.fields.provider.options).toContain("lmstudio");
  });

  it("model slot fields (default/fast/smart/vision) are select-type with optgroups, not free-text", async () => {
    const { routes } = createMockAPI();
    const res = await routes.get("/config/api/schema")!(new Request("http://localhost/x"));
    const schema = await res.json();
    const modelFields = schema.ai.fields.models.fields;
    for (const slot of ["default", "fast", "smart", "vision"]) {
      expect(modelFields[slot].type).toBe("select");
      expect(Array.isArray(modelFields[slot].optgroups)).toBe(true);
      expect(modelFields[slot].optgroups.length).toBeGreaterThan(0);
    }
    // embedding stays a plain string — no curated model list for it.
    expect(modelFields.embedding.type).toBe("string");
  });
});
