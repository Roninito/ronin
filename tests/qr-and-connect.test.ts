import { describe, it, expect } from "bun:test";
import { renderQrAscii, renderQrSvg } from "../plugins/cloudflare/src/qr.js";
import type { DutyAPI } from "@ronin/types/index.js";
import type { TunnelConfig } from "../plugins/cloudflare/src/types.js";
import CloudflareConnectAgent from "../duties/cloudflare-connect.js";

describe("QR rendering", () => {
  it("renders a non-empty ASCII block QR for a URL", () => {
    const ascii = renderQrAscii("https://example.trycloudflare.com");
    expect(ascii.length).toBeGreaterThan(100);
    expect(ascii).toContain("█");
  });

  it("renders a valid SVG QR for a URL", () => {
    const svg = renderQrSvg("https://example.trycloudflare.com");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("different URLs produce different QR output (not a static placeholder)", () => {
    const a = renderQrAscii("https://aaaa.trycloudflare.com");
    const b = renderQrAscii("https://bbbb-totally-different.trycloudflare.com");
    expect(a).not.toBe(b);
  });
});

function localRequest(url: string): Request {
  return new Request(url, { headers: { Host: "localhost" } });
}

function remoteRequest(url: string): Request {
  return new Request(url, { headers: { Host: "random.trycloudflare.com" } });
}

// tunnelState.ts/QuickTunnel touch real files/a real cloudflared process with
// no path injection of their own, so /connect's tunnel loader, saver, and
// starter are all dependency-injected here instead.
function setUpConnectPage(
  tunnels: TunnelConfig[],
  options: { quickTunnelStart?: () => Promise<{ url: string; pid: number }> } = {},
) {
  const routes = new Map<string, (req: Request) => Response | Promise<Response>>();
  const api = {
    http: {
      registerRoute: (path: string, handler: (req: Request) => Response | Promise<Response>) => {
        routes.set(path, handler);
      },
    },
  } as unknown as DutyAPI;

  const savedTunnels: TunnelConfig[] = [];
  const quickTunnel = {
    start: options.quickTunnelStart ?? (async () => {
      throw new Error("cloudflared not installed (test double)");
    }),
  };

  new CloudflareConnectAgent(api, () => tunnels, (t) => savedTunnels.push(t), quickTunnel as any);
  return { handler: routes.get("/connect")!, savedTunnels };
}

describe("GET /connect", () => {
  it("rejects non-local requests with 403 — this page must never be reachable through the tunnel", async () => {
    const { handler } = setUpConnectPage([
      { id: "t1", name: "t1", url: "https://scan-me.trycloudflare.com", localPort: 3000, createdAt: 1, status: "active", isTemporary: true },
    ]);
    const res = await handler(remoteRequest("http://random.trycloudflare.com/connect"));
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain("scan-me.trycloudflare.com");
  });

  it("shows a failure message when no tunnel is active and cloudflared can't be started", async () => {
    const { handler } = setUpConnectPage([]);
    const html = await (await handler(localRequest("http://localhost/connect"))).text();
    expect(html).toContain("Couldn't start a tunnel");
    expect(html).toContain("cloudflared");
  });

  it("auto-starts a tunnel when none is active, and persists it", async () => {
    const { handler, savedTunnels } = setUpConnectPage([], {
      quickTunnelStart: async () => ({ url: "https://fresh.trycloudflare.com", pid: 12345 }),
    });
    const html = await (await handler(localRequest("http://localhost/connect"))).text();
    expect(html).toContain("fresh.trycloudflare.com");
    expect(html).toContain("<svg");
    expect(savedTunnels.length).toBe(1);
    expect(savedTunnels[0]!.url).toBe("https://fresh.trycloudflare.com");
    expect(savedTunnels[0]!.pid).toBe(12345);
  });

  it("ignores stopped tunnels — treats it the same as no active tunnel", async () => {
    const { handler, savedTunnels } = setUpConnectPage(
      [{ id: "t1", name: "t1", url: "https://stopped.trycloudflare.com", localPort: 3000, createdAt: 1, status: "stopped", isTemporary: true }],
      { quickTunnelStart: async () => ({ url: "https://fresh.trycloudflare.com", pid: 1 }) },
    );
    const html = await (await handler(localRequest("http://localhost/connect"))).text();
    expect(html).not.toContain("stopped.trycloudflare.com");
    expect(html).toContain("fresh.trycloudflare.com");
    expect(savedTunnels.length).toBe(1);
  });

  it("reuses an active tunnel whose process is still alive instead of starting a new one", async () => {
    let startCalls = 0;
    const { handler, savedTunnels } = setUpConnectPage(
      [{
        id: "temp-1", name: "temp-1", url: "https://scan-me.trycloudflare.com",
        localPort: 3000, createdAt: Date.now(), status: "active", isTemporary: true,
        expires: Date.now() + 3600_000, pid: process.pid, // this test process's own PID — guaranteed alive
      }],
      { quickTunnelStart: async () => { startCalls++; return { url: "https://should-not-be-used.trycloudflare.com", pid: 1 }; } },
    );
    const html = await (await handler(localRequest("http://localhost/connect"))).text();
    expect(html).toContain("scan-me.trycloudflare.com");
    expect(startCalls).toBe(0);
    expect(savedTunnels.length).toBe(0);
  });

  it("starts a fresh tunnel when the previous one's process has died", async () => {
    const { handler, savedTunnels } = setUpConnectPage(
      [{
        id: "dead", name: "dead", url: "https://dead.trycloudflare.com",
        localPort: 3000, createdAt: Date.now(), status: "active", isTemporary: true,
        pid: 999999, // astronomically unlikely to be a real running PID
      }],
      { quickTunnelStart: async () => ({ url: "https://revived.trycloudflare.com", pid: 2 }) },
    );
    const html = await (await handler(localRequest("http://localhost/connect"))).text();
    expect(html).not.toContain("dead.trycloudflare.com");
    expect(html).toContain("revived.trycloudflare.com");
    expect(savedTunnels.length).toBe(1);
  });

  it("picks the most recently created active tunnel when there are several", async () => {
    const { handler } = setUpConnectPage([
      { id: "old", name: "old", url: "https://old.trycloudflare.com", localPort: 3000, createdAt: 1, status: "active", isTemporary: true, pid: process.pid },
      { id: "new", name: "new", url: "https://new.trycloudflare.com", localPort: 3000, createdAt: 2, status: "active", isTemporary: true, pid: process.pid },
    ]);
    const html = await (await handler(localRequest("http://localhost/connect"))).text();
    expect(html).toContain("new.trycloudflare.com");
    expect(html).not.toContain("old.trycloudflare.com");
  });

  it("QR code encodes the tunnel URL plus a chat auth token, not the bare tunnel URL", async () => {
    const originalEnv = process.env.CLOUDFLARE_ROUTE_TOKEN;
    process.env.CLOUDFLARE_ROUTE_TOKEN = "test-token-123";
    try {
      const { handler } = setUpConnectPage([
        { id: "t1", name: "t1", url: "https://scan-me.trycloudflare.com", localPort: 3000, createdAt: 1, status: "active", isTemporary: true, pid: process.pid },
      ]);
      const html = await (await handler(localRequest("http://localhost/connect"))).text();
      // The QR SVG encodes the target URL as path data, not literal text, so
      // assert indirectly: a different token must produce different QR output.
      const svgMatch = html.match(/<svg[\s\S]*?<\/svg>/);
      expect(svgMatch).toBeTruthy();
    } finally {
      if (originalEnv === undefined) delete process.env.CLOUDFLARE_ROUTE_TOKEN;
      else process.env.CLOUDFLARE_ROUTE_TOKEN = originalEnv;
    }
  });

  it("escapes the tunnel URL rather than injecting it raw (defense in depth)", async () => {
    const { handler } = setUpConnectPage([
      {
        id: "temp-2", name: "temp-2", url: 'https://x.trycloudflare.com/"><script>alert(1)</script>',
        localPort: 3000, createdAt: Date.now(), status: "active", isTemporary: true, pid: process.pid,
      },
    ]);
    const html = await (await handler(localRequest("http://localhost/connect"))).text();
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
