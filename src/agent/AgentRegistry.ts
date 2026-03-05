import type { AgentMetadata } from "../types/agent.js";
import type { FilesAPI } from "../api/files.js";
import type { HTTPAPI } from "../api/http.js";
import type { EventsAPI } from "../api/events.js";
import { CronScheduler } from "./CronScheduler.js";
import { logger } from "../utils/logger.js";
import { join } from "path";
import { networkInterfaces } from "os";
import { getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML, getHeaderHomeIconSVG } from "../utils/theme.js";
import { getConfigService } from "../config/ConfigService.js";
import { discoverRoutes, startMenubar, stopMenubar } from "../os/index.js";

/** Return first non-internal IPv4 address for LAN URL display (e.g. 192.168.x.x). */
function getLocalNetworkIP(): string | null {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const addrs = nets[name];
    if (!addrs) continue;
    for (const a of addrs) {
      if ((a.family === "IPv4" || (a as { family?: number }).family === 4) && !a.internal) {
        return a.address;
      }
    }
  }
  return null;
}

export interface RegistryOptions {
  files: FilesAPI;
  http: HTTPAPI;
  events?: EventsAPI;
  /** Hostname for webhook server; use "0.0.0.0" for LAN access (e.g. ronin start --host) */
  webhookHost?: string;
}

/**
 * Manages agent registration, scheduling, and event handling
 */
export class AgentRegistry {
  private agents: Map<string, AgentMetadata> = new Map();
  private cronJobs: Map<string, () => void> = new Map(); // Track scheduled agents and cleanup functions
  private fileWatchers: Map<string, string[]> = new Map(); // agent name -> patterns
  private webhookRoutes: Map<string, string> = new Map(); // path -> agent name
  private webhookServer: ReturnType<typeof Bun.serve> | null = null;
  private files: FilesAPI;
  private http: HTTPAPI;
  private events?: EventsAPI;
  private scheduler: CronScheduler;
  private webhookHost?: string;

  constructor(options: RegistryOptions) {
    this.files = options.files;
    this.http = options.http;
    this.events = options.events;
    this.webhookHost = options.webhookHost;
    this.scheduler = new CronScheduler();
  }

  /**
   * Register an agent
   */
  register(agent: AgentMetadata): void {
    this.agents.set(agent.name, agent);

    // Register schedule if present
    if (agent.schedule) {
      this.registerSchedule(agent.name, agent.schedule);
    }

    // Register file watchers if present
    if (agent.watch && agent.watch.length > 0) {
      this.registerFileWatchers(agent.name, agent.watch);
    }

    // Register webhook if present
    if (agent.webhook) {
      this.registerWebhook(agent.name, agent.webhook);
    }
  }

  /**
   * Register all agents
   */
  registerAll(agents: AgentMetadata[]): void {
    for (const agent of agents) {
      this.register(agent);
    }
  }

  /**
   * Get an agent by name
   */
  get(agentName: string): AgentMetadata | undefined {
    return this.agents.get(agentName);
  }

  /**
   * Unregister an agent
   */
  unregister(agentName: string): boolean {
    const agent = this.agents.get(agentName);
    if (!agent) {
      return false;
    }

    // Clean up cron job
    const cronCleanup = this.cronJobs.get(agentName);
    if (cronCleanup) {
      cronCleanup();
      this.cronJobs.delete(agentName);
    }

    // Clean up file watchers
    const patterns = this.fileWatchers.get(agentName);
    if (patterns) {
      for (const pattern of patterns) {
        this.files.unwatch(pattern);
      }
      this.fileWatchers.delete(agentName);
    }

    // Clean up webhook route
    if (agent.webhook) {
      this.webhookRoutes.delete(agent.webhook);
    }

    // Remove from agents map
    this.agents.delete(agentName);

    logger.info("Agent unregistered", { agent: agentName });
    return true;
  }

  /**
   * Register a cron schedule for an agent
   */
  private registerSchedule(agentName: string, schedule: string): void {
    const agent = this.agents.get(agentName);
    if (!agent) return;

    // Create a cron job using our scheduler
    const cleanup = this.scheduler.schedule(schedule, () => {
      this.executeAgent(agentName).catch(error => {
        logger.error("Scheduled agent execution failed", { agent: agentName, error });
      });
    });

    this.cronJobs.set(agentName, cleanup);
    logger.debug("Registered schedule", { agent: agentName, schedule });
  }

  /**
   * Register file watchers for an agent
   */
  private registerFileWatchers(agentName: string, patterns: string[]): void {
    const agent = this.agents.get(agentName);
    if (!agent) return;

    for (const pattern of patterns) {
      this.files.watch(pattern, async (path: string, event: string) => {
        if (agent.instance.onFileChange) {
          try {
            await agent.instance.onFileChange(
              path,
              event as "create" | "update" | "delete"
            );
          } catch (error) {
            logger.error("File change handler failed", { agent: agentName, error });
          }
        }
      });
    }

    this.fileWatchers.set(agentName, patterns);
    logger.debug("Registered file watchers", { agent: agentName, patterns });
  }

  /**
   * Start the webhook server (public method to ensure it's always available)
   */
  startWebhookServerIfNeeded(): void {
    if (!this.webhookServer) {
      this.startWebhookServer();
    }
  }

  /**
   * Register a webhook route for an agent
   */
  private registerWebhook(agentName: string, path: string): void {
    this.webhookRoutes.set(path, agentName);
    logger.debug("Registered webhook", { agent: agentName, path });

    // Start webhook server if not already started
    this.startWebhookServerIfNeeded();
  }

