import { createAPI } from "../../api/index.js";
import type { AgentAPI } from "../../types/api.js";
import { AgentLoader, AgentRegistry, HotReloadService } from "../../agent/index.js";
import { loadConfig, ensureDefaultAgentDir, ensureDefaultExternalAgentDir, ensureDefaultUserPluginDir } from "./config.js";
import { ensureAiRegistry } from "./ai.js";
import { logger } from "../../utils/logger.js";
import { existsSync, mkdirSync, openSync, closeSync } from "fs";
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
    if (config.desktop?.menubar) {
      const { startMenubar } = await import("../../os/index.js");
      startMenubar(config.desktop.bridge?.port);
    }
    const { getStatus } = await import("../../os/index.js");
    const osStatus = getStatus();
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

  const registry = new AgentRegistry({
    files: api.files as any,
    http: api.http as any,
    events: api.events as any,
    webhookHost: options.host ? "0.0.0.0" : undefined,
  });
  registry.startWebhookServerIfNeeded();
  registry.registerAll(agents);

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

  const state = await startRoninServer(options);
  if (!state) return;

  const status = state.registry.getStatus();
  logger.info(`\n📊 Agent Status:\n   Total agents: ${status.totalAgents}\n   Scheduled: ${status.scheduledAgents}\n   File watchers: ${status.watchedAgents}\n   Webhooks: ${status.webhookAgents}`);
  logger.info("\n✨ All agents are running. Press Ctrl+C to stop.\n");

  const shutdown = () => {
    logger.info("Shutting down...");
    state.cleanup();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

