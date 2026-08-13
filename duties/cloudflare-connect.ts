import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import { loadTunnelState } from "../plugins/cloudflare/src/tunnelState.js";
import type { TunnelConfig } from "../plugins/cloudflare/src/types.js";
import { renderQrSvg } from "../plugins/cloudflare/src/qr.js";
import { hankoTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getSharedUIPrimitivesCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "@ronin/utils/theme.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * /connect — a scannable QR code for whichever Cloudflare tunnel is
 * currently active, so getting Ronin's dashboard onto a phone is "scan
 * a code" rather than "type a URL". See docs/REMOTE_ACCESS.md.
 */
export default class CloudflareConnectAgent extends BaseDuty {
  /** Overridable for tests — tunnelState.ts reads a fixed real ~/.ronin path
   *  with no path injection of its own, so a fake loader is how tests avoid
   *  touching (or depending on) the user's real tunnel state. */
  constructor(api: DutyAPI, private loadTunnels: () => TunnelConfig[] = loadTunnelState) {
    super(api);
    this.api.http.registerRoute("/connect", this.handleConnectPage.bind(this));
  }

  async execute(): Promise<void> {
    // Route-driven, nothing to do on schedule.
  }

  private async handleConnectPage(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

    const active = this.loadTunnels()
      .filter((t) => t.status === "active" && t.url)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    const body = active
      ? `
        <div class="connect-url">${escapeHtml(active.url)}</div>
        <div class="connect-qr">${renderQrSvg(active.url)}</div>
        ${active.expires ? `<div class="connect-meta">Expires ${new Date(active.expires).toLocaleString()}</div>` : ""}
      `
      : `
        <div class="empty-state">No active tunnel.</div>
        <div class="connect-meta">Run <code>ronin cloudflare tunnel temp</code> to start one, then reload this page.</div>
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
