import { createInterface } from "readline";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { startRoninServer, type StartOptions } from "./start.js";
import { AlreadyRunningError } from "../instanceLock.js";
import { statusCommand } from "./status.js";
import { askCommand } from "./ask.js";
import { configCommand } from "./config.js";
import { handleOSCommand, parseOSArgs } from "./os.js";
import { logger } from "../../utils/logger.js";

const HISTORY_FILE = join(homedir(), ".ronin", "repl-history.json");
const MAX_HISTORY = 1000;

const COMMANDS = [
  "list",
  "status",
  "ask",
  "run",
  "config",
  "debug",
  "help",
  "clear",
  "history",
  "exit",
  "quit",
  "os",
];

export interface InteractiveOptions extends StartOptions {
  debug?: boolean;
}

/**
 * Interactive command: Start Ronin and run a REPL with CLI commands.
 */
export async function interactiveCommand(options: InteractiveOptions = {}): Promise<void> {
  if (options.debug) {
    logger.setDebug(true);
  }

  let state: Awaited<ReturnType<typeof startRoninServer>>;
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
  if (!state) {
    return;
  }

  const repl = new RoninREPL(state, options);
  try {
    await repl.start();
  } catch (err) {
    logger.error("Interactive mode failed", { error: String(err) });
  } finally {
    await repl.stop();
  }
}

class RoninREPL {
  private rl: ReturnType<typeof createInterface> | null = null;
  private history: string[] = [];
  private isRunning = true;
  private state: Awaited<ReturnType<typeof startRoninServer>> & {};
  private options: InteractiveOptions;
  private closeResolve: (() => void) | null = null;
  private closePromise: Promise<void> = new Promise(() => {});

  constructor(
    state: NonNullable<Awaited<ReturnType<typeof startRoninServer>>>,
    options: InteractiveOptions
  ) {
    this.state = state;
    this.options = options;
  }

