import { createAPI } from "../../api/index.js";
import type { AgentAPI } from "../../types/api.js";
import { AgentLoader, AgentRegistry, HotReloadService } from "../../agent/index.js";
import { TechniqueLoader } from "../../techniques/loader.js";
import { KataLoader } from "../../kata/loader.js";
import { ContractLoader } from "../../contract/loader.js";
import { loadConfig, ensureDefaultAgentDir, ensureDefaultExternalAgentDir, ensureDefaultUserPluginDir } from "./config.js";
import { ensureAiRegistry } from "./ai.js";
import { logger } from "../../utils/logger.js";
import { existsSync, mkdirSync, openSync, closeSync, readdirSync, unlinkSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface StartOptions {
  agentDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
  userPluginDir?: string;
  desktop?: boolean;
  ninja?: boolean;
  daemon?: boolean;
  /** Bind webhook server to 0.0.0.0 and show network URL (share on LAN). */
  host?: boolean;
}

export interface RoninServerState {
  api: AgentAPI;
  registry: AgentRegistry;
  hotReload: HotReloadService;
  /** Stop hot reload and cleanup registry (does not exit process). */
  cleanup: () => void;
}

/**
 * Start Ronin server and agents. Returns state for REPL or other callers.
 * Does not register SIGINT/SIGTERM; caller is responsible for shutdown.
 */
export async function startRoninServer(options: StartOptions = {}): Promise<RoninServerState | null> {
  if (process.env.RONIN_READ_ONLY === "1") {
    return null;
  }
  await ensureAiRegistry();
  const config = await loadConfig();
  const agentDir = options.agentDir || config.agentDir || ensureDefaultAgentDir();
  const externalAgentDir =
    process.env.RONIN_EXTERNAL_AGENT_DIR || config.externalAgentDir || ensureDefaultExternalAgentDir();
  const userPluginDir = options.userPluginDir || config.userPluginDir || ensureDefaultUserPluginDir();

  process.on("uncaughtException", (error) => {
    if (error && typeof error === "object" && (error as any).error_code === 409) return;
    logger.error("Uncaught exception (prevented crash)", { error });
  });
  process.on("unhandledRejection", (reason) => {
    if (reason && typeof reason === "object") {
      const err = reason as any;
      if (err.error_code === 409 || (err.message && err.message.includes("409"))) return;
    }
    logger.error("Unhandled rejection (prevented crash)", { reason });
  });

  logger.info("Starting Ronin Agent System", { agentDir, externalAgentDir, userPluginDir });

  const api = await createAPI({
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    useFastModelForAgents: true,
    dbPath: options.dbPath,
    pluginDir: options.pluginDir || config.pluginDir,
    userPluginDir,
  });

  if (config.realmUrl && config.realmCallsign && api.realm) {
    try {
      logger.info("Connecting to Realm...");
      await api.realm.init(
        config.realmUrl,
        config.realmCallsign,
        {
          token: config.realmToken,
          localWsPort: config.realmLocalPort ? parseInt(config.realmLocalPort) : undefined,
        }
      );
      logger.info("Connected to Realm", { url: config.realmUrl, callsign: config.realmCallsign });
    } catch (error) {
      logger.warn("Failed to connect to Realm, continuing without", { error: error instanceof Error ? error.message : String(error) });
    }
  } else if (api.realm) {
    logger.info("Realm not configured. Use 'ronin config --realm-url <url> --realm-callsign <callsign>' to enable");
  }

  const desktopEnabled = options.desktop || config.desktop?.enabled;
  if (desktopEnabled) {
    logger.info("Desktop Mode enabled");
    const { getMacStatus } = await import("../../os/index.js");
    const osStatus = getMacStatus();
    if (!osStatus.quickActionInstalled || !osStatus.launchAgentInstalled) {
      logger.warn("macOS integrations not fully installed. Run: ronin os install mac");
    } else {
      logger.info("macOS integrations ready");
    }
  }

  const loader = new AgentLoader(agentDir, externalAgentDir);
  logger.debug("Discovering agents...");
  const agents = await loader.loadAllAgents(api);

  if (agents.length === 0) {
    logger.warn("No agents found");
    return null;
  }

  logger.info("Loaded agents", { count: agents.length });

  // Load techniques, katas, and contracts from filesystem
  const techniqueLoader = new TechniqueLoader(process.cwd());
  const techniqueResult = await techniqueLoader.loadAll(api);
  if (techniqueResult.loaded > 0 || techniqueResult.errors.length > 0) {
    logger.info("Loaded techniques from files", { loaded: techniqueResult.loaded, skipped: techniqueResult.skipped, errors: techniqueResult.errors.length });
  }

  const kataLoader = new KataLoader(process.cwd());
  const kataResult = await kataLoader.loadAll(api);
  if (kataResult.loaded > 0 || kataResult.errors.length > 0) {
    logger.info("Loaded katas from files", { loaded: kataResult.loaded, skipped: kataResult.skipped, errors: kataResult.errors.length });
  }

  const contractLoader = new ContractLoader(process.cwd());
  const contractResult = await contractLoader.loadAll(api);
  if (contractResult.loaded > 0 || contractResult.errors.length > 0) {
    logger.info("Loaded contracts from files", { loaded: contractResult.loaded, skipped: contractResult.skipped, errors: contractResult.errors.length });
  }

  const registry = new AgentRegistry({
    files: api.files as any,
    http: api.http as any,
    events: api.events as any,
    webhookHost: options.host ? "0.0.0.0" : undefined,
  });
  registry.startWebhookServerIfNeeded();
  registry.registerAll(agents);

  // Start menubar after agents are registered so route discovery includes agent routes (e.g. /todo, /analytics)
  if (desktopEnabled && config.desktop?.menubar) {
    const { startMenubar, discoverRoutes } = await import("../../os/index.js");
    const port = config.desktop?.bridge?.port ?? 17341;
    const routesConfig = config.desktop?.menubarRoutes ?? { enabled: true, excludePatterns: ["/api/"] };
    const routes = discoverRoutes(
      () => api.http.getAllRoutes(),
      (path: string) => api.http.getRouteMetadata(path),
      routesConfig
    );
    startMenubar(port, routes);
    if (routes.length > 0) {
      logger.info("Menubar routes discovered", { count: routes.length, paths: routes.map((r) => r.path) });
    }
  }

  (api as { getAgents?: () => ReturnType<AgentRegistry["getAgents"]> }).getAgents = () =>
    registry.getAgents();

  const hotReload = new HotReloadService({
    agentsDir: agentDir,
    externalAgentsDir: externalAgentDir,
    registry,
    api,
  });
  hotReload.start();

  // When an agent file is updated (e.g. by schedule-manager), reload only that agent
  api.events.on("agent_file_updated", async (data: unknown) => {
    const payload = data as { filePath?: string };
    const filePath = payload?.filePath;
    if (filePath) {
      const result = await hotReload.loadAgent(filePath);
      if (result.success) {
        logger.info("Hot reload applied", { agent: result.agentName });
        // Emit schedule_updated only after registry is refreshed so the UI sees the new schedule
        api.events.emit("schedule_updated", { agentName: result.agentName, filePath }, "hot-reload");
      } else {
        logger.warn("Hot reload failed for updated file", { filePath, error: result.error });
      }
    }
  });

  const cleanup = () => {
    hotReload.stop();
    registry.cleanup();
  };

  return { api, registry, hotReload, cleanup };
}

const NINJA_LOG_PATH = join(homedir(), ".ronin", "ninja.log");
const DAEMON_LOG_PATH = join(homedir(), ".ronin", "daemon.log");
const DAEMON_PID_PATH = join(homedir(), ".ronin", "ronin.pid");
const RUN_LOGS_DIR = join(homedir(), ".ronin", "logs", "runs");

/**
 * Set up a per-run log file, rotate old ones to keep only `retentionRuns` most recent.
 * Returns the path of the newly created log file.
 */
function setupRunLog(retentionRuns: number): string {
  if (!existsSync(RUN_LOGS_DIR)) mkdirSync(RUN_LOGS_DIR, { recursive: true });

  // Rotate: keep only (retentionRuns - 1) existing files to make room for the new one
  const existing = readdirSync(RUN_LOGS_DIR)
    .filter((f) => f.startsWith("run-") && f.endsWith(".log"))
    .sort(); // ISO timestamps sort lexicographically
  const toDelete = existing.slice(0, Math.max(0, existing.length - (retentionRuns - 1)));
  for (const f of toDelete) {
    try { unlinkSync(join(RUN_LOGS_DIR, f)); } catch { /* ignore */ }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
  const logPath = join(RUN_LOGS_DIR, `run-${ts}.log`);
  return logPath;
}

/**
 * Ingest retained run log files as SystemLog nodes in the ontology.
 */
async function ingestRunLogsToOntology(api: AgentAPI): Promise<void> {
  if (!api.ontology) return;
  if (!existsSync(RUN_LOGS_DIR)) return;

  const files = readdirSync(RUN_LOGS_DIR)
    .filter((f) => f.startsWith("run-") && f.endsWith(".log"))
    .sort();

  for (const file of files) {
    const filePath = join(RUN_LOGS_DIR, file);
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");
      const errors = lines.filter((l) => l.includes("[ERROR]") || l.includes("✖ ERROR")).length;
      const warns  = lines.filter((l) => l.includes("[WARN]")  || l.includes("⚠ WARN")).length;
      // Extract run timestamp from filename: run-2026-02-24T18-09-51.log
      const tsRaw = file.replace("run-", "").replace(".log", "").replace(/-(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");
      const runDate = new Date(tsRaw).toISOString().slice(0, 19).replace("T", " ");
      const summary = `Run: ${runDate} | Lines: ${lines.length} | Errors: ${errors} | Warnings: ${warns}\n\n${content.slice(0, 3000)}`;
      await api.ontology.setNode({
        id: `SystemLog-${file.replace(".log", "")}`,
        type: "SystemLog",
        name: `Run ${runDate}`,
        summary: summary.slice(0, 8000),
        domain: "system",
      });
    } catch {
      // If one file fails, continue with others
    }
  }
}

/**
 * Start Ronin in ninja mode: spawn a detached background process with logs to ~/.ronin/ninja.log.
 */
function runNinjaMode(): void {
  const logDir = join(homedir(), ".ronin");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const args = process.argv.slice(2).filter((a) => a !== "--ninja");
  const logFd = openSync(NINJA_LOG_PATH, "a");

  const child = Bun.spawn({
    cmd: [process.execPath, process.argv[1], ...args],
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
    detached: true,
  });

  closeSync(logFd);
  child.unref();

  console.log("Ronin started in ninja mode.");
  console.log(`  PID:  ${child.pid}`);
  console.log(`  Logs: ~/.ronin/ninja.log`);
  console.log("Use 'ronin status' to check, 'ronin stop' to stop.");
  process.exit(0);
}

/**
 * Start Ronin in daemon mode: spawn a detached background process with PID file and logs.
 */
function runDaemonMode(): void {
  const logDir = join(homedir(), ".ronin");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  // Check if daemon is already running
  if (existsSync(DAEMON_PID_PATH)) {
    try {
      const pid = parseInt(Bun.file(DAEMON_PID_PATH).text().toString().trim());
      // Check if process is still running
      try {
        process.kill(pid, 0); // Signal 0 checks if process exists
        console.error(`Daemon already running with PID ${pid}`);
        console.error(`  Logs: ${DAEMON_LOG_PATH}`);
        console.error(`  Use 'ronin daemon stop' to stop it.`);
        process.exit(1);
      } catch {
        // Process doesn't exist, remove stale PID file
        Bun.write(DAEMON_PID_PATH, "");
      }
    } catch {
      // PID file exists but can't read it, continue
    }
  }

  const args = process.argv.slice(2).filter((a) => a !== "--daemon");
  const logFd = openSync(DAEMON_LOG_PATH, "a");

  const child = Bun.spawn({
    cmd: [process.execPath, process.argv[1], ...args],
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
    detached: true,
  });

  // Write PID file
  Bun.write(DAEMON_PID_PATH, String(child.pid));

  closeSync(logFd);
  child.unref();

  console.log("Ronin started in daemon mode.");
  console.log(`  PID:  ${child.pid}`);
  console.log(`  Logs: ${DAEMON_LOG_PATH}`);
  console.log(`  PID file: ${DAEMON_PID_PATH}`);
  console.log("Use 'ronin daemon status' to check, 'ronin daemon stop' to stop.");
  process.exit(0);
}

/**
 * Start command: Discover, load, and schedule all agents
 */
export async function startCommand(options: StartOptions = {}): Promise<void> {
  if (options.ninja) {
    runNinjaMode();
    return;
  }

  if (options.daemon) {
    runDaemonMode();
    return;
  }

  // Set up per-run log file (foreground only; ninja/daemon already redirect stdout)
  const config = await loadConfig();
  const sysConfig = config.system ?? {};
  const logToFile = sysConfig.logToFile !== false; // default true
  const logRetentionRuns = Math.max(1, sysConfig.logRetentionRuns ?? 2);
  if (logToFile) {
    const runLogPath = setupRunLog(logRetentionRuns);
    logger.setLogFile(runLogPath);
  }

  const state = await startRoninServer(options);
  if (!state) return;

  const status = state.registry.getStatus();
  const port = options.port ?? 3000;

  // Styled startup summary box
  const reset  = "\x1b[0m";
  const bold   = "\x1b[1m";
  const dim    = "\x1b[2m";
  const cyan   = "\x1b[36m";
  const green  = "\x1b[32m";
  const yellow = "\x1b[33m";
  const gray   = "\x1b[90m";

  const pluginCount = state.api?.plugins?.list().length ?? 0;
  const width = 52;
  const line  = "─".repeat(width);

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.replace(/\x1b\[[0-9;]*m/g, "").length));

  const row1 = `  ${bold}${cyan}🥷 Ronin${reset}  ${dim}·${reset}  ${bold}${status.totalAgents} agents loaded${reset}  ${dim}·${reset}  ${cyan}:${port}${reset}`;
  const row2 = `  ${green}✦${reset} ${bold}${status.scheduledAgents}${reset} scheduled   ${dim}·${reset}  ${yellow}⬡${reset} ${bold}${pluginCount}${reset} plugins`;
  const row3 = `  ${green}✦${reset} ${bold}${status.webhookAgents}${reset} webhooks    ${dim}·${reset}  ${gray}${status.watchedAgents} watchers${reset}`;

  console.log(`\n${cyan}┌${line}┐${reset}`);
  console.log(`${cyan}│${reset}${pad(row1, width)}${cyan}│${reset}`);
  console.log(`${cyan}├${line}┤${reset}`);
  console.log(`${cyan}│${reset}${pad(row2, width)}${cyan}│${reset}`);
  console.log(`${cyan}│${reset}${pad(row3, width)}${cyan}│${reset}`);
  console.log(`${cyan}└${line}┘${reset}\n`);

  // Ingest retained run logs into ontology (non-blocking)
  if (logToFile) {
    ingestRunLogsToOntology(state.api).catch(() => { /* silently ignore */ });
  }

  const shutdown = () => {
    logger.info("Shutting down...");
    state.cleanup();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

