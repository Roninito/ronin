import type { DutyMetadata } from "../types/duty.js";
import type { FilesAPI } from "../api/files.js";
import type { HTTPAPI } from "../api/http.js";
import type { EventsAPI } from "../api/events.js";
import { CronScheduler } from "./CronScheduler.js";
import { logger } from "../utils/logger.js";
import { join } from "path";
import { networkInterfaces } from "os";
import { existsSync, rmSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { getAdobeCleanFontFaceCSS, getThemeCSS, getHeaderBarCSS, getHeaderHomeIconHTML, getHeaderHomeIconSVG, hankoTheme } from "../utils/theme.js";
import { getConfigService } from "../config/ConfigService.js";
import { discoverRoutes, startMenubar, stopMenubar } from "../os/index.js";
import { Executor } from "../executor/Executor.js";
import { Chain } from "../chain/Chain.js";
import { MiddlewareStack } from "../middleware/MiddlewareStack.js";
import type { ChainContext } from "../chain/types.js";
import {
  createChainLoggingMiddleware,
  createSmartTrimMiddleware,
  createTokenGuardMiddleware,
  createExecutionTrackingMiddleware,
  createModelResolutionMiddleware,
  createWorkflowContextMiddleware,
} from "../middleware/index.js";
import { modelSelector } from "../../plugins/model-selector.js";
import { RouteGuard } from "../../plugins/cloudflare/src/RouteGuard.js";

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

type HomeFeedPayload = {
  duty?: unknown;
  html?: unknown;
  title?: unknown;
  priority?: unknown;
  updatedAt?: unknown;
};

type HomeFeedItem = {
  duty: string;
  html: string;
  title?: string;
  priority: number;
  updatedAt: number;
};

/**
 * Manages duty registration, scheduling, and event handling
 */
export class DutyRegistry {
  private duties: Map<string, DutyMetadata> = new Map();
  private cronJobs: Map<string, () => void> = new Map(); // Track scheduled duties and cleanup functions
  private fileWatchers: Map<string, string[]> = new Map(); // duty name -> patterns
  private webhookRoutes: Map<string, string> = new Map(); // path -> duty name
  private webhookServer: ReturnType<typeof Bun.serve> | null = null;
  private files: FilesAPI;
  private http: HTTPAPI;
  private events?: EventsAPI;
  private scheduler: CronScheduler;
  private webhookHost?: string;
  private dependenciesInstalling = false;
  private homeFeeds: Map<string, HomeFeedItem> = new Map();
  private routeGuard: RouteGuard;

  constructor(options: RegistryOptions) {
    this.files = options.files;
    this.http = options.http;
    this.events = options.events;
    this.webhookHost = options.webhookHost;
    this.scheduler = new CronScheduler();
    this.routeGuard = new RouteGuard();
    this.registerHomeFeedListener();
  }

  private registerHomeFeedListener(): void {
    if (!this.events) return;
    this.events.on("home-feed", (payload: unknown) => {
      this.upsertHomeFeed(payload as HomeFeedPayload);
    });
  }

  private upsertHomeFeed(payload: HomeFeedPayload): void {
    const duty = String(payload?.duty ?? "").trim();
    const html = String(payload?.html ?? "");
    if (!duty || !html) return;
    const title = payload?.title == null ? undefined : String(payload.title);
    const parsedPriority = Number(payload?.priority);
    const priority = Number.isFinite(parsedPriority) ? parsedPriority : 0;
    const parsedUpdatedAt = Number(payload?.updatedAt);
    const updatedAt = Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : Date.now();
    const cappedHtml = html.length > 32768 ? html.slice(0, 32768) : html;
    this.homeFeeds.set(duty.toLowerCase(), {
      duty,
      html: cappedHtml,
      title,
      priority,
      updatedAt,
    });
  }

  private getHomeFeedItems(): HomeFeedItem[] {
    return Array.from(this.homeFeeds.values())
      .sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.updatedAt - a.updatedAt;
      });
  }

  /**
   * Register an duty
   */
  register(duty: DutyMetadata): void {
    this.duties.set(duty.name, duty);

    // Register schedule if present
    if (duty.schedule) {
      this.registerSchedule(duty.name, duty.schedule);
    }

    // Register file watchers if present
    if (duty.watch && duty.watch.length > 0) {
      this.registerFileWatchers(duty.name, duty.watch);
    }

    // Register webhook if present
    if (duty.webhook) {
      this.registerWebhook(duty.name, duty.webhook);
    }
  }

  /**
   * Register all dutys
   */
  registerAll(dutys: DutyMetadata[]): void {
    for (const duty of dutys) {
      this.register(duty);
    }
  }

  /**
   * Get an duty by name
   */
  get(dutyName: string): DutyMetadata | undefined {
    return this.duties.get(dutyName);
  }

  /**
   * Execute a duty manually with SAR envelope
   * 
   * Every duty execution is wrapped in a SAR chain with:
   * - Logging middleware (for observability)
   * - Token guard (budget enforcement)
   * - Execution tracking (metrics)
   * - Smart trim (context management)
   * 
   * This ensures all duties have consistent governance without requiring
   * each duty to implement SAR explicitly.
   */
  async executeDuty(dutyName: string): Promise<void> {
    const duty = this.duties.get(dutyName);
    if (!duty) {
      throw new Error(`Duty not found: ${dutyName}`);
    }

    const startTime = Date.now();
    const dutyInstance = duty.instance;
    
    // Check if duty already uses SAR (has middleware attached)
    const hasSAR = (dutyInstance as any).middleware && (dutyInstance as any).executor;
    
    if (hasSAR) {
      // Duty already has SAR - execute directly
      logger.info("Duty has SAR middleware, executing directly", { duty: dutyName });
      await dutyInstance.execute();
    } else {
      // Wrap in SAR envelope
      try {
        const config = getConfigService();
        const aiConfig = config.getAI();
        
        // Create executor with duty's API
        const executor = new Executor(dutyInstance.api as any);
        
        // Build middleware stack (lightweight SAR envelope)
        const stack = new MiddlewareStack<ChainContext>();
        
        // Add logging for observability
        stack.use(createChainLoggingMiddleware({ level: "info" }));
        
        // Add model resolution using model-selector plugin
        stack.use(createModelResolutionMiddleware(modelSelector as any));
        
        // Add context trimming (keep last 50 messages)
        stack.use(createSmartTrimMiddleware({ recentCount: 50 }));
        
        // Add token budget (default 12000, configurable via duty.maxTokens)
        const maxTokens = (dutyInstance as any).maxTokens ?? 12000;
        stack.use(createTokenGuardMiddleware({ maxTokens }));

        // Pull in a matching workflows/*.md guidance doc, if any (no-op otherwise)
        stack.use(createWorkflowContextMiddleware());

        // Add execution tracking for metrics
        stack.use(createExecutionTrackingMiddleware());

        // Create chain for this duty execution
        const chain = new Chain(executor, stack, `duty:${dutyName}`);

        // Initialize context with duty metadata
        chain.withContext({
          messages: [],
          metadata: {
            dutyName,
            dutyDescription: duty.description,
            executionType: "manual",
            startTime,
          },
        } as any);
        
        // The SAR chain wraps the execution:
        // SENSE: Context setup via chain.withContext
        // ANALYZE: Model resolution and trimming
        // RESPOND: duty.execute()
        
        // Run the chain to completion (executes middleware)
        await chain.run();
        
        // Now execute the actual duty logic
        await dutyInstance.execute();
        
        const duration = Date.now() - startTime;
        logger.info("Duty executed via SAR envelope", {
          duty: dutyName,
          duration,
          sarWrapped: true,
          maxTokens,
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error("Duty execution failed", {
          duty: dutyName,
          error: error instanceof Error ? error.message : String(error),
          duration,
        });
        throw error;
      }
    }
  }

  /**
   * Unregister a duty by name
   */
  unregister(dutyName: string): boolean {
    const duty = this.duties.get(dutyName);
    if (!duty) {
      return false;
    }

    // Clean up cron job
    const cronCleanup = this.cronJobs.get(dutyName);
    if (cronCleanup) {
      cronCleanup();
      this.cronJobs.delete(dutyName);
    }

    // Clean up file watchers
    const patterns = this.fileWatchers.get(dutyName);
    if (patterns) {
      for (const pattern of patterns) {
        this.files.unwatch(pattern);
      }
      this.fileWatchers.delete(dutyName);
    }

    // Clean up webhook route
    if (duty.webhook) {
      this.webhookRoutes.delete(duty.webhook);
    }

    // Remove from dutys map
    this.duties.delete(dutyName);

    logger.info("Duty unregistered", { duty: dutyName });
    return true;
  }

  /**
   * Register a cron schedule for an duty
   */
  private registerSchedule(dutyName: string, schedule: string): void {
    const duty = this.duties.get(dutyName);
    if (!duty) return;

    // Create a cron job using our scheduler
    const cleanup = this.scheduler.schedule(schedule, () => {
      this.executeDuty(dutyName).catch(error => {
        logger.error("Scheduled duty execution failed", { duty: dutyName, error });
      });
    });

    this.cronJobs.set(dutyName, cleanup);
    logger.debug("Registered schedule", { duty: dutyName, schedule });
  }

  /**
   * Register file watchers for an duty
   */
  private registerFileWatchers(dutyName: string, patterns: string[]): void {
    const duty = this.duties.get(dutyName);
    if (!duty) return;

    for (const pattern of patterns) {
      this.files.watch(pattern, async (path: string, event: string) => {
        if (duty.instance.onFileChange) {
          try {
            await duty.instance.onFileChange(
              path,
              event as "create" | "update" | "delete"
            );
          } catch (error) {
            logger.error("File change handler failed", { duty: dutyName, error });
          }
        }
      });
    }

    this.fileWatchers.set(dutyName, patterns);
    logger.debug("Registered file watchers", { duty: dutyName, patterns });
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
   * Register a webhook route for an duty
   */
  private registerWebhook(dutyName: string, path: string): void {
    this.webhookRoutes.set(path, dutyName);
    logger.debug("Registered webhook", { duty: dutyName, path });

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
      fetch: async (req, server) => {
        const url = new URL(req.url);
        const path = url.pathname;

        // Cloudflare route whitelist/block/auth enforcement — a no-op unless
        // the user has opted in by running `ronin cloudflare route init`
        // (RouteGuard.handle() 403s everything when no policy file exists, so
        // it must never be called unconditionally). Once opted in, this gates
        // ALL traffic on this port uniformly, local requests included — see
        // docs/REMOTE_ACCESS.md for which routes to whitelist.
        if (await this.routeGuard.hasPolicy()) {
          const blocked = await this.routeGuard.handle(req, "default");
          if (blocked) return blocked;
        }

        // WebSocket upgrade — duties register via this.api.http.registerWebSocket(path, handlers);
        // checked early so it isn't shadowed by any of the ~25 hardcoded HTTP branches below.
        if (this.http.getWebSocketPaths?.().has(path)) {
          const upgraded = server.upgrade(req, { data: { path } });
          if (upgraded) return undefined;
        }

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

        if (path === "/skills" || path === "/skills/") {
          return new Response(await this.getSkillsHTML(port), {
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

        if (path === "/api/home-feed" && req.method === "GET") {
          return Response.json(this.getHomeFeedItems(), {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (path.startsWith("/api/home-feed/") && req.method === "DELETE") {
          const dutyKey = decodeURIComponent(path.slice("/api/home-feed/".length)).trim().toLowerCase();
          if (!dutyKey) {
            return Response.json({ success: false, error: "duty key required" }, { status: 400 });
          }
          const existed = this.homeFeeds.delete(dutyKey);
          return Response.json({ success: existed, removed: dutyKey }, {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (path === "/api/skills/list" && req.method === "GET") {
          return Response.json(await this.getLocalSkillsList(), {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (path === "/api/skills/install" && req.method === "POST") {
          try {
            const body = await req.json() as { repo?: string; name?: string };
            const repo = String(body.repo ?? "").trim();
            const name = String(body.name ?? "").trim();
            if (!repo) return Response.json({ success: false, error: "repo is required" }, { status: 400 });
            const args = ["skills", "install", repo];
            if (name) args.push("--name", name);
            const result = this.runRoninCommand(args);
            return Response.json({
              success: result.ok,
              output: result.stdout || result.stderr,
            }, {
              status: result.ok ? 200 : 500,
              headers: { "Content-Type": "application/json" },
            });
          } catch {
            return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
          }
        }

        if (path === "/api/skills/update" && req.method === "POST") {
          try {
            const body = await req.json() as { name?: string };
            const name = String(body.name ?? "").trim();
            if (!name) return Response.json({ success: false, error: "name is required" }, { status: 400 });
            const result = this.runRoninCommand(["skills", "update", name]);
            return Response.json({
              success: result.ok,
              output: result.stdout || result.stderr,
            }, {
              status: result.ok ? 200 : 500,
              headers: { "Content-Type": "application/json" },
            });
          } catch {
            return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
          }
        }

        if (path === "/api/skills/remove" && req.method === "POST") {
          try {
            const body = await req.json() as { name?: string };
            const name = String(body.name ?? "").trim();
            if (!name) return Response.json({ success: false, error: "name is required" }, { status: 400 });
            const skillsDir = join(process.env.HOME || "", ".ronin", "skills", name);
            if (!existsSync(skillsDir)) {
              return Response.json({ success: false, error: `Skill folder not found: ${skillsDir}` }, { status: 404 });
            }
            rmSync(skillsDir, { recursive: true, force: true });
            return Response.json({ success: true });
          } catch (error) {
            return Response.json({
              success: false,
              error: `Failed to remove skill: ${error instanceof Error ? error.message : String(error)}`,
            }, { status: 500 });
          }
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

        if (path === "/api/bootstrap/dependencies" && req.method === "GET") {
          const dependencyStatus = await this.getDependencyBootstrapStatus();
          const onboardingComplete = await this.isOnboardingComplete();
          return Response.json({
            ...dependencyStatus,
            onboardingComplete,
          }, {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (path === "/api/bootstrap/install" && req.method === "POST") {
          if (this.dependenciesInstalling) {
            return Response.json({ success: false, error: "Dependency installation already in progress." }, { status: 409 });
          }
          this.dependenciesInstalling = true;
          try {
            const installResult = await this.installMissingDependencies();
            return Response.json(installResult, {
              headers: { "Content-Type": "application/json" },
            });
          } finally {
            this.dependenciesInstalling = false;
          }
        }

        if (path === "/api/system/restart" && req.method === "POST") {
          try {
            const child = spawn("bun", ["run", "ronin", "restart"], {
              cwd: process.cwd(),
              detached: true,
              stdio: "ignore",
              env: process.env,
            });
            child.unref();
            setTimeout(() => process.exit(0), 1200);
            return Response.json({ success: true, restarting: true }, {
              headers: { "Content-Type": "application/json" },
            });
          } catch (error) {
            return Response.json({
              success: false,
              error: `Failed to trigger restart: ${error instanceof Error ? error.message : String(error)}`,
            }, { status: 500 });
          }
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
            if (event === "home-feed" && payload && typeof payload === "object" && !("duty" in (payload as Record<string, unknown>))) {
              (payload as Record<string, unknown>).duty = eventSource;
            }
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

        // Check HTTP API registered routes (dutys can register routes via this.api.http.registerRoute)
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

        // Duty webhook routes - try exact match first, then prefix match
        let dutyName = this.webhookRoutes.get(path);
        
        // If no exact match, try prefix matching (for sub-routes like /webhook/api/data)
        if (!dutyName) {
          for (const [webhookPath, name] of this.webhookRoutes.entries()) {
            if (path.startsWith(webhookPath + "/") || path === webhookPath) {
              dutyName = name;
              break;
            }
          }
        }
        
        if (!dutyName) {
          return new Response("Not Found", { status: 404 });
        }

        const duty = this.duties.get(dutyName);
        if (!duty) {
          return new Response("Duty not found", { status: 404 });
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
          if (duty.instance.onWebhook) {
            // Pass request object with full context to the webhook handler
            const requestInfo = {
              url: req.url,
              method: req.method,
              headers: Object.fromEntries(req.headers.entries()),
              payload,
            };
            result = await duty.instance.onWebhook(requestInfo);
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
          logger.error("Webhook handler failed", { duty: dutyName, error });
          return new Response(
            JSON.stringify({ error: String(error) }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
      websocket: {
        open: (ws: any) => {
          this.http.getWebSocketHandlers(ws.data?.path)?.open?.(ws);
        },
        message: (ws: any, message: string | Buffer) => {
          this.http.getWebSocketHandlers(ws.data?.path)?.message?.(ws, message);
        },
        close: (ws: any, code: number, reason: string) => {
          this.http.getWebSocketHandlers(ws.data?.path)?.close?.(ws, code, reason);
        },
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
   * Get all registered dutys
   */
  getDuties(): DutyMetadata[] {
    return Array.from(this.duties.values());
  }

  /**
   * Get duty by name
   */
  getDuty(name: string): DutyMetadata | undefined {
    return this.duties.get(name);
  }

  /**
   * Get duty status information
   */
  getStatus(): {
    totalDuties: number;
    scheduledDuties: number;
    watchedDuties: number;
    webhookDuties: number;
  }

  getStatus(): StatusInfo {
    const dutys = this.getDuties();

    return {
      totalDuties: dutys.length,
      scheduledDuties: dutys.filter(d => d.schedule).length,
      watchedDuties: dutys.filter(d => d.watch && d.watch.length > 0).length,
      webhookDuties: dutys.filter(d => d.webhook).length,
      dutys: dutys.map(a => ({
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
    addRoute("/skills", "system", "Skills management");
    addRoute("/status", "system", "Status UI");
    addRoute("/api/status", "system", "Status JSON");
    addRoute("/health", "system", "Health check");
    addRoute("/api/health", "system", "Health check JSON");
    addRoute("/api/routes", "system", "List registered routes");
    addRoute("/api/skills/list", "system", "List local skills");
    addRoute("/api/skills/install", "system", "Install skill");
    addRoute("/api/skills/update", "system", "Update skill");
    addRoute("/api/skills/remove", "system", "Remove skill");

    // HTTP API routes (duty-registered)
    for (const path of this.http.getAllRoutes().keys()) {
      addRoute(path, "http", "Duty-registered HTTP route");
    }

    // Webhook routes
    for (const [path, dutyName] of this.webhookRoutes.entries()) {
      addRoute(path, "webhook", `Webhook for ${dutyName}`);
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
    const defaults = ["/chat", "/analytics", "/config", "/skills", "/routes", "/contracts", "/duties/review", "/canvas"];
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

  private runRoninCommand(args: string[]): { ok: boolean; stdout: string; stderr: string } {
    const result = spawnSync("bun", ["run", "ronin", ...args], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    return {
      ok: result.status === 0,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    };
  }

  private async getLocalSkillsList(): Promise<Array<{ name: string; description: string }>> {
    const command = this.runRoninCommand(["skills", "discover", "*", "--no-remote"]);
    if (!command.ok) return [];
    try {
      const parsed = JSON.parse(command.stdout) as Array<{ name?: unknown; description?: unknown }>;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((s) => ({
          name: String(s.name ?? "").trim(),
          description: String(s.description ?? "").trim(),
        }))
        .filter((s) => s.name.length > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  private async getSkillsHTML(port: number): Promise<string> {
    const skills = await this.getLocalSkillsList();
    const rows = skills.map((skill) => `
      <tr>
        <td>${this.escapeHtml(skill.name)}</td>
        <td>${this.escapeHtml(skill.description || "(no description)")}</td>
        <td style="display:flex;gap:.35rem;">
          <button class="btn btn-secondary" onclick="updateSkill(decodeURIComponent('${encodeURIComponent(skill.name)}'))">Update</button>
          <button class="btn btn-danger" onclick="removeSkill(decodeURIComponent('${encodeURIComponent(skill.name)}'))">Remove</button>
        </td>
      </tr>
    `).join("");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ronin Skills</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    ${getHeaderBarCSS()}
    body { margin:0; background:${hankoTheme.colors.background}; color:${hankoTheme.colors.textPrimary}; font-family:${hankoTheme.fonts.primary}; }
    .container { max-width: 1200px; margin: 0 auto; padding: 1rem; }
    .card { background: ${hankoTheme.colors.backgroundSecondary}; border: 1px solid ${hankoTheme.colors.border}; border-radius: ${hankoTheme.borderRadius.lg}; padding: .85rem; margin-bottom: .75rem; }
    .toolbar { display:flex; gap:.5rem; align-items:center; flex-wrap:wrap; }
    .toolbar input { background:${hankoTheme.colors.background}; color:${hankoTheme.colors.textPrimary}; border:1px solid ${hankoTheme.colors.border}; padding:.45rem .55rem; border-radius:4px; min-width:280px; }
    .btn { background:${hankoTheme.colors.backgroundTertiary}; color:${hankoTheme.colors.textPrimary}; border:1px solid ${hankoTheme.colors.border}; padding:.45rem .65rem; border-radius:4px; cursor:pointer; transition: background 150ms ease, border-color 150ms ease; }
    .btn:hover { background:${hankoTheme.colors.accent}; border-color:${hankoTheme.colors.accent}; }
    .btn-secondary { background:${hankoTheme.colors.backgroundSecondary}; }
    .btn-danger { background:${hankoTheme.colors.error}33; border-color:${hankoTheme.colors.error}; }
    table { width:100%; border-collapse: collapse; font-size:.86rem; }
    th, td { text-align:left; border-bottom:1px solid ${hankoTheme.colors.border}; padding:.55rem .45rem; vertical-align:top; }
    th { color: ${hankoTheme.colors.textSecondary}; text-transform: uppercase; letter-spacing:.06em; font-size:.72rem; }
    .muted { color: ${hankoTheme.colors.textSecondary}; font-size:.78rem; }
    .status { margin-top:.5rem; font-size:.78rem; color:${hankoTheme.colors.success}; min-height:1.1rem; }
  </style>
</head>
<body>
  <div class="header">${getHeaderHomeIconHTML()}<h1>Skills</h1><div class="header-meta"><span>${skills.length} local skills</span><span>Port ${port}</span></div></div>
  <div class="container">
    <div class="card">
      <div class="toolbar">
        <input id="repoInput" type="text" placeholder="Git repo URL or skills.sh:owner/repo/skill" />
        <input id="nameInput" type="text" placeholder="Optional local name" />
        <button class="btn" onclick="installSkill()">Install</button>
        <button class="btn btn-secondary" onclick="refreshSkills()">Refresh</button>
      </div>
      <div class="status" id="statusText"></div>
      <div class="muted">Uses Ronin CLI skill commands for list/install/update/remove.</div>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Description</th><th>Manage</th></tr></thead>
        <tbody id="skillsTbody">${rows || `<tr><td colspan="3" class="muted">No local skills found.</td></tr>`}</tbody>
      </table>
    </div>
  </div>
  <script>
    const statusEl = document.getElementById('statusText');
    function esc(v){return String(v||'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
    function setStatus(msg, isError = false) {
      if (!statusEl) return;
      statusEl.style.color = isError ? '#ff9e9e' : '#b5e48c';
      statusEl.textContent = msg || '';
    }
    async function refreshSkills() {
      const res = await fetch('/api/skills/list');
      const list = await res.json();
      const tbody = document.getElementById('skillsTbody');
      if (!tbody) return;
      if (!Array.isArray(list) || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="muted">No local skills found.</td></tr>';
        return;
      }
      tbody.innerHTML = list.map((s) => \`
        <tr>
          <td>\${esc(s.name)}</td>
          <td>\${esc(s.description || '(no description)')}</td>
          <td style="display:flex;gap:.35rem;">
            <button class="btn btn-secondary" onclick="updateSkill('\${String(s.name || '').replace(/'/g, "\\\\'")}')">Update</button>
            <button class="btn btn-danger" onclick="removeSkill('\${String(s.name || '').replace(/'/g, "\\\\'")}')">Remove</button>
          </td>
        </tr>\`).join('');
    }
    async function installSkill() {
      const repo = document.getElementById('repoInput')?.value?.trim();
      const name = document.getElementById('nameInput')?.value?.trim();
      if (!repo) return setStatus('Repo is required.', true);
      setStatus('Installing skill...');
      const res = await fetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, name })
      });
      const data = await res.json();
      if (!res.ok || !data.success) return setStatus(data.error || data.output || 'Install failed', true);
      setStatus('Skill installed.');
      await refreshSkills();
    }
    async function updateSkill(name) {
      setStatus('Updating ' + name + '...');
      const res = await fetch('/api/skills/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok || !data.success) return setStatus(data.error || data.output || 'Update failed', true);
      setStatus('Skill updated: ' + name);
      await refreshSkills();
    }
    async function removeSkill(name) {
      if (!confirm('Remove skill "' + name + '"?')) return;
      setStatus('Removing ' + name + '...');
      const res = await fetch('/api/skills/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok || !data.success) return setStatus(data.error || 'Remove failed', true);
      setStatus('Skill removed: ' + name);
      await refreshSkills();
    }
  </script>
</body>
</html>`;
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
    const onboardingComplete = await this.isOnboardingComplete();
    const homeFeedItems = this.getHomeFeedItems();

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
    body { margin: 0; background: ${hankoTheme.colors.background}; color: ${hankoTheme.colors.textPrimary}; font-family: ${hankoTheme.fonts.primary}; }
    .shell { max-width: 1320px; margin: 0 auto; padding: 1rem; display: grid; grid-template-columns: 220px minmax(0,1fr); gap: .75rem; }
    .dashboard-nav { background: ${hankoTheme.colors.backgroundSecondary}; border: 1px solid ${hankoTheme.colors.border}; border-radius: 6px; padding: .65rem; position: sticky; top: 8px; margin-top: 11px; z-index: 1100; height: fit-content; }
    .dashboard-nav h2 { margin: 0 0 .55rem; font-size: .7rem; color: ${hankoTheme.colors.textSecondary}; text-transform: uppercase; letter-spacing: .1em; }
    .dashboard-nav a { display:block; color:${hankoTheme.colors.textSecondary}; text-decoration:none; font-size:.74rem; font-weight:700; padding:.42rem .5rem; border-radius:4px; border:1px solid transparent; margin-bottom:.2rem; transition: background 150ms ease, border-color 150ms ease, color 150ms ease; }
    .dashboard-nav a:hover { background: ${hankoTheme.colors.accent}1a; border-color: ${hankoTheme.colors.accent}59; color:${hankoTheme.colors.textPrimary}; }
    .page { min-width: 0; }
    .loading-screen { position: fixed; inset: 0; background: radial-gradient(circle at 50% 35%, ${hankoTheme.colors.accent}22, transparent 45%), ${hankoTheme.colors.background}; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem; transition: opacity .45s ease; }
    .loading-screen.hidden { opacity: 0; pointer-events: none; }
    .spinner { width: 28px; height: 28px; background: ${hankoTheme.colors.accent}; transform: rotate(45deg); animation: diamondSpin 1.1s ease-in-out infinite; }
    .loading-title { font-size: 0.9rem; letter-spacing: .16em; text-transform: uppercase; color: ${hankoTheme.colors.textPrimary}; }
    @keyframes diamondSpin { 0%, 100% { transform: rotate(45deg) scale(1); opacity: 1; } 50% { transform: rotate(45deg) scale(0.82); opacity: 0.6; } }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: .35rem; margin: .75rem 0; }
    .card { background: ${hankoTheme.colors.backgroundSecondary}; border: 1px solid ${hankoTheme.colors.border}; border-radius: ${hankoTheme.borderRadius.md}; padding: .8rem; }
    .label { color: ${hankoTheme.colors.textSecondary}; font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; }
    .value { font-size: 1.35rem; margin-top: .3rem; }
    .content { display: grid; grid-template-columns: 2fr 1fr; gap: .35rem; }
    .home-feed { margin-top: .55rem; }
    .home-feed-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px,1fr)); gap: .35rem; }
    .home-feed-card { background: ${hankoTheme.colors.backgroundSecondary}; border: 1px solid ${hankoTheme.colors.border}; border-radius: ${hankoTheme.borderRadius.md}; padding: .8rem; min-height: 120px; overflow: hidden; }
    .home-feed-meta { display:flex; gap:.45rem; align-items:center; margin-bottom:.5rem; color: ${hankoTheme.colors.textSecondary}; font-size:.7rem; text-transform: uppercase; letter-spacing:.07em; }
    .panel-title { margin: 0 0 .45rem; font-size: .9rem; }
    .panel-actions a { color: ${hankoTheme.colors.link}; text-decoration: none; font-size: .8rem; margin-right: .8rem; }
    .loading-subtitle { color: ${hankoTheme.colors.textSecondary}; font-size: .78rem; max-width: 460px; text-align: center; line-height: 1.35; min-height: 2rem; }
    .onboarding-banner { border: 1px solid ${hankoTheme.colors.warning}73; background: ${hankoTheme.colors.warning}17; color: ${hankoTheme.colors.warning}; padding: .65rem .8rem; margin-bottom: .55rem; font-size: .84rem; }
    .onboarding-banner a { color: ${hankoTheme.colors.warning}; text-decoration: underline; font-weight: 700; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: ${hankoTheme.fonts.mono}; font-size: .74rem; color: ${hankoTheme.colors.textSecondary}; }
    @media (max-width: 980px){ .shell{grid-template-columns:1fr;} .dashboard-nav{position:static;} .grid{grid-template-columns:repeat(2,minmax(0,1fr));} .content{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <div id="loadingScreen" class="loading-screen"><div class="spinner"></div><div class="loading-title">Initializing Ronin Dashboard</div><div id="loadingSubtitle" class="loading-subtitle">Checking required dependencies...</div></div>
  <div class="header">${getHeaderHomeIconHTML()}<h1>DASH</h1><div class="header-meta"><span>Runtime overview</span></div></div>
  <div class="shell">
    <aside class="dashboard-nav">
      <h2>DASH</h2>
      ${dashboardNavRoutes.map((route) => `<a href="${route}">${this.escapeHtml(formatDashNavRoute(route))}</a>`).join("")}
    </aside>
    <div class="page">
    ${!onboardingComplete ? `<div class="onboarding-banner">Onboarding is not complete. Please finish setup at <a href="/onboarding">/onboarding</a> to unlock all features.</div>` : ""}
    <div class="grid">
      <div class="card"><div class="label">Duties</div><div class="value">${status.totalDuties}</div></div>
      <div class="card"><div class="label">Scheduled</div><div class="value">${status.scheduledDuties}</div></div>
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
    <div class="home-feed card">
      <h2 class="panel-title">Duty Feed</h2>
      ${homeFeedItems.length > 0 ? `
      <div class="home-feed-grid">
        ${homeFeedItems.map((item) => `
        <div class="home-feed-card">
          <div class="home-feed-meta"><span>${this.escapeHtml(item.duty)}</span><span>${new Date(item.updatedAt).toLocaleTimeString()}</span></div>
          ${item.html}
        </div>`).join("")}
      </div>` : `<div class="label">No duty feed items yet. Emit <code>home-feed</code> events to populate this section.</div>`}
    </div>
    </div>
  </div>
  <script>
    const subtitle = document.getElementById('loadingSubtitle');
    const loadingEl = document.getElementById('loadingScreen');
    async function runBootstrapChecks() {
      try {
        if (subtitle) subtitle.textContent = 'Checking required dependencies...';
        const statusRes = await fetch('/api/bootstrap/dependencies');
        const status = await statusRes.json();
        if (Array.isArray(status.missing) && status.missing.length > 0) {
          if (subtitle) subtitle.textContent = 'Installing missing dependencies: ' + status.missing.join(', ');
          const installRes = await fetch('/api/bootstrap/install', { method: 'POST' });
          const install = await installRes.json();
          if (install && install.success && install.restartRequired) {
            if (subtitle) subtitle.textContent = 'Dependencies installed. Restarting Ronin...';
            await fetch('/api/system/restart', { method: 'POST' });
            return;
          }
          if (subtitle && install && install.success) {
            subtitle.textContent = 'Dependency check complete.';
          } else if (subtitle) {
            subtitle.textContent = 'Some dependencies failed to install automatically. Check logs.';
          }
        } else {
          if (subtitle) subtitle.textContent = 'Dependencies OK.';
        }
      } catch (e) {
        if (subtitle) subtitle.textContent = 'Dependency check failed; continuing startup.';
      } finally {
        window.setTimeout(() => {
          if (loadingEl) loadingEl.classList.add('hidden');
        }, 900);
      }
    }
    runBootstrapChecks();
  </script>
</body>
</html>`;
  }

  private async isOnboardingComplete(): Promise<boolean> {
    try {
      const setupPath = join(process.env.HOME || "", ".ronin", "setup.json");
      if (!existsSync(setupPath)) return false;
      const parsed = JSON.parse(await Bun.file(setupPath).text()) as { completed?: unknown };
      return parsed.completed === true;
    } catch {
      return false;
    }
  }

  private getDependencyChecks(): Array<{
    id: string;
    label: string;
    isInstalled: () => boolean;
    install: () => { ok: boolean; output: string };
  }> {
    const hasCommand = (cmd: string): boolean =>
      spawnSync("bash", ["-lc", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;

    return [
      {
        id: "piper",
        label: "piper",
        isInstalled: () => hasCommand("piper"),
        install: () => {
          if (!hasCommand("brew")) return { ok: false, output: "Homebrew not found for installing piper." };
          const res = spawnSync("bash", ["-lc", "brew install piper"], { encoding: "utf8" });
          return { ok: res.status === 0, output: `${res.stdout || ""}\n${res.stderr || ""}`.trim() };
        },
      },
      {
        id: "whisper",
        label: "whisper-cli",
        isInstalled: () => hasCommand("whisper-cli"),
        install: () => {
          if (!hasCommand("brew")) return { ok: false, output: "Homebrew not found for installing whisper-cpp." };
          const res = spawnSync("bash", ["-lc", "brew install whisper-cpp"], { encoding: "utf8" });
          return { ok: res.status === 0, output: `${res.stdout || ""}\n${res.stderr || ""}`.trim() };
        },
      },
      {
        id: "duty-browser",
        label: "duty-browser skill",
        isInstalled: () => existsSync(join(process.cwd(), "skills", "duty-browser", "SKILL.md"))
          || existsSync(join(process.cwd(), "skills", "duty-browser", "skill.md")),
        install: () => {
          const res = spawnSync("bash", ["-lc", "npx -y skills add vercel-labs/duty-browser"], { encoding: "utf8" });
          return { ok: res.status === 0, output: `${res.stdout || ""}\n${res.stderr || ""}`.trim() };
        },
      },
    ];
  }

  private async getDependencyBootstrapStatus(): Promise<{
    missing: string[];
    checks: Array<{ id: string; label: string; installed: boolean }>;
  }> {
    const checks = this.getDependencyChecks().map((check) => ({
      id: check.id,
      label: check.label,
      installed: check.isInstalled(),
    }));
    return {
      missing: checks.filter((c) => !c.installed).map((c) => c.id),
      checks,
    };
  }

  private async installMissingDependencies(): Promise<{
    success: boolean;
    installed: string[];
    failed: string[];
    restartRequired: boolean;
    logs: Array<{ id: string; ok: boolean; output: string }>;
  }> {
    const checks = this.getDependencyChecks();
    const missing = checks.filter((check) => !check.isInstalled());
    const logs: Array<{ id: string; ok: boolean; output: string }> = [];
    const installed: string[] = [];
    const failed: string[] = [];

    for (const check of missing) {
      const result = check.install();
      logs.push({ id: check.id, ok: result.ok, output: result.output });
      if (result.ok && check.isInstalled()) {
        installed.push(check.id);
      } else {
        failed.push(check.id);
      }
    }

    return {
      success: failed.length === 0,
      installed,
      failed,
      restartRequired: installed.length > 0,
      logs,
    };
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
      if (description && description !== "Duty-registered HTTP route") {
        // Extract title from description if it's descriptive
        if (description.includes("Webhook for")) {
          return description.replace("Webhook for ", "") + " Webhook";
        }
        if (description.includes("Home dashboard")) return "Home Dashboard";
        if (description.includes("Routes dashboard")) return "Routes Dashboard";
        if (description.includes("Skills management")) return "Skills Manager";
        if (description.includes("Status UI")) return "Status Dashboard";
        if (description.includes("Status JSON")) return "Status API";
        if (description.includes("Health check")) return "Health Check";
        if (description.includes("List registered routes")) return "Routes API";
      }
      
      // Generate title from path
      if (path === "/") return "Home Dashboard";
      if (path === "/routes") return "Routes Dashboard";
      if (path === "/skills") return "Skills Manager";
      if (path === "/status") return "Status Dashboard";
      if (path.startsWith("/api/")) {
        const apiName = path.replace("/api/", "").split("/")[0];
        return apiName.charAt(0).toUpperCase() + apiName.slice(1) + " API";
      }
      if (type === "webhook") {
        const dutyName = this.webhookRoutes.get(path);
        return dutyName ? `${dutyName} Webhook` : "Webhook";
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
      if (description && description !== "Duty-registered HTTP route") {
        return description;
      }
      
      if (type === "system") {
        if (path === "/") return "Main dashboard with runtime stats, logs, and analytics";
        if (path === "/routes") return "Routes dashboard";
        if (path === "/skills") return "Manage local and remote skills";
        if (path === "/status") return "View system status, dutys, and runtime information";
        if (path === "/api/status") return "Get system status as JSON";
        if (path === "/api/health" || path === "/health") return "Simple health check endpoint";
        if (path === "/api/routes") return "List all registered routes as JSON";
      }
      
      if (type === "webhook") {
        const dutyName = this.webhookRoutes.get(path);
        return dutyName ? `Webhook endpoint for ${dutyName} duty` : "Webhook endpoint";
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
      font-family: 'Agave', monospace;
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
      <span>${status.totalDuties} Duties</span>
      <span>${status.scheduledDuties} Scheduled</span>
      <span>${status.webhookDuties} Webhooks</span>
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
      <p>Ronin Duty Engine • Running on port ${port}</p>
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
    totalDuties: number;
    scheduledDuties: number;
    watchedDuties: number;
    webhookDuties: number;
    uptime: number;
    pid: number;
    dutys: Array<{
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
      font-family: 'Agave', monospace;
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
    
    .duty-list {
      display: grid;
      gap: 1rem;
    }
    
    .duty-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 1.5rem;
      transition: all 0.3s;
    }
    
    .duty-card:hover {
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.04);
      transform: translateY(-2px);
    }
    
    .duty-name {
      font-size: 1.2rem;
      font-weight: 500;
      color: #ffffff;
      margin-bottom: 1rem;
      letter-spacing: -0.01em;
    }
    
    .duty-details {
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
      font-family: 'Agave', monospace;
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
    
    .no-dutys {
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
      font-family: 'Agave', monospace;
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
              React.createElement('div', { className: 'stat-value' }, data.totalDuties),
              React.createElement('div', { className: 'stat-label' }, 'Total Duties')
            ),
            React.createElement('div', { className: 'stat-card' },
              React.createElement('div', { className: 'stat-value' }, data.scheduledDuties),
              React.createElement('div', { className: 'stat-label' }, 'Scheduled')
            ),
            React.createElement('div', { className: 'stat-card' },
              React.createElement('div', { className: 'stat-value' }, data.watchedDuties),
              React.createElement('div', { className: 'stat-label' }, 'File Watchers')
            ),
            React.createElement('div', { className: 'stat-card' },
              React.createElement('div', { className: 'stat-value' }, data.webhookDuties),
              React.createElement('div', { className: 'stat-label' }, 'Webhooks')
            )
          ),
          React.createElement('div', { className: 'section' },
            React.createElement('h2', { className: 'section-title' }, 'Duties'),
            data.dutys.length === 0 
              ? React.createElement('div', { className: 'no-dutys' }, 'No dutys registered')
              : React.createElement('div', { className: 'duty-list' },
                  data.dutys.map(duty => 
                    React.createElement('div', { key: duty.name, className: 'duty-card' },
                      React.createElement('div', { className: 'duty-name' }, duty.name),
                      React.createElement('div', { className: 'duty-details' },
                        duty.schedule && React.createElement('div', { className: 'detail-item' },
                          React.createElement('span', { className: 'badge schedule' }, 'Schedule'),
                          React.createElement('span', { className: 'detail-value' }, duty.schedule)
                        ),
                        duty.watch && duty.watch.length > 0 && React.createElement('div', { className: 'detail-item' },
                          React.createElement('span', { className: 'badge watch' }, 'Watching'),
                          React.createElement('span', { className: 'detail-value' }, duty.watch.join(', '))
                        ),
                        duty.webhook && React.createElement('div', { className: 'detail-item' },
                          React.createElement('span', { className: 'badge webhook' }, 'Webhook'),
                          React.createElement('span', { className: 'detail-value' }, duty.webhook)
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
    for (const [dutyName, patterns] of this.fileWatchers) {
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
    
    this.duties.clear();
    this.webhookRoutes.clear();
  }
}