  /**
   * Start the webhook server
   */
  private startWebhookServer(): void {
    const port = process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : 3000;
    const idleTimeout = process.env.HTTP_IDLE_TIMEOUT ? parseInt(process.env.HTTP_IDLE_TIMEOUT) : 60;
    const hostname = this.webhookHost;

    this.webhookServer = Bun.serve({
      ...(hostname && { hostname }),
      port,
      idleTimeout, // Timeout in seconds for long-running requests (default: 60s)
      fetch: async (req) => {
        const url = new URL(req.url);
        const path = url.pathname;

        // Root route - Main dashboard
        if (path === "/") {
          return new Response(await this.getDashboardHTML(port), {
            headers: { "Content-Type": "text/html" },
          });
        }

        // Routes explorer (legacy homepage)
        if (path === "/routes" || path === "/routes/") {
          return new Response(this.getRootHTML(port), {
            headers: { "Content-Type": "text/html" },
          });
        }

        // Status endpoint - API (JSON)
        if (path === "/api/status") {
          const status = this.getStatus();
          return Response.json({
            running: true,
            port,
            ...status,
            uptime: process.uptime(),
            pid: process.pid,
          }, {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Routes endpoint - API (JSON)
        if (path === "/api/routes") {
          const routes = this.getRoutesList(port);
          return Response.json({
            running: true,
            port,
            routes,
          }, {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Status endpoint - Web UI (HTML)
        if (path === "/status") {
          const status = this.getStatus();
          const statusData = {
            running: true,
            port,
            ...status,
            uptime: process.uptime(),
            pid: process.pid,
          };
          return new Response(this.getStatusHTML(statusData), {
            headers: { "Content-Type": "text/html" },
          });
        }

        // Health check endpoint
        if (path === "/health" || path === "/api/health") {
          return Response.json({ status: "ok", running: true }, {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Serve font files
        if (path.startsWith("/fonts/")) {
          try {
            const fontPath = join(process.cwd(), "public", path);
            const file = Bun.file(fontPath);
            if (await file.exists()) {
              const ext = path.split(".").pop()?.toLowerCase();
              const contentType = ext === "otf" ? "font/otf" : ext === "ttf" ? "font/ttf" : ext === "woff" ? "font/woff" : ext === "woff2" ? "font/woff2" : "application/octet-stream";
              return new Response(file, {
                headers: {
                  "Content-Type": contentType,
                  "Cache-Control": "public, max-age=31536000, immutable",
                },
              });
            }
          } catch {
            // Fall through to 404
          }
        }

        // Event emission endpoint
        if (path === "/api/events/emit" && req.method === "POST") {
          if (!this.events) {
            return Response.json({ error: "Events API not available" }, { status: 500 });
          }
          try {
            const body = await req.json();
            const { event, data, source } = body;
            if (!event) {
              return Response.json({ error: "Event name required" }, { status: 400 });
            }
            const payload = data ?? {};
            const eventSource = typeof source === "string" && source ? source : "http";
            this.events.emit(event, payload, eventSource);
            return Response.json({ success: true, event, data: payload });
          } catch (error) {
            return Response.json({ error: "Invalid JSON" }, { status: 400 });
          }
        }

        // Menubar routes config: GET and PUT
        if (path === "/api/menubar-routes") {
          const configService = getConfigService();
          const desktop = configService.get<{ menubar?: boolean; bridge?: { port?: number }; menubarRoutes?: Record<string, unknown> }>("desktop") ?? {};
          const menubarRoutes = desktop.menubarRoutes ?? { enabled: true, excludePatterns: ["/api/"] };
          const routesConfig = menubarRoutes as { enabled?: boolean; allowedPaths?: string[]; includePatterns?: string[]; excludePatterns?: string[]; maxItems?: number };

          if (req.method === "GET") {
            const effectiveRoutes = discoverRoutes(
              () => this.http.getAllRoutes(),
              (p) => this.http.getRouteMetadata(p),
              routesConfig
            );
            return Response.json(
              { menubarRoutes: routesConfig, effectiveRoutes },
              { headers: { "Content-Type": "application/json" } }
            );
          }

          if (req.method === "PUT") {
            try {
              const body = await req.json() as Record<string, unknown>;
              const allowedPaths = body.allowedPaths;
              if (allowedPaths !== undefined && !Array.isArray(allowedPaths)) {
                return Response.json({ error: "allowedPaths must be an array of strings" }, { status: 400, headers: { "Content-Type": "application/json" } });
              }
              if (allowedPaths !== undefined) {
                for (const p of allowedPaths as unknown[]) {
                  if (typeof p !== "string") {
                    return Response.json({ error: "allowedPaths must contain only strings" }, { status: 400, headers: { "Content-Type": "application/json" } });
                  }
                }
              }
              const maxItems = body.maxItems;
              if (maxItems !== undefined && (typeof maxItems !== "number" || maxItems < 0)) {
                return Response.json({ error: "maxItems must be a non-negative number" }, { status: 400, headers: { "Content-Type": "application/json" } });
              }
              const enabled = body.enabled;
              if (enabled !== undefined && typeof enabled !== "boolean") {
                return Response.json({ error: "enabled must be a boolean" }, { status: 400, headers: { "Content-Type": "application/json" } });
              }
              const includePatterns = body.includePatterns;
              if (includePatterns !== undefined && (!Array.isArray(includePatterns) || includePatterns.some((x: unknown) => typeof x !== "string"))) {
                return Response.json({ error: "includePatterns must be an array of strings" }, { status: 400, headers: { "Content-Type": "application/json" } });
              }
              const excludePatterns = body.excludePatterns;
              if (excludePatterns !== undefined && (!Array.isArray(excludePatterns) || excludePatterns.some((x: unknown) => typeof x !== "string"))) {
                return Response.json({ error: "excludePatterns must be an array of strings" }, { status: 400, headers: { "Content-Type": "application/json" } });
              }

              const mergedMenubarRoutes = { ...routesConfig, ...body };
              const fullDesktop = configService.get<Record<string, unknown>>("desktop") ?? {};
              await configService.set("desktop", { ...fullDesktop, menubarRoutes: mergedMenubarRoutes });

              const desktopNow = configService.get<{ menubar?: boolean; bridge?: { port?: number } }>("desktop") ?? {};
              if (desktopNow.menubar) {
                const port = desktopNow.bridge?.port ?? 17341;
                const routes = discoverRoutes(
                  () => this.http.getAllRoutes(),
                  (p) => this.http.getRouteMetadata(p),
                  mergedMenubarRoutes as { enabled?: boolean; allowedPaths?: string[]; includePatterns?: string[]; excludePatterns?: string[]; maxItems?: number }
                );
                stopMenubar();
                try {
                  startMenubar(port, routes);
                } catch (err) {
                  logger.warn("Menubar restart failed after config update", { error: err });
                }
              }

              return Response.json({ success: true, menubarRoutes: mergedMenubarRoutes }, { headers: { "Content-Type": "application/json" } });
            } catch (err) {
              logger.error("PUT /api/menubar-routes failed", { error: err });
              return Response.json({ error: "Invalid request or config save failed" }, { status: 400, headers: { "Content-Type": "application/json" } });
            }
          }

          return new Response("Method Not Allowed", { status: 405 });
        }

        // Check HTTP API registered routes (agents can register routes via this.api.http.registerRoute)
        // Helper to safely call route handlers with error handling
        const safeRouteHandler = async (handler: (req: Request) => Response | Promise<Response>, routePath: string): Promise<Response> => {
          try {
            return await handler(req);
          } catch (error) {
            logger.error("HTTP route handler failed", { method: req.method, path: routePath, error });
            return new Response(
              JSON.stringify({ error: "Internal server error", message: String(error) }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }
        };

        // Check exact match first
        const httpRouteHandler = this.http.getRouteHandler(path);
        if (httpRouteHandler) {
          return safeRouteHandler(httpRouteHandler, path);
        }

        // Check for routes with trailing slash
        if (path.endsWith("/") && path.length > 1) {
          const pathWithoutSlash = path.slice(0, -1);
          const httpRouteHandlerNoSlash = this.http.getRouteHandler(pathWithoutSlash);
          if (httpRouteHandlerNoSlash) {
            return safeRouteHandler(httpRouteHandlerNoSlash, pathWithoutSlash);
          }
        } else if (!path.endsWith("/")) {
          const pathWithSlash = path + "/";
          const httpRouteHandlerWithSlash = this.http.getRouteHandler(pathWithSlash);
          if (httpRouteHandlerWithSlash) {
            return safeRouteHandler(httpRouteHandlerWithSlash, pathWithSlash);
          }
        }

        // Check for prefix matches (e.g., /fishy/api/fish/123 should match /fishy/api/fish/)
        // Only match if the registered path ends with / and the request path starts with it
        // This allows routes like /fishy/api/fish/ to handle /fishy/api/fish/123
        // IMPORTANT: Use longest matching prefix to avoid /blog/ matching before /blog/api/admin/posts/
        let longestMatch: { path: string; handler: (req: Request) => Response | Promise<Response> } | null = null;
        for (const [registeredPath, handler] of this.http.getAllRoutes()) {
          if (registeredPath.endsWith("/") && path.startsWith(registeredPath) && registeredPath !== "/") {
            if (!longestMatch || registeredPath.length > longestMatch.path.length) {
              longestMatch = { path: registeredPath, handler };
            }
          }
        }
        if (longestMatch) {
          return safeRouteHandler(longestMatch.handler, longestMatch.path);
        }

        // Agent webhook routes - try exact match first, then prefix match
        let agentName = this.webhookRoutes.get(path);
        
        // If no exact match, try prefix matching (for sub-routes like /webhook/api/data)
        if (!agentName) {
          for (const [webhookPath, name] of this.webhookRoutes.entries()) {
            if (path.startsWith(webhookPath + "/") || path === webhookPath) {
              agentName = name;
              break;
            }
          }
        }
        
        if (!agentName) {
          return new Response("Not Found", { status: 404 });
        }

        const agent = this.agents.get(agentName);
        if (!agent) {
          return new Response("Agent not found", { status: 404 });
        }

        try {
          let payload: unknown = null;
          if (req.method === "POST" || req.method === "PUT") {
            const contentType = req.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
              payload = await req.json();
            } else {
              payload = await req.text();
            }
          }

          let result: any = { success: true };
          if (agent.instance.onWebhook) {
            // Pass request object with full context to the webhook handler
            const requestInfo = {
              url: req.url,
              method: req.method,
              headers: Object.fromEntries(req.headers.entries()),
              payload,
            };
            result = await agent.instance.onWebhook(requestInfo);
          }

          // If handler returns a custom response object with contentType and body, use it
          if (result && typeof result === "object" && result.contentType && result.body) {
            const contentType = result.contentType;
            const body = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
            const status = result.status || 200;
            return new Response(body, {
              status,
              headers: { "Content-Type": contentType },
            });
          }

          // Otherwise return standard JSON response
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          logger.error("Webhook handler failed", { agent: agentName, error });
          return new Response(
            JSON.stringify({ error: String(error) }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
    });

    const localUrl = `http://localhost:${port}`;
    if (hostname === "0.0.0.0") {
      const lanIp = getLocalNetworkIP();
      logger.info("Webhook server started (network)", { port, localUrl, networkUrl: lanIp ? `http://${lanIp}:${port}` : "(could not detect LAN IP)" });
      console.log(`\n  Local:   ${localUrl}`);
      if (lanIp) {
        console.log(`  Network: http://${lanIp}:${port}\n`);
      } else {
        console.log(`  Network: (use your machine's LAN IP)\n`);
      }
    } else {
      logger.info("Webhook server started", { port, statusUrl: `http://localhost:${port}/api/status` });
    }
  }

  /**
   * Execute an agent manually
   */
  async executeAgent(agentName: string): Promise<void> {
    const agent = this.agents.get(agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }

    await agent.instance.execute();
  }

  /**
   * Get all registered agents
   */
  getAgents(): AgentMetadata[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by name
   */
  getAgent(name: string): AgentMetadata | undefined {
    return this.agents.get(name);
  }

  /**
   * Get agent status information
   */
  getStatus(): {
    totalAgents: number;
    scheduledAgents: number;
    watchedAgents: number;
    webhookAgents: number;
    agents: Array<{
      name: string;
      description?: string;
      schedule?: string;
      watch?: string[];
      webhook?: string;
    }>;
  } {
    const agents = this.getAgents();
    return {
      totalAgents: agents.length,
      scheduledAgents: agents.filter(a => a.schedule).length,
      watchedAgents: agents.filter(a => a.watch && a.watch.length > 0).length,
      webhookAgents: agents.filter(a => a.webhook).length,
      agents: agents.map(a => ({
        name: a.name,
        description: a.description,
        schedule: a.schedule,
        watch: a.watch,
        webhook: a.webhook,
      })),
    };
  }

  /**
   * Get all known routes (system + registered HTTP + webhook routes)
   */
  private getRoutesList(port: number): Array<{
    path: string;
    url: string;
    type: "system" | "http" | "webhook";
    description?: string;
  }> {
    const routes: Array<{
      path: string;
      url: string;
      type: "system" | "http" | "webhook";
      description?: string;
    }> = [];

    const addRoute = (path: string, type: "system" | "http" | "webhook", description?: string) => {
      routes.push({
        path,
        url: `http://localhost:${port}${path}`,
        type,
        description,
      });
    };

    // System routes
    addRoute("/", "system", "Home dashboard");
    addRoute("/routes", "system", "Routes dashboard");
    addRoute("/status", "system", "Status UI");
    addRoute("/api/status", "system", "Status JSON");
    addRoute("/health", "system", "Health check");
    addRoute("/api/health", "system", "Health check JSON");
    addRoute("/api/routes", "system", "List registered routes");

    // HTTP API routes (agent-registered)
    for (const path of this.http.getAllRoutes().keys()) {
      addRoute(path, "http", "Agent-registered HTTP route");
    }

    // Webhook routes
    for (const [path, agentName] of this.webhookRoutes.entries()) {
      addRoute(path, "webhook", `Webhook for ${agentName}`);
    }

    return routes;
  }

  /**
   * Generate root HTML page with all available routes
   */
  private escapeHtml(input: string): string {
    return String(input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private async getRecentLogPreview(): Promise<string> {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const candidates = [
      join(home, ".ronin", "ninja.log"),
      join(home, ".ronin", "daemon.log"),
      join(home, ".ronin", "logs", "runs", "latest.log"),
    ];
    for (const filePath of candidates) {
      try {
        const file = Bun.file(filePath);
        if (!(await file.exists())) continue;
        const text = await file.text();
        const lines = text.split("\n").filter(Boolean);
        if (lines.length === 0) continue;
        return lines.slice(-12).join("\n");
      } catch {
        // try next
      }
    }
    return "No recent logs found at ~/.ronin/ninja.log, ~/.ronin/daemon.log, or ~/.ronin/logs/runs/latest.log";
  }

  private getDashboardNavConfigPath(): string {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return join(home, ".ronin", "dashboard-nav.config.json");
  }

  private async getDashboardNavRoutes(allRoutes: Array<{ path: string }>): Promise<string[]> {
    const defaults = ["/chat", "/analytics", "/config", "/routes"];
    const validSet = new Set(allRoutes.map((r) => r.path));
    const path = this.getDashboardNavConfigPath();
    try {
      const file = Bun.file(path);
      if (!(await file.exists())) {
        await Bun.write(path, JSON.stringify({ routes: defaults }, null, 2));
        return defaults;
      }
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { routes?: unknown };
      const routes = Array.isArray(parsed?.routes)
        ? parsed.routes.map((r) => String(r).trim()).filter((r) => r.startsWith("/") && validSet.has(r))
        : [];
      return routes.length ? Array.from(new Set(routes)) : defaults;
    } catch {
      return defaults;
    }
  }

  private async getDashboardHTML(port: number): Promise<string> {
    const status = this.getStatus();
    const allRoutes = this.getRoutesList(port);
    const dashboardNavRoutes = await this.getDashboardNavRoutes(allRoutes);
    const formatDashNavRoute = (route: string) => route.toUpperCase().replaceAll("/", "🗎 ");
    const httpRoutes = allRoutes.filter((r) => r.type === "http").length;
    const systemRoutes = allRoutes.filter((r) => r.type === "system").length;
    const webhookRoutes = allRoutes.filter((r) => r.type === "webhook").length;
    const logPreview = await this.getRecentLogPreview();
    const uptime = Math.floor(process.uptime());

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ronin Dashboard</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}
    body { margin: 0; background: #000; color: #fff; font-family: 'Adobe Clean', 'Inter', sans-serif; }
    .shell { max-width: 1320px; margin: 0 auto; padding: 1rem; display: grid; grid-template-columns: 220px minmax(0,1fr); gap: .75rem; }
    .dashboard-nav { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: .65rem; position: sticky; top: 8px; margin-top: 11px; z-index: 1100; height: fit-content; }
    .dashboard-nav h2 { margin: 0 0 .55rem; font-size: .7rem; color: rgba(255,255,255,.6); text-transform: uppercase; letter-spacing: .1em; }
    .dashboard-nav a { display:block; color:#b4b4bb; text-decoration:none; font-size:.74rem; font-weight:700; padding:.42rem .5rem; border-radius:4px; border:1px solid transparent; margin-bottom:.2rem; }
    .dashboard-nav a:hover { background: rgba(124,58,237,0.1); border-color: rgba(124,58,237,0.35); color:#fff; }
    .page { min-width: 0; }
    .loading-screen { position: fixed; inset: 0; background: radial-gradient(circle at 50% 35%, rgba(132,204,22,0.18), transparent 45%), #050506; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; transition: opacity .45s ease; }
    .loading-screen.hidden { opacity: 0; pointer-events: none; }
    .spinner { width: 72px; height: 72px; border-radius: 50%; border: 2px solid rgba(132,204,22,0.25); border-top-color: #84cc16; animation: spin 1.2s linear infinite; box-shadow: 0 0 30px rgba(132,204,22,0.25); }
    .loading-title { font-size: 0.9rem; letter-spacing: .16em; text-transform: uppercase; color: #d9f99d; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: .35rem; margin: .75rem 0; }
    .card { background: #000; border: 0.5px solid rgba(255,255,255,0.22); border-radius: 0; padding: .8rem; }
    .label { color: rgba(255,255,255,.6); font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; }
    .value { font-size: 1.35rem; margin-top: .3rem; }
    .content { display: grid; grid-template-columns: 2fr 1fr; gap: .35rem; }
    .panel-title { margin: 0 0 .45rem; font-size: .9rem; }
    .panel-actions a { color: #84cc16; text-decoration: none; font-size: .8rem; margin-right: .8rem; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: 'JetBrains Mono', monospace; font-size: .74rem; color: #d4d4d8; }
    @media (max-width: 980px){ .shell{grid-template-columns:1fr;} .dashboard-nav{position:static;} .grid{grid-template-columns:repeat(2,minmax(0,1fr));} .content{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <div id="loadingScreen" class="loading-screen"><div class="spinner"></div><div class="loading-title">Initializing Ronin Dashboard</div></div>
  <div class="header">${getHeaderHomeIconHTML()}<h1>DASH</h1><div class="header-meta"><span>Runtime overview</span></div></div>
  <div class="shell">
    <aside class="dashboard-nav">
      <h2>DASH</h2>
      ${dashboardNavRoutes.map((route) => `<a href="${route}">${this.escapeHtml(formatDashNavRoute(route))}</a>`).join("")}
    </aside>
    <div class="page">
    <div class="grid">
      <div class="card"><div class="label">Agents</div><div class="value">${status.totalAgents}</div></div>
      <div class="card"><div class="label">Scheduled</div><div class="value">${status.scheduledAgents}</div></div>
      <div class="card"><div class="label">Uptime (s)</div><div class="value">${uptime}</div></div>
      <div class="card"><div class="label">PID</div><div class="value">${process.pid}</div></div>
    </div>
    <div class="content">
      <div class="card">
        <h2 class="panel-title">Recent Logs</h2>
        <pre>${this.escapeHtml(logPreview)}</pre>
      </div>
      <div class="card">
        <h2 class="panel-title">Basic Analytics</h2>
        <div class="label">System Routes</div><div class="value">${systemRoutes}</div>
        <div class="label" style="margin-top:.55rem">HTTP Routes</div><div class="value">${httpRoutes}</div>
        <div class="label" style="margin-top:.55rem">Webhook Routes</div><div class="value">${webhookRoutes}</div>
        <div class="panel-actions" style="margin-top: .9rem;">
          <a href="/routes">Open Routes</a>
          <a href="/status">Status</a>
          <a href="/analytics">Analytics</a>
        </div>
      </div>
    </div>
    </div>
  </div>
  <script>
    window.setTimeout(() => {
      const el = document.getElementById('loadingScreen');
      if (el) el.classList.add('hidden');
    }, 1500);
  </script>
</body>
</html>`;
  }

  /**
   * Generate routes explorer HTML page with all available routes
   */
  private getRootHTML(port: number): string {
    const status = this.getStatus();
    const allRoutes = this.getRoutesList(port);

    // Helper function to get icon for a route
    const getRouteIcon = (path: string, type: string): string => {
      // Route-specific icons
      if (path.includes("/fishy")) return "🐟";
      if (path.includes("/rss")) return "📰";
      if (path.includes("/gvec")) return "🌍";
      
      // Type-based icons
      if (type === "system") return "⚡";
      if (type === "webhook") return "🔗";
      if (path.startsWith("/api/")) return "🔌";
      return "🌐";
    };

    // Helper function to get title for a route
    const getRouteTitle = (path: string, type: string, description?: string): string => {
      if (description && description !== "Agent-registered HTTP route") {
        // Extract title from description if it's descriptive
        if (description.includes("Webhook for")) {
          return description.replace("Webhook for ", "") + " Webhook";
        }
        if (description.includes("Home dashboard")) return "Home Dashboard";
        if (description.includes("Routes dashboard")) return "Routes Dashboard";
        if (description.includes("Status UI")) return "Status Dashboard";
        if (description.includes("Status JSON")) return "Status API";
        if (description.includes("Health check")) return "Health Check";
        if (description.includes("List registered routes")) return "Routes API";
      }
      
      // Generate title from path
      if (path === "/") return "Home Dashboard";
      if (path === "/routes") return "Routes Dashboard";
      if (path === "/status") return "Status Dashboard";
      if (path.startsWith("/api/")) {
        const apiName = path.replace("/api/", "").split("/")[0];
        return apiName.charAt(0).toUpperCase() + apiName.slice(1) + " API";
      }
      if (type === "webhook") {
        const agentName = this.webhookRoutes.get(path);
        return agentName ? `${agentName} Webhook` : "Webhook";
      }
      
      // Convert path to title
      const segments = path.split("/").filter(Boolean);
      return segments.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
    };

    // Helper function to get category for a route
    const getRouteCategory = (path: string, type: string): string => {
      if (type === "system") {
        if (path.startsWith("/api/")) return "System";
        return "System";
      }
      if (type === "webhook") return "Webhooks";
      if (path.startsWith("/api/")) return "API";
      return "Web UI";
    };

    // Helper function to get description for a route
    const getRouteDescription = (path: string, type: string, description?: string): string => {
      if (description && description !== "Agent-registered HTTP route") {
        return description;
      }
      
      if (type === "system") {
        if (path === "/") return "Main dashboard with runtime stats, logs, and analytics";
        if (path === "/routes") return "Routes dashboard";
        if (path === "/status") return "View system status, agents, and runtime information";
        if (path === "/api/status") return "Get system status as JSON";
        if (path === "/api/health" || path === "/health") return "Simple health check endpoint";
        if (path === "/api/routes") return "List all registered routes as JSON";
      }
      
      if (type === "webhook") {
        const agentName = this.webhookRoutes.get(path);
        return agentName ? `Webhook endpoint for ${agentName} agent` : "Webhook endpoint";
      }
      
      if (path.startsWith("/api/")) {
        return "API endpoint";
      }
      
      return "Web interface";
    };

    // Deduplicate routes (prefer routes without trailing slashes)
    const routeMap = new Map<string, typeof allRoutes[0]>();
    for (const route of allRoutes) {
      const normalizedPath = route.path.endsWith("/") && route.path.length > 1
        ? route.path.slice(0, -1)
        : route.path;
      
      // Skip root route from display
      if (normalizedPath === "/") continue;
      
      // Prefer route without trailing slash, or keep existing if already added
      if (!routeMap.has(normalizedPath)) {
        routeMap.set(normalizedPath, route);
      } else {
        const existing = routeMap.get(normalizedPath)!;
        if (!route.path.endsWith("/") && existing.path.endsWith("/")) {
          routeMap.set(normalizedPath, route);
        }
      }
    }

    // Transform routes into template format
    const routes = Array.from(routeMap.values()).map(route => ({
      path: route.path.endsWith("/") && route.path.length > 1 ? route.path.slice(0, -1) : route.path,
      title: getRouteTitle(route.path, route.type, route.description),
      description: getRouteDescription(route.path, route.type, route.description),
      icon: getRouteIcon(route.path, route.type),
      category: getRouteCategory(route.path, route.type)
    }));

    // Group routes by category and sort within each category
    const routesByCategory = routes.reduce((acc, route) => {
      if (!acc[route.category]) {
        acc[route.category] = [];
      }
      acc[route.category].push(route);
      return acc;
    }, {} as Record<string, typeof routes>);

    // Sort routes within each category by path
    for (const category in routesByCategory) {
      routesByCategory[category].sort((a, b) => a.path.localeCompare(b.path));
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin - Available Routes</title>
  <link href="https://cdn.jsdelivr.net/npm/gridstack@10.1.2/dist/gridstack.min.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/gridstack@10.1.2/dist/gridstack-all.js"></script>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 4rem 2rem;
    }

    .content {
      padding: 0;
    }
    
    .category {
      margin-bottom: 4rem;
    }
    
    .category-title {
      font-size: 0.875rem;
      color: rgba(255, 255, 255, 0.4);
      margin-bottom: 1.5rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    
    .category-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(255, 255, 255, 0.1);
    }
    
    .routes-grid {
      margin-top: 0.5rem;
    }

    .routes-grid .grid-stack-item-content {
      inset: 0.5rem;
    }
    
    .route-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 1.5rem;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      text-decoration: none;
      color: inherit;
      display: block;
      position: relative;
      overflow: hidden;
    }
    
    .route-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
      opacity: 0;
      transition: opacity 0.3s;
    }
    
    .route-card:hover {
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.04);
      transform: translateY(-2px);
      text-decoration: none;
    }
    
    .route-card:hover::before {
      opacity: 1;
    }
    
    .route-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    
    .route-icon {
      font-size: 1.25rem;
      opacity: 0.8;
    }
    
    .route-title {
      font-size: 1.1rem;
      font-weight: 500;
      color: #ffffff;
      letter-spacing: -0.01em;
    }
    
    .route-path {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.5);
      background: rgba(255, 255, 255, 0.05);
      padding: 0.375rem 0.625rem;
      border-radius: 2px;
      display: inline-block;
      margin-bottom: 0.75rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    
    .route-description {
      color: rgba(255, 255, 255, 0.5);
      font-size: 0.875rem;
      line-height: 1.6;
      font-weight: 300;
    }
    
    .empty-category {
      text-align: center;
      padding: 3rem;
      color: rgba(255, 255, 255, 0.3);
      font-style: italic;
    }
    
    .footer {
      text-align: center;
      padding: 3rem 0 0;
      color: rgba(255, 255, 255, 0.3);
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      font-size: 0.75rem;
      font-weight: 300;
      letter-spacing: 0.05em;
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 2rem 1.5rem;
      }

      .routes-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>⚡ Ronin</h1>
    <div class="header-meta">
      <span>${status.totalAgents} Agents</span>
      <span>${status.scheduledAgents} Scheduled</span>
      <span>${status.webhookAgents} Webhooks</span>
      <span>Port ${port}</span>
    </div>
  </div>
  <div class="container">
    <div class="content">
      ${Object.entries(routesByCategory).map(([category, categoryRoutes]) => `
        <div class="category">
          <h2 class="category-title">
            <span>${category === "Web UI" ? "🌐" : category === "API" ? "🔌" : category === "Webhooks" ? "🔗" : "⚡"}</span>
            ${category}
          </h2>
          ${categoryRoutes.length > 0 ? `
            <div class="routes-grid grid-stack">
              ${categoryRoutes.map(route => `
                <div class="grid-stack-item" gs-w="4" gs-h="2">
                  <a href="${route.path}" class="route-card grid-stack-item-content">
                    <div class="route-header">
                      <span class="route-icon">${route.icon}</span>
                      <span class="route-title">${route.title}</span>
                    </div>
                    <div class="route-path">${route.path}</div>
                    <div class="route-description">${route.description}</div>
                  </a>
                </div>
              `).join("")}
            </div>
          ` : `
            <div class="empty-category">No routes available in this category</div>
          `}
        </div>
      `).join("")}
    </div>
    
    <div class="footer">
      <p>Ronin Agent System • Running on port ${port}</p>
    </div>
  </div>
  <script>
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof GridStack === 'undefined') return;
      document.querySelectorAll('.routes-grid.grid-stack').forEach((el) => {
        GridStack.init({ staticGrid: true, disableDrag: true, disableResize: true, margin: 8, cellHeight: 'auto' }, el);
      });
    });
  </script>
</body>
</html>`;
  }

  /**
   * Generate HTML status page
   */
  private getStatusHTML(statusData: {
    running: boolean;
    port: number;
    totalAgents: number;
    scheduledAgents: number;
    watchedAgents: number;
    webhookAgents: number;
    uptime: number;
    pid: number;
    agents: Array<{
      name: string;
      schedule?: string;
      watch?: string[];
      webhook?: string;
    }>;
  }): string {
    const formatUptime = (seconds: number): string => {
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      
      if (days > 0) return `${days}d ${hours}h ${minutes}m`;
      if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
      if (minutes > 0) return `${minutes}m ${secs}s`;
      return `${secs}s`;
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ronin Status</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }

    .status-badge {
      display: inline-block;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.7);
    }

    .status-badge.running {
      background: rgba(76, 175, 80, 0.15);
      border-color: rgba(76, 175, 80, 0.3);
      color: #4caf50;
    }
    
    .content {
      padding: 0;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 3rem;
    }
    
    .stat-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 1.5rem;
      text-align: center;
      transition: all 0.3s;
    }
    
    .stat-card:hover {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.15);
    }
    
    .stat-value {
      font-size: 2.5rem;
      font-weight: 300;
      color: #ffffff;
      margin-bottom: 0.5rem;
      font-family: 'JetBrains Mono', monospace;
    }
    
    .stat-label {
      color: rgba(255, 255, 255, 0.4);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-weight: 500;
    }
    
    .section {
      margin-bottom: 3rem;
    }
    
    .section-title {
      font-size: 0.875rem;
      color: rgba(255, 255, 255, 0.4);
      margin-bottom: 1.5rem;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    
    .section-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(255, 255, 255, 0.1);
    }
    
    .agent-list {
      display: grid;
      gap: 1rem;
    }
    
    .agent-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 1.5rem;
      transition: all 0.3s;
    }
    
    .agent-card:hover {
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.04);
      transform: translateY(-2px);
    }
    
    .agent-name {
      font-size: 1.2rem;
      font-weight: 500;
      color: #ffffff;
      margin-bottom: 1rem;
      letter-spacing: -0.01em;
    }
    
    .agent-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    
    .detail-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    
    .detail-label {
      font-weight: 500;
      color: rgba(255, 255, 255, 0.4);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    
    .detail-value {
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.875rem;
      font-family: 'JetBrains Mono', monospace;
    }
    
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 2px;
      font-size: 0.7rem;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border: 1px solid;
    }
    
    .badge.schedule {
      background: rgba(25, 118, 210, 0.1);
      border-color: rgba(25, 118, 210, 0.3);
      color: #64b5f6;
    }
    
    .badge.watch {
      background: rgba(123, 31, 162, 0.1);
      border-color: rgba(123, 31, 162, 0.3);
      color: #ba68c8;
    }
    
    .badge.webhook {
      background: rgba(56, 142, 60, 0.1);
      border-color: rgba(56, 142, 60, 0.3);
      color: #81c784;
    }
    
    .no-agents {
      text-align: center;
      padding: 3rem;
      color: rgba(255, 255, 255, 0.3);
      font-style: italic;
    }
    
    .refresh-btn {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.7);
      border-radius: 50%;
      width: 56px;
      height: 56px;
      font-size: 1.5rem;
      cursor: pointer;
      transition: all 0.3s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .refresh-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
      transform: scale(1.05) rotate(90deg);
    }
    
    .refresh-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
      margin-bottom: 3rem;
    }
    
    .info-item {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-left: 2px solid rgba(255, 255, 255, 0.2);
      padding: 1.25rem;
      border-radius: 4px;
    }
    
    .info-label {
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.4);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 0.5rem;
      font-weight: 500;
    }
    
    .info-value {
      font-size: 1.1rem;
      color: #ffffff;
      font-weight: 400;
      font-family: 'JetBrains Mono', monospace;
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 2rem 1.5rem;
      }
      
      .stats-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div id="root"></div>
  
  <script>
    const { useState, useEffect } = React;
    
    const statusData = ${JSON.stringify(statusData)};
    const homeIconSvg = ${JSON.stringify(getHeaderHomeIconSVG())};
    
    function App() {
      const [data, setData] = useState(statusData);
      const [loading, setLoading] = useState(false);
      
      const refresh = async () => {
        setLoading(true);
        try {
          const res = await fetch('/api/status');
          const newData = await res.json();
          setData(newData);
        } catch (error) {
          console.error('Failed to refresh:', error);
        } finally {
          setLoading(false);
        }
      };
      
      // Auto-refresh every 5 seconds
      useEffect(() => {
        const interval = setInterval(refresh, 5000);
        return () => clearInterval(interval);
      }, []);
      
      const formatUptime = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (days > 0) return \`\${days}d \${hours}h \${minutes}m\`;
        if (hours > 0) return \`\${hours}h \${minutes}m \${secs}s\`;
        if (minutes > 0) return \`\${minutes}m \${secs}s\`;
        return \`\${secs}s\`;
      };
      
      return React.createElement('div', null,
        React.createElement('div', { className: 'header' },
          React.createElement('a', { href: '/', className: 'header-home', 'aria-label': 'Home', dangerouslySetInnerHTML: { __html: homeIconSvg } }),
          React.createElement('h1', null, 'Ronin Status'),
          React.createElement('div', { className: 'header-meta' },
            React.createElement('div', { 
              className: \`status-badge \${data.running ? 'running' : ''}\`
            }, data.running ? '🟢 Running' : '🔴 Stopped')
          )
        ),
        React.createElement('div', { className: 'container' },
          React.createElement('div', { className: 'info-grid' },
            React.createElement('div', { className: 'info-item' },
              React.createElement('div', { className: 'info-label' }, 'Port'),
              React.createElement('div', { className: 'info-value' }, data.port)
            ),
            React.createElement('div', { className: 'info-item' },
              React.createElement('div', { className: 'info-label' }, 'Process ID'),
              React.createElement('div', { className: 'info-value' }, data.pid)
            ),
            React.createElement('div', { className: 'info-item' },
              React.createElement('div', { className: 'info-label' }, 'Uptime'),
              React.createElement('div', { className: 'info-value' }, formatUptime(data.uptime))
            )
          ),
          React.createElement('div', { className: 'stats-grid' },
            React.createElement('div', { className: 'stat-card' },
              React.createElement('div', { className: 'stat-value' }, data.totalAgents),
              React.createElement('div', { className: 'stat-label' }, 'Total Agents')
            ),
            React.createElement('div', { className: 'stat-card' },
              React.createElement('div', { className: 'stat-value' }, data.scheduledAgents),
              React.createElement('div', { className: 'stat-label' }, 'Scheduled')
            ),
            React.createElement('div', { className: 'stat-card' },
              React.createElement('div', { className: 'stat-value' }, data.watchedAgents),
              React.createElement('div', { className: 'stat-label' }, 'File Watchers')
            ),
            React.createElement('div', { className: 'stat-card' },
              React.createElement('div', { className: 'stat-value' }, data.webhookAgents),
              React.createElement('div', { className: 'stat-label' }, 'Webhooks')
            )
          ),
          React.createElement('div', { className: 'section' },
            React.createElement('h2', { className: 'section-title' }, 'Agents'),
            data.agents.length === 0 
              ? React.createElement('div', { className: 'no-agents' }, 'No agents registered')
              : React.createElement('div', { className: 'agent-list' },
                  data.agents.map(agent => 
                    React.createElement('div', { key: agent.name, className: 'agent-card' },
                      React.createElement('div', { className: 'agent-name' }, agent.name),
                      React.createElement('div', { className: 'agent-details' },
                        agent.schedule && React.createElement('div', { className: 'detail-item' },
                          React.createElement('span', { className: 'badge schedule' }, 'Schedule'),
                          React.createElement('span', { className: 'detail-value' }, agent.schedule)
                        ),
                        agent.watch && agent.watch.length > 0 && React.createElement('div', { className: 'detail-item' },
                          React.createElement('span', { className: 'badge watch' }, 'Watching'),
                          React.createElement('span', { className: 'detail-value' }, agent.watch.join(', '))
                        ),
                        agent.webhook && React.createElement('div', { className: 'detail-item' },
                          React.createElement('span', { className: 'badge webhook' }, 'Webhook'),
                          React.createElement('span', { className: 'detail-value' }, agent.webhook)
                        )
                      )
                    )
                  )
                )
          )
        ),
        React.createElement('button', {
          className: 'refresh-btn',
          onClick: refresh,
          disabled: loading,
          title: 'Refresh Status'
        }, loading ? '⏳' : '🔄')
      );
    }
    
    ReactDOM.render(React.createElement(App), document.getElementById('root'));
  </script>
</body>
</html>`;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Clean up cron jobs
    for (const cleanup of this.cronJobs.values()) {
      cleanup();
    }
    this.cronJobs.clear();
    this.scheduler.clearAll();
    
    // Stop file watchers
    for (const [agentName, patterns] of this.fileWatchers) {
      for (const pattern of patterns) {
        this.files.unwatch(pattern);
      }
    }
    this.fileWatchers.clear();

    // Stop webhook server
    if (this.webhookServer) {
      this.webhookServer.stop();
      this.webhookServer = null;
    }
    
    this.agents.clear();
    this.webhookRoutes.clear();
  }
}
