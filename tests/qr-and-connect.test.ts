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

// tunnelState.ts reads a fixed real ~/.ronin path with no path injection of
// its own, so /connect's tunnel loader is dependency-injected (see
// duties/cloudflare-connect.ts) — these tests supply a fake loader instead
// of touching (or depending on) this machine's real tunnel state.
function setUpConnectPage(tunnels: TunnelConfig[]) {
  const routes = new Map<string, (req: Request) => Response | Promise<Response>>();
  const api = {
    http: {
      registerRoute: (path: string, handler: (req: Request) => Response | Promise<Response>) => {
        routes.set(path, handler);
      },
    },
  } as unknown as DutyAPI;
  new CloudflareConnectAgent(api, () => tunnels);
  return routes.get("/connect")!;
}

describe("GET /connect", () => {
  it("shows an empty state when there's no active tunnel", async () => {
    const handler = setUpConnectPage([]);
    const html = await (await handler(new Request("http://localhost/connect"))).text();
    expect(html).toContain("No active tunnel");
    expect(html).toContain("ronin cloudflare tunnel temp");
  });

  it("ignores stopped tunnels — only an active one counts", async () => {
    const handler = setUpConnectPage([
      { id: "t1", name: "t1", url: "https://stopped.trycloudflare.com", localPort: 3000, createdAt: 1, status: "stopped", isTemporary: true },
    ]);
    const html = await (await handler(new Request("http://localhost/connect"))).text();
    expect(html).toContain("No active tunnel");
    expect(html).not.toContain("stopped.trycloudflare.com");
  });

  it("shows the tunnel URL and a QR code once a tunnel is active", async () => {
    const handler = setUpConnectPage([
      {
        id: "temp-1", name: "temp-1", url: "https://scan-me.trycloudflare.com",
        localPort: 3000, createdAt: Date.now(), status: "active", isTemporary: true,
        expires: Date.now() + 3600_000, pid: 99999,
      },
    ]);
    const html = await (await handler(new Request("http://localhost/connect"))).text();
    expect(html).toContain("scan-me.trycloudflare.com");
    expect(html).toContain("<svg");
  });

  it("picks the most recently created active tunnel when there are several", async () => {
    const handler = setUpConnectPage([
      { id: "old", name: "old", url: "https://old.trycloudflare.com", localPort: 3000, createdAt: 1, status: "active", isTemporary: true },
      { id: "new", name: "new", url: "https://new.trycloudflare.com", localPort: 3000, createdAt: 2, status: "active", isTemporary: true },
    ]);
    const html = await (await handler(new Request("http://localhost/connect"))).text();
    expect(html).toContain("new.trycloudflare.com");
    expect(html).not.toContain("old.trycloudflare.com");
  });

  it("escapes the tunnel URL rather than injecting it raw (defense in depth)", async () => {
    const handler = setUpConnectPage([
      {
        id: "temp-2", name: "temp-2", url: 'https://x.trycloudflare.com/"><script>alert(1)</script>',
        localPort: 3000, createdAt: Date.now(), status: "active", isTemporary: true, pid: 99998,
      },
    ]);
    const html = await (await handler(new Request("http://localhost/connect"))).text();
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
