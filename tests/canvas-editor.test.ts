import { describe, it, expect } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import { HTTPAPI } from "../src/api/http.js";
import CanvasEditorDuty from "../duties/canvas-editor.js";

describe("HTTPAPI WebSocket registration", () => {
  it("registers and retrieves WebSocket handlers by path", () => {
    const http = new HTTPAPI();
    const handlers = { open: () => {}, message: () => {}, close: () => {} };
    http.registerWebSocket("/canvas/ws", handlers);

    expect(http.getWebSocketPaths().has("/canvas/ws")).toBe(true);
    expect(http.getWebSocketHandlers("/canvas/ws")).toBe(handlers);
    expect(http.getWebSocketHandlers("/nope")).toBeUndefined();
  });
});

describe("CanvasEditorDuty — /canvas route", () => {
  it("registers /canvas and a WebSocket endpoint, and serves a valid Cytoscape.js page", async () => {
    const routes = new Map<string, (req: Request) => Response | Promise<Response>>();
    const http = new HTTPAPI();

    const api = {
      http: {
        registerRoute: (path: string, handler: any, metadata?: any) => {
          routes.set(path, handler);
          http.registerRoute(path, handler, metadata);
        },
        registerWebSocket: http.registerWebSocket.bind(http),
        getWebSocketPaths: http.getWebSocketPaths.bind(http),
        getWebSocketHandlers: http.getWebSocketHandlers.bind(http),
      },
      events: { emit: () => {}, on: () => {}, off: () => {}, beam: () => {}, query: async () => undefined, reply: () => {}, getRegisteredEvents: () => [] },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    } as unknown as DutyAPI;

    new CanvasEditorDuty(api);

    expect(http.getWebSocketPaths().has("/canvas/ws")).toBe(true);

    const handler = routes.get("/canvas");
    expect(handler).toBeDefined();
    const res = await handler!(new Request("http://localhost/canvas"));
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain("cytoscape");
    expect(html).toContain("/canvas/ws");
    expect(html).toContain("graph-keeper");
    expect(html).toContain("get-graph");
    expect(html).toContain("contracts.proposeReflex");
    expect(html).toContain("/api/contracts/proposals/");
    expect(html).toContain("duties.proposeDuty");
    expect(html).toContain("/api/duties/proposals/");
    expect(html).toContain("lint.finding");
    expect(html).toContain("/timeline/api/events");
    expect(html).toContain("registered-events");
    expect(html).toContain("btn-execution");
    expect(html).toContain("simulate-event");
    expect(html).toContain("btn-simulate");
    expect(html).toContain("palette-list");
    expect(html).toContain("palette-new-duty");
    expect(html).toContain("palette-new-contract");
    expect(html).toContain("btn-clear-canvas");
    expect(html).toContain("canvas-hint");
    expect(html).toContain("btn-expand");
    expect(html).toContain("code-panel");
    expect(html).toContain("get-node-source");
    expect(html).toContain("duty-name-field");
    expect(html).toContain("contract-name-field");

    // The whole page is one big script — syntax-check the inline JS the same
    // way the chatty proposal-card tests do, to catch template-literal escaping bugs.
    const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const mainScript = scriptBlocks.find((s) => s?.includes("function connect"));
    expect(mainScript).toBeDefined();
    expect(() => new Function(mainScript!)).not.toThrow();
  });
});
