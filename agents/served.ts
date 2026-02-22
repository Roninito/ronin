import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { exec } from "child_process";
import { promisify } from "util";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";

const execAsync = promisify(exec);

interface ServerInfo {
  port: number;
  protocol: string;
  process: string;
  pid: number;
  user: string;
  address: string;
}

/**
 * Served Agent
 * 
 * Discovers and displays servers running on the local machine.
 * Uses the Served skill to gather server information and displays it on a web route.
 */
export default class ServedAgent extends BaseAgent {
  static webhook = "/served";
  
  private skillPath: string;
  
  constructor(api: AgentAPI) {
    super(api);
    // Use the user's home directory or fallback to common locations
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    this.skillPath = `${homeDir}/.ronin/skills/served/scripts`;
    this.registerRoutes();
    console.log("🌐 Served agent ready");
  }

  /**
   * Register HTTP routes
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/served", this.handleServersUI.bind(this));
    this.api.http.registerRoute("/served/", this.handleServersUI.bind(this));
    this.api.http.registerRoute("/served/api/servers", this.handleServersAPI.bind(this));
  }

  /**
   * Discover servers using the Served skill
   */
  private async discoverServers(): Promise<ServerInfo[]> {
    try {
      const scriptPath = `${this.skillPath}/discover.ts`;
      const { stdout } = await execAsync(`bun run ${scriptPath}`, {
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf-8",
      });
      
      const result = JSON.parse(stdout.trim());
      return result.servers || [];
    } catch (error) {
      console.error("[served] Error discovering servers:", error);
      return [];
    }
  }

  /**
   * Handle servers API requests
   */
  private async handleServersAPI(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const servers = await this.discoverServers();
      return Response.json({ servers });
    } catch (error) {
      console.error("[served] API error:", error);
      return Response.json({
        error: error instanceof Error ? error.message : "Unknown error",
        servers: [],
      }, { status: 500 });
    }
  }

  /**
   * Serve servers UI
   */
  private async handleServersUI(req: Request): Promise<Response> {
    const servers = await this.discoverServers();
    const lastUpdated = new Date().toISOString();
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Servers - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}

    body {
      margin: 0;
      padding: 0;
      font-size: 0.8125rem;
    }

    .header {
      flex-shrink: 0;
    }

    .page-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: ${roninTheme.spacing.lg};
    }

    .servers-container {
      display: grid;
      gap: ${roninTheme.spacing.md};
      margin-top: ${roninTheme.spacing.lg};
    }

    .server-card {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.md};
      transition: all 0.2s;
    }

    .server-card:hover {
      border-color: ${roninTheme.colors.borderHover};
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .server-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: ${roninTheme.spacing.sm};
    }

    .server-port {
      font-size: 1.25rem;
      font-weight: 600;
      color: ${roninTheme.colors.accent};
      font-family: 'Courier New', monospace;
    }

    .server-protocol {
      display: inline-block;
      padding: 2px 8px;
      border-radius: ${roninTheme.borderRadius.sm};
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: uppercase;
      background: ${roninTheme.colors.backgroundTertiary};
      color: ${roninTheme.colors.textSecondary};
    }

    .server-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: ${roninTheme.spacing.sm};
      margin-top: ${roninTheme.spacing.sm};
    }

    .info-item {
      display: flex;
      flex-direction: column;
    }

    .info-label {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textSecondary};
      margin-bottom: 2px;
    }

    .info-value {
      font-weight: 500;
      color: ${roninTheme.colors.textPrimary};
      font-family: 'Courier New', monospace;
    }

    .empty-state {
      text-align: center;
      padding: ${roninTheme.spacing.xl};
      color: ${roninTheme.colors.textSecondary};
    }

    .refresh-button {
      margin-top: ${roninTheme.spacing.md};
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      background: ${roninTheme.colors.accent};
      color: ${roninTheme.colors.textPrimary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      cursor: pointer;
      font-size: 0.8125rem;
      transition: all 0.2s;
    }

    .refresh-button:hover {
      background: ${roninTheme.colors.accentHover};
      border-color: ${roninTheme.colors.borderHover};
    }

    .stats {
      display: flex;
      gap: ${roninTheme.spacing.lg};
      margin-bottom: ${roninTheme.spacing.lg};
      padding: ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
    }

    .stat-item {
      display: flex;
      flex-direction: column;
    }

    .stat-value {
      font-size: 1.5rem;
      font-weight: 600;
      color: ${roninTheme.colors.accent};
    }

    .stat-label {
      font-size: 0.75rem;
      color: ${roninTheme.colors.textSecondary};
    }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>Servers</h1>
    <div class="header-meta">
      <span>Updated ${new Date(lastUpdated).toLocaleTimeString()}</span>
    </div>
  </div>

  <div class="page-content">
    <div class="stats">
      <div class="stat-item">
        <div class="stat-value">${servers.length}</div>
        <div class="stat-label">Total Servers</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${new Set(servers.map(s => s.protocol)).size}</div>
        <div class="stat-label">Protocols</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${new Set(servers.map(s => s.process)).size}</div>
        <div class="stat-label">Processes</div>
      </div>
    </div>

    <div class="servers-container">
      ${servers.length === 0 
        ? '<div class="empty-state">No servers found listening on any ports.</div>'
        : servers.map(server => `
          <div class="server-card">
            <div class="server-header">
              <div>
                <span class="server-port">:${server.port}</span>
                <span class="server-protocol">${server.protocol}</span>
              </div>
            </div>
            <div class="server-info">
              <div class="info-item">
                <span class="info-label">Process</span>
                <span class="info-value">${this.escapeHtml(server.process)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">PID</span>
                <span class="info-value">${server.pid}</span>
              </div>
              <div class="info-item">
                <span class="info-label">User</span>
                <span class="info-value">${this.escapeHtml(server.user)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Address</span>
                <span class="info-value">${this.escapeHtml(server.address)}</span>
              </div>
            </div>
          </div>
        `).join('')
      }
    </div>

    <button class="refresh-button" onclick="location.reload()">Refresh</button>
  </div>

  <script>
    // Auto-refresh every 30 seconds
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html" },
    });
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = { textContent: text } as any;
    return div.textContent || text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async execute(): Promise<void> {
    // This agent is route-driven, no scheduled execution needed
  }
}
