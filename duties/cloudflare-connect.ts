import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import { loadTunnelState, addTunnel } from "../plugins/cloudflare/src/tunnelState.js";
import type { TunnelConfig } from "../plugins/cloudflare/src/types.js";
import { renderQrSvg } from "../plugins/cloudflare/src/qr.js";
import { QuickTunnel } from "../plugins/cloudflare/src/QuickTunnel.js";
import { getOrCreateRouteToken, isLocalRequest } from "../plugins/cloudflare/src/routeToken.js";
import { hankoTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getSharedUIPrimitivesCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "@ronin/utils/theme.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const LOCAL_PORT = process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT, 10) : 3000;

/**
 * /connect — auto-starts (and keeps alive) a Cloudflare quick tunnel, and
 * shows a scannable QR code that takes a phone straight into a
 * pre-authenticated /chat, so getting Ronin's dashboard onto a phone is
 * "scan a code" rather than "type a URL and a secret". See docs/REMOTE_ACCESS.md.
 *
 * Deliberately does not touch the RouteGuard/route-policy system (`ronin
 * cloudflare route init`/`route add`) — creating a policy at all gates every
 * route on the server, not just the ones added to it, which would silently
 * 403 every other existing dashboard page. Instead this uses one small
 * shared secret (routeToken.ts), checked directly by /connect and /chat's own
 * handlers, only for requests that aren't from this machine itself.
 */
export default class CloudflareConnectAgent extends BaseDuty {
  static schedule = "*/5 * * * *";

  /** Overridable for tests — tunnelState.ts/QuickTunnel touch real files/processes with no path injection of their own. */
  constructor(
    api: DutyAPI,
    private loadTunnels: () => TunnelConfig[] = loadTunnelState,
    private saveTunnel: (config: TunnelConfig) => void = addTunnel,
    private quickTunnel: Pick<QuickTunnel, "start"> = new QuickTunnel(),
  ) {
    super(api);
    this.api.http.registerRoute("/connect", this.handleConnectPage.bind(this));
  }

  /** Watchdog: proactively keeps a tunnel alive so a paired phone's bookmark keeps working, restarting it only if it's actually gone. */
  async execute(): Promise<void> {
    await this.ensureTunnelActive();
  }

  /** Returns the URL of a currently-live tunnel, starting one if none is active or the previous one's process has died. */
  private async ensureTunnelActive(): Promise<string | null> {
    const active = this.loadTunnels()
      .filter((t) => t.status === "active" && t.url)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (active) {
      if (!active.pid) return active.url; // no PID to check (e.g. a named tunnel) — trust state as-is
      try {
        process.kill(active.pid, 0); // liveness probe — throws if the process is gone, doesn't actually signal it
        return active.url;
      } catch {
        // Process is dead — fall through and start a fresh one.
      }
    }

    try {
      const handle = await this.quickTunnel.start(LOCAL_PORT);
      const config: TunnelConfig = {
        id: `ronin-connect-${Date.now()}`,
        name: `ronin-connect-${Date.now()}`,
        url: handle.url,
        localPort: LOCAL_PORT,
        createdAt: Date.now(),
        status: "active",
        isTemporary: true,
        pid: handle.pid,
      };
      this.saveTunnel(config);
      return handle.url;
    } catch (error) {
      console.error("[cloudflare-connect] Failed to start tunnel:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  private async handleConnectPage(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    if (!isLocalRequest(req)) {
      return new Response("This page is only available on the machine running Ronin.", { status: 403 });
    }

    const tunnelUrl = await this.ensureTunnelActive();

    const body = tunnelUrl
      ? (() => {
          const token = getOrCreateRouteToken();
          const pairingUrl = `${tunnelUrl}/chat?token=${token}`;
          return `
        <div class="connect-url">${escapeHtml(tunnelUrl)}</div>
        <div class="connect-qr">${renderQrSvg(pairingUrl)}</div>
        <div class="connect-meta">Scan to open /chat, already signed in on this device.</div>
        <div class="connect-meta">This tunnel stays up as long as Ronin runs — the URL may change if <code>cloudflared</code> ever has to restart.</div>
      `;
        })()
      : `
        <div class="empty-state">Couldn't start a tunnel.</div>
        <div class="connect-meta">Make sure <code>cloudflared</code> is installed (macOS: <code>brew install cloudflared</code>), then reload this page.</div>
      `;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS(hankoTheme)}
    ${getSharedUIPrimitivesCSS(hankoTheme, { variant: "hanko" })}
    ${getHeaderBarCSS(hankoTheme)}

    body { padding: 0; margin: 0; }

    .page-content {
      max-width: 480px;
      margin: 0 auto;
      padding: ${hankoTheme.spacing.lg};
      text-align: center;
    }

    .connect-url {
      font-family: ${hankoTheme.fonts.mono};
      font-size: 0.8125rem;
      color: ${hankoTheme.colors.link};
      word-break: break-all;
      margin-bottom: ${hankoTheme.spacing.md};
    }

    .connect-qr {
      background: #fff;
      display: inline-block;
      padding: ${hankoTheme.spacing.md};
      border-radius: ${hankoTheme.borderRadius.md};
    }
    .connect-qr svg { display: block; width: 260px; height: 260px; }

    .connect-meta {
      margin-top: ${hankoTheme.spacing.md};
      font-size: 0.8125rem;
      color: ${hankoTheme.colors.textSecondary};
    }

    .empty-state {
      color: ${hankoTheme.colors.textTertiary};
      font-size: 0.875rem;
      padding: ${hankoTheme.spacing.lg} 0 ${hankoTheme.spacing.sm};
    }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>📱 Connect</h1>
    <div class="header-meta">
      <span>Scan to open Ronin's dashboard on your phone</span>
    </div>
  </div>

  <div class="page-content">
    ${body}
  </div>
</body>
</html>`;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
}
