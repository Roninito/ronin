import { createAPI } from "../../api/index.js";
import type { DutyAPI } from "../../types/api.js";
import { DutyLoader, DutyRegistry, HotReloadService } from "../../duty/index.js";
import { KataLoader } from "../../kata/loader.js";
import { ContractLoader } from "../../contract/loader.js";
import { loadConfig, ensureDefaultDutyDir, ensureDefaultExternalDutyDir, ensureDefaultUserPluginDir } from "./config.js";
import { ensureAiRegistry } from "./ai.js";
import { logger } from "../../utils/logger.js";
import { existsSync, mkdirSync, openSync, closeSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { acquireInstanceLock, getRunningInstancePid, AlreadyRunningError, INSTANCE_PID_PATH } from "../instanceLock.js";

export interface StartOptions {
  dutyDir?: string;
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
  /** CLI's `--port` flag (see src/cli/index.ts). NOTE: only affects the startup summary
   *  display below — DutyRegistry.startWebhookServer() actually binds from the
   *  WEBHOOK_PORT env var (default 3000), so passing --port here currently does not
   *  change which port the server listens on. Flagged, not fixed, as out of scope for
   *  a type-error pass. */
  port?: number;
}

export interface RoninServerState {
  api: DutyAPI;
  registry: DutyRegistry;
  hotReload: HotReloadService;
  /** Stop hot reload and cleanup registry (does not exit process). */
  cleanup: () => void;
}

/**
 * Start Ronin server and duties. Returns state for REPL or other callers.
 * Does not register SIGINT/SIGTERM; caller is responsible for shutdown.
 */
export async function startRoninServer(options: StartOptions = {}): Promise<RoninServerState | null> {
  if (process.env.RONIN_READ_ONLY === "1") {
    return null;
  }
  // Checked first, before any duty/plugin/kata loading — closes the race window
  // where two launches (any mix of foreground/--ninja/--daemon/interactive) could
  // both get most of the way through startup before either one reached the
  // webhook port bind that used to be the only thing stopping duplicates.
  acquireInstanceLock();
  await ensureAiRegistry();
  const config = await loadConfig();
  const dutyDir = options.dutyDir || config.dutyDir || ensureDefaultDutyDir();
  const externalDutyDir =
    process.env.RONIN_EXTERNAL_DUTY_DIR || config.externalDutyDir || ensureDefaultExternalDutyDir();
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

  logger.info("Starting Ronin Duty Engine", { dutyDir, externalDutyDir, userPluginDir });

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

  const loader = new DutyLoader(dutyDir, externalDutyDir);
  logger.debug("Discovering duties...");
  const duties = await loader.loadAllDuties(api);

  if (duties.length === 0) {
    logger.warn("No duties found");
    return null;
  }

  logger.info("Loaded duties", { count: duties.length });

  // Load katas and contracts from filesystem
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

  const registry = new DutyRegistry({
    files: api.files as any,
    http: api.http as any,
    events: api.events as any,
    webhookHost: options.host ? "0.0.0.0" : undefined,
  });
  registry.startWebhookServerIfNeeded();
  registry.registerAll(duties);

  // Start menubar after duties are registered so route discovery includes duty routes (e.g. /todo, /analytics)
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

  (api as { getDuties?: () => ReturnType<DutyRegistry["getDuties"]> }).getDuties = () =>
    registry.getDuties();

  const hotReload = new HotReloadService({
    dutiesDir: dutyDir,
    externalDutiesDir: externalDutyDir,
    registry,
    api,
  });
  hotReload.start();

  // When a duty file is updated (e.g. by schedule-manager), reload only that duty
  api.events.on("duty_file_updated", async (data: unknown) => {
    const payload = data as { filePath?: string };
    const filePath = payload?.filePath;
    if (filePath) {
      const result = await hotReload.loadDuty(filePath);
      if (result.success && result.dutyName) {
        logger.info("Hot reload applied", { duty: result.dutyName });
        api.events.emit("schedule_updated", { dutyName: result.dutyName, filePath }, "hot-reload");
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
 * Start Ronin in ninja mode: spawn a detached background process with logs to ~/.ronin/ninja.log.
 */
async function runNinjaMode(): Promise<void> {
  const logDir = join(homedir(), ".ronin");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  // Check up front, for an immediate message instead of a silently-dead child whose
  // only trace is a line buried in ninja.log.
  const existing = getRunningInstancePid();
  if (existing !== null) {
    console.error(`❌ Ronin is already running (PID ${existing}).`);
    console.error("   Use 'ronin status' to check it, or 'ronin stop' first.");
    process.exit(1);
  }

  const args = process.argv.slice(2).filter((a) => a !== "--ninja");
  const logFd = openSync(NINJA_LOG_PATH, "a");

  const child = Bun.spawn({
    cmd: [process.execPath, process.argv[1]!, ...args], // argv[1] is the running script path, always present
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
    detached: true,
  });

  closeSync(logFd);
  child.unref();

  // The child acquires its own instance lock once it reaches startRoninServer() —
  // wait briefly and confirm it actually got there and is still alive, rather than
  // reporting success unconditionally (it could just as easily have lost a startup
  // race and exited immediately).
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (getRunningInstancePid() !== child.pid) {
    console.error("❌ Ronin failed to start in ninja mode (exited immediately).");
    console.error("   Check the log: ~/.ronin/ninja.log");
    process.exit(1);
  }

  console.log("Ronin started in ninja mode.");
  console.log(`  PID:  ${child.pid}`);
  console.log(`  Logs: ~/.ronin/ninja.log`);
  console.log("Use 'ronin status' to check, 'ronin stop' to stop.");
  process.exit(0);
}

/**
 * Start Ronin in daemon mode: spawn a detached background process with PID file and logs.
 */
async function runDaemonMode(): Promise<void> {
  const logDir = join(homedir(), ".ronin");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const existing = getRunningInstancePid();
  if (existing !== null) {
    console.error(`Daemon already running with PID ${existing}`);
    console.error(`  Logs: ${DAEMON_LOG_PATH}`);
    console.error(`  Use 'ronin daemon stop' to stop it.`);
    process.exit(1);
  }

  const args = process.argv.slice(2).filter((a) => a !== "--daemon");
  const logFd = openSync(DAEMON_LOG_PATH, "a");

  const child = Bun.spawn({
    cmd: [process.execPath, process.argv[1]!, ...args], // argv[1] is the running script path, always present
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: logFd,
    stderr: logFd,
    detached: true,
  });

  closeSync(logFd);
  child.unref();

  // No PID file write here: the child writes its own once it acquires the instance
  // lock inside startRoninServer(). Writing it here unconditionally was the bug —
  // a child that lost a startup race died instantly, leaving this file pointing at
  // a dead PID forever (exactly what 'ronin daemon status' was found reporting).
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (getRunningInstancePid() !== child.pid) {
    console.error("❌ Ronin daemon failed to start (exited immediately).");
    console.error(`   Check the log: ${DAEMON_LOG_PATH}`);
    process.exit(1);
  }

  console.log("Ronin started in daemon mode.");
  console.log(`  PID:  ${child.pid}`);
  console.log(`  Logs: ${DAEMON_LOG_PATH}`);
  console.log(`  PID file: ${INSTANCE_PID_PATH}`);
  console.log("Use 'ronin daemon status' to check, 'ronin daemon stop' to stop.");
  process.exit(0);
}

/**
 * Start command: Discover, load, and schedule all duties
 */
export async function startCommand(options: StartOptions = {}): Promise<void> {
  if (options.ninja) {
    await runNinjaMode();
    return;
  }

  if (options.daemon) {
    await runDaemonMode();
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

  let state: RoninServerState | null = null;
  try {
    state = await startRoninServer(options);
  } catch (error) {
    if (error instanceof AlreadyRunningError) {
      console.error(`❌ Ronin is already running (PID ${error.pid}).`);
      console.error("   Use 'ronin status' to check it, or 'ronin stop' first.");
      process.exit(1);
    }
    const err = error as { code?: string; message?: string };
    const message = err?.message || String(error);
    if (err?.code === "EADDRINUSE" || message.includes("EADDRINUSE")) {
      console.error("❌ Port 3000 is already in use.");
      console.error("   If Ronin is already running, use 'ronin status' or 'ronin stop' first.");
      process.exit(1);
    }
    throw error;
  }
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

  const row1 = `  ${bold}${cyan}🥷 Ronin${reset}  ${dim}·${reset}  ${bold}${status.totalDuties} duties loaded${reset}  ${dim}·${reset}  ${cyan}:${port}${reset}`;
  const row2 = `  ${green}✦${reset} ${bold}${status.scheduledDuties}${reset} scheduled   ${dim}·${reset}  ${yellow}⬡${reset} ${bold}${pluginCount}${reset} plugins`;
  const row3 = `  ${green}✦${reset} ${bold}${status.webhookDuties}${reset} webhooks    ${dim}·${reset}  ${gray}${status.watchedDuties} watchers${reset}`;

  console.log(`\n${cyan}┌${line}┐${reset}`);
  console.log(`${cyan}│${reset}${pad(row1, width)}${cyan}│${reset}`);
  console.log(`${cyan}├${line}┤${reset}`);
  console.log(`${cyan}│${reset}${pad(row2, width)}${cyan}│${reset}`);
  console.log(`${cyan}│${reset}${pad(row3, width)}${cyan}│${reset}`);
  console.log(`${cyan}└${line}┘${reset}\n`);

  const shutdown = () => {
    logger.info("Shutting down...");
    state.cleanup();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