  async start(): Promise<void> {
    const historyDir = join(homedir(), ".ronin");
    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true });
    }
    this.loadHistory();

    this.closePromise = new Promise<void>((resolve) => {
      this.closeResolve = resolve;
    });

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "🕐 > ",
      completer: (line: string) => this.completer(line),
    });

    this.rl.on("line", (line: string) => this.handleLine(line));
    this.rl.on("close", () => {
      this.closeResolve?.();
    });

    console.log("\n🕐 Ronin Interactive Mode");
    console.log("   Server: http://localhost:3000");
    const status = this.state.registry.getStatus();
    console.log(`   Agents: ${status.totalDuties} running`);
    console.log(`   Debug: ${logger.isDebugMode() ? "on" : "off"}`);
    console.log('   Type "help" for commands, "exit" to quit.\n');

    this.rl.prompt();
    return this.closePromise;
  }

  private completer(line: string): [string[], string] {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed) {
      return [COMMANDS, line];
    }
    const hits = COMMANDS.filter((c) => c.startsWith(trimmed) || trimmed.startsWith(c));
    return [hits.length ? hits : COMMANDS, line];
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) {
      this.rl!.prompt();
      return;
    }

    this.history.push(trimmed);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }
    this.saveHistory();

    try {
      await this.executeCommand(trimmed);
    } catch (err) {
      logger.error("Command failed", { command: trimmed, error: String(err) });
      console.error("Error:", err instanceof Error ? err.message : String(err));
    }

    if (this.isRunning && this.rl) {
      this.rl.prompt();
    }
  }

  private getArg(flag: string, args: string[]): string | undefined {
    const i = args.indexOf(flag);
    if (i !== -1 && i + 1 < args.length) return args[i + 1];
    return undefined;
  }

  private async executeCommand(line: string): Promise<void> {
    const parts = line.split(/\s+/);
    const cmd = parts[0]!.toLowerCase(); // handleLine only calls this with a pre-trimmed, non-empty line
    const args = parts.slice(1);

    switch (cmd) {
      case "list": {
        const duties = this.state.registry.getDuties();
        console.log("\n📋 Agent Status:");
        for (const a of duties) {
          console.log(`   ${a.name}`);
          if (a.schedule) console.log(`      Schedule: ${a.schedule}`);
          if (a.watch?.length) console.log(`      Watch: ${a.watch.join(", ")}`);
          if (a.webhook) console.log(`      Webhook: ${a.webhook}`);
        }
        console.log();
        break;
      }

      case "status":
        await statusCommand({
          dutyDir: this.options.dutyDir,
          ollamaUrl: this.options.ollamaUrl,
          ollamaModel: this.options.ollamaModel,
          dbPath: this.options.dbPath,
          pluginDir: this.options.pluginDir,
        });
        break;

      case "ask": {
        const question = args.join(" ").replace(/^["']|["']$/g, "").trim();
        if (!question) {
          console.error("Usage: ask \"your question\"");
          return;
        }
        await askCommand({
          question,
          dutyDir: this.options.dutyDir,
          pluginDir: this.options.pluginDir ?? this.options.userPluginDir,
          ollamaUrl: this.options.ollamaUrl,
          ollamaModel: this.options.ollamaModel,
          dbPath: this.options.dbPath,
        });
        break;
      }

      case "run": {
        const name = args[0];
        if (!name) {
          console.error("Usage: run <agent-name>");
          return;
        }
        try {
          await this.state.registry.executeDuty(name);
          console.log(`✅ ${name} completed`);
        } catch (err) {
          console.error(`❌ ${name}:`, err instanceof Error ? err.message : String(err));
        }
        break;
      }

      case "config":
        await configCommand({
          show: true,
          dutyDir: this.options.dutyDir,
          userPluginDir: this.options.userPluginDir,
        });
        break;

      case "debug": {
        const setting = args[0]?.toLowerCase();
        if (setting === "on") {
          logger.setDebug(true);
          console.log("Debug mode on");
        } else if (setting === "off") {
          logger.setDebug(false);
          console.log("Debug mode off");
        } else {
          console.log(`Debug: ${logger.isDebugMode() ? "on" : "off"}`);
        }
        break;
      }

      case "help":
        this.showHelp();
        break;

      case "clear":
        console.clear();
        break;

      case "history":
        this.history.slice(-20).forEach((entry, i) => console.log(`${i + 1}: ${entry}`));
        break;

      case "exit":
      case "quit":
        this.isRunning = false;
        this.rl?.close();
        break;

      default: {
        const { action, subAction, options: osOpts } = parseOSArgs(parts);
        if (action && (action === "install" || action === "uninstall" || action === "status" || action === "verify" || action === "clipboard")) {
          await handleOSCommand(action, subAction, osOpts);
        } else {
          console.log(`Unknown command: ${cmd}. Type "help" for commands.`);
        }
      }
    }
  }

  private showHelp(): void {
    console.log(`
  list              List agents and schedules
  status            Show runtime status
  ask "<question>"  Ask a question (local AI)
  run <agent>       Run an agent once
  config            Show configuration
  debug [on|off]    Toggle debug logging
  clear             Clear screen
  history           Show recent commands
  exit              Quit (graceful shutdown)
  os install mac    Install macOS Desktop Mode
  os status         OS integration status
`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log("\nShutting down agents...");
    this.state.cleanup();
    this.saveHistory();
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    console.log("✅ Ronin interactive mode stopped.\n");
  }

  private loadHistory(): void {
    try {
      if (existsSync(HISTORY_FILE)) {
        const data = readFileSync(HISTORY_FILE, "utf-8");
        const parsed = JSON.parse(data);
        this.history = Array.isArray(parsed) ? parsed.slice(-MAX_HISTORY) : [];
      }
    } catch {
      this.history = [];
    }
  }

  private saveHistory(): void {
    try {
      const dir = join(homedir(), ".ronin");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(
        HISTORY_FILE,
        JSON.stringify(this.history.slice(-MAX_HISTORY), null, 2)
      );
    } catch {
      // ignore
    }
  }
}
