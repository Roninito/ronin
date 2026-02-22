#!/usr/bin/env bun

import { startCommand } from "./commands/start.js";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";
import { listRoutesCommand } from "./commands/list-routes.js";
import { aiCommand } from "./commands/ai.js";
import { statusCommand } from "./commands/status.js";
import { stopCommand, restartCommand } from "./commands/stop.js";
import { killCommand } from "./commands/kill.js";
import { daemonCommand } from "./commands/daemon.js";
import { createPluginCommand } from "./commands/create-plugin.js";
import { createAgentCommand } from "./commands/create-agent.js";
import { cancelAgentCreationCommand } from "./commands/cancel-agent-creation.js";
import { listPluginsCommand } from "./commands/list-plugins.js";
import { pluginInfoCommand } from "./commands/plugin-info.js";
import { askCommand } from "./commands/ask.js";
import { configCommand } from "./commands/config.js";
import { docsCommand } from "./commands/docs.js";
import { realmConnectCommand } from "./commands/realm-connect.js";
import { realmStatusCommand } from "./commands/realm-status.js";
import { realmDiscoverCommand } from "./commands/realm-discover.js";
import { mcpCommand } from "./commands/mcp.js";
import { cloudflareCommand } from "./commands/cloudflare.js";
import { initCommand } from "./commands/init.js";
import { interactiveCommand } from "./commands/interactive.js";
import { scheduleCommand } from "./commands/schedule.js";
import { emitCommand } from "./commands/emit.js";
import { skillsCommand, createSkillCommand } from "./commands/skills.js";
import { kdbCommand } from "./commands/kdb.js";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { setLogLevel, LogLevel } from "../utils/logger.js";
import { fileURLToPath } from "url";
import { getArg, getCommandHelp, parseGlobalOptions } from "./shared.js";

// Commands that require being in the ronin directory
const COMMANDS_REQUIRING_RONIN_DIR = new Set(["start", "run", "interactive", "i", "create"]);

// Check if we're in the ronin directory (has package.json with name "ronin")
function isInRoninDir(): boolean {
  const packageJsonPath = join(process.cwd(), "package.json");
  if (!existsSync(packageJsonPath)) return false;

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return pkg.name === "ronin";
  } catch {
    return false;
  }
}

function checkRoninDir(command: string): void {
  if (COMMANDS_REQUIRING_RONIN_DIR.has(command) && !isInRoninDir()) {
    console.error("❌ This command must be run from the Ronin installation directory");
    console.error(`   cd ${roninProjectRoot}`);
    console.error(`   ronin ${command} ${process.argv.slice(3).join(" ")}`);
    process.exit(1);
  }
}

// Debug mode
if (process.argv.includes("--debug")) {
  setLogLevel(LogLevel.DEBUG);
}

// Calculate the actual ronin installation directory
// This handles both local development and global installations
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// The CLI is at src/cli/index.ts, so project root is two levels up
let roninProjectRoot = join(__dirname, "..", "..");

// Verify this is actually the ronin directory
function findRoninRoot(startPath: string): string | null {
  let current = startPath;
  // Try up to 5 parent directories
  for (let i = 0; i < 5; i++) {
    const pkgPath = join(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(require("fs").readFileSync(pkgPath, "utf-8"));
        if (pkg.name === "ronin") {
          return current;
        }
      } catch {
        // Continue searching
      }
    }
    const parent = join(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return null;
}

// Find the actual ronin root
const actualRoninRoot = findRoninRoot(roninProjectRoot);
if (actualRoninRoot) {
  roninProjectRoot = actualRoninRoot;
}

process.env.RONIN_PROJECT_ROOT = roninProjectRoot;

const command = process.argv[2];
const args = process.argv.slice(3);

/** Commands that must never start the Ronin server (status, ask, list, etc.). */
function isReadOnlyCommand(cmd: string | undefined, a: string[]): boolean {
  if (!cmd) return true; // help / no command
  const sub = a[0];
  switch (cmd) {
    case "start":
    case "stop":
    case "restart":
    case "interactive":
    case "i":
    case "run":
    case "create":
      return false;
    case "daemon":
      return sub !== "start" && sub !== "restart";
    case "realm":
      return sub === "status" || sub === "discover" || !sub;
    default:
      return true;
  }
}

async function main() {
  // Read-only commands must never start the server and should run quietly (no plugin/agent init logs)
  if (isReadOnlyCommand(command, args)) {
    process.env.RONIN_READ_ONLY = "1";
    process.env.RONIN_QUIET = "1";
  }

  // Check directory for commands that require it
  checkRoninDir(command);

  // Initialize guidelines early
  const { initializeGuidelines } = await import("../guidelines/index.js");
  await initializeGuidelines();

  switch (command) {
    case "start":
      await startCommand({
        agentDir: getArg("--agent-dir", args),
        ollamaUrl: getArg("--ollama-url", args),
        ollamaModel: getArg("--ollama-model", args),
        dbPath: getArg("--db-path", args),
        pluginDir: getArg("--plugin-dir", args),
        userPluginDir: getArg("--user-plugin-dir", args),
        desktop: args.includes("--desktop"),
        ninja: args.includes("--ninja"),
        daemon: args.includes("--daemon"),
        host: args.includes("--host"),
      });
      break;

    case "stop":
      await stopCommand();
      break;

    case "restart":
      await restartCommand(() => startCommand({
        agentDir: getArg("--agent-dir", args),
        ollamaUrl: getArg("--ollama-url", args),
        ollamaModel: getArg("--ollama-model", args),
        dbPath: getArg("--db-path", args),
        pluginDir: getArg("--plugin-dir", args),
        userPluginDir: getArg("--user-plugin-dir", args),
        desktop: args.includes("--desktop"),
        ninja: args.includes("--ninja"),
        host: args.includes("--host"),
      }));
      break;

    case "kill":
      await killCommand();
      break;

    case "interactive":
    case "i":
      await interactiveCommand({
        agentDir: getArg("--agent-dir", args),
        ollamaUrl: getArg("--ollama-url", args),
        ollamaModel: getArg("--ollama-model", args),
        dbPath: getArg("--db-path", args),
        pluginDir: getArg("--plugin-dir", args),
        userPluginDir: getArg("--user-plugin-dir", args),
        desktop: args.includes("--desktop"),
        debug: args.includes("--debug"),
      });
      break;

    case "run":
      const agentName = args[0];
      if (!agentName) {
        console.error("❌ Agent name required");
        console.log("Usage: ronin run <agent-name>");
        process.exit(1);
      }
      await runCommand({
        agentName,
        agentDir: getArg("--agent-dir", args),
        ollamaUrl: getArg("--ollama-url", args),
        ollamaModel: getArg("--ollama-model", args),
        dbPath: getArg("--db-path", args),
        pluginDir: getArg("--plugin-dir", args),
      });
      break;

    case "list":
      await listCommand({
        agentDir: getArg("--agent-dir", args),
        ollamaUrl: getArg("--ollama-url", args),
        ollamaModel: getArg("--ollama-model", args),
        dbPath: getArg("--db-path", args),
        pluginDir: getArg("--plugin-dir", args),
      });
      break;

    case "ai":
    case "models":
      await aiCommand({ args });
      break;

    case "routes":
    case "listRoutes":
      await listRoutesCommand({
        port: getArg("--port", args) ? parseInt(getArg("--port", args)!) : undefined,
      });
      break;

    case "status":
      await statusCommand({
        agentDir: getArg("--agent-dir", args),
        ollamaUrl: getArg("--ollama-url", args),
        ollamaModel: getArg("--ollama-model", args),
        dbPath: getArg("--db-path", args),
        pluginDir: getArg("--plugin-dir", args),
      });
      break;

    case "daemon":
      await daemonCommand(args.slice(1));
      break;

    case "create":
      if (args[0] === "plugin") {
        const pluginName = args[1];
        if (!pluginName) {
          console.error("❌ Plugin name required");
          console.log("Usage: ronin create plugin <name>");
          process.exit(1);
        }
        await createPluginCommand({
          pluginName,
          pluginDir: getArg("--plugin-dir", args),
        });
      } else if (args[0] === "agent") {
        const description = args.slice(1).join(" ");
        await createAgentCommand({
          description: description || undefined,
          agentDir: getArg("--agent-dir", args),
          local: args.includes("--local"),
          ollamaUrl: getArg("--ollama-url", args),
          ollamaModel: getArg("--ollama-model", args),
          dbPath: getArg("--db-path", args),
          pluginDir: getArg("--plugin-dir", args),
          noPreview: args.includes("--no-preview"),
          edit: args.includes("--edit"),
        });
      } else if (args[0] === "skill") {
        const description = args.slice(1).join(" ");
        if (!description.trim()) {
          console.error("❌ Description required");
          console.log('Usage: ronin create skill "monitor logs for errors"');
          process.exit(1);
        }
        await createSkillCommand(description, {
          agentDir: getArg("--agent-dir", args),
          pluginDir: getArg("--plugin-dir", args),
          userPluginDir: getArg("--user-plugin-dir", args),
          ollamaUrl: getArg("--ollama-url", args),
          ollamaModel: getArg("--ollama-model", args),
          dbPath: getArg("--db-path", args),
        });
      } else {
        console.error(`❌ Unknown create command: ${args[0]}`);
        console.log("Available: ronin create plugin <name>, ronin create agent [description], ronin create skill \"<description>\"");
        process.exit(1);
      }
      break;

    case "cancel":
      if (args[0] === "agent-creation") {
        const taskId = args[1];
        await cancelAgentCreationCommand({
          taskId,
          port: getArg("--port", args) ? parseInt(getArg("--port", args)!) : undefined,
        });
      } else {
        console.error(`❌ Unknown cancel command: ${args[0]}`);
        console.log("Available: ronin cancel agent-creation [taskId]");
        process.exit(1);
      }
      break;

    case "emit": {
      const eventName = args[0];
      if (!eventName || eventName.startsWith("--")) {
        console.error("❌ Event name required");
        console.log("Usage: ronin emit <event> [data] [--data <json>] [--port <port>]");
        process.exit(1);
      }
      const dataArg = getArg("--data", args);
      const dataPositional = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
      await emitCommand({
        event: eventName,
        data: dataArg ?? dataPositional,
        port: getArg("--port", args) ? parseInt(getArg("--port", args)!, 10) : undefined,
      });
      break;
    }

    case "plugins":
      if (args[0] === "list") {
        await listPluginsCommand({
          pluginDir: getArg("--plugin-dir", args),
        });
      } else if (args[0] === "info") {
        const pluginName = args[1];
        if (!pluginName) {
          console.error("❌ Plugin name required");
          console.log("Usage: ronin plugins info <plugin-name>");
          process.exit(1);
        }
        await pluginInfoCommand({
          pluginName,
          pluginDir: getArg("--plugin-dir", args),
        });
      } else {
        console.error(`❌ Unknown plugins command: ${args[0]}`);
        console.log("Available: ronin plugins list, ronin plugins info <name>");
        process.exit(1);
      }
      break;

    case "skills": {
      const sub = args[0] ?? "list";
      const subArgs = sub === "list" || sub === "discover" || sub === "explore" || sub === "use" || sub === "install" || sub === "update" || sub === "init"
        ? args.slice(1)
        : args;
      const subcmd = sub;
      await skillsCommand(subcmd, subArgs, {
        agentDir: getArg("--agent-dir", args),
        pluginDir: getArg("--plugin-dir", args),
        userPluginDir: getArg("--user-plugin-dir", args),
        ollamaUrl: getArg("--ollama-url", args),
        ollamaModel: getArg("--ollama-model", args),
        dbPath: getArg("--db-path", args),
      });
      break;
    }

    case "ask":
      // Check if first arg is a model name (grok, gemini, etc.)
      let question = args.join(" ");
      let model: string | undefined;
      
      // Check if first arg is a known model name
      const firstArg = args[0];
      const knownModels = ["grok", "gemini", "local", "ollama", "smart", "cloud"];
      if (firstArg && !firstArg.startsWith("--") && knownModels.includes(firstArg)) {
        model = firstArg;
        question = args.slice(1).join(" ");
      }

      // Remove ask-specific flags from the freeform question text
      const flagsWithValues = new Set([
        "--model",
        "--ask-model",
        "--agent-dir",
        "--plugin-dir",
        "--ollama-url",
        "--ollama-model",
        "--db-path",
      ]);
      const flagsNoValues = new Set(["--sources"]);
      const questionTokens: string[] = [];
      for (let i = 0; i < args.length; i++) {
        const token = args[i];
        if (flagsWithValues.has(token)) {
          i++; // skip value token too
          continue;
        }
        if (flagsNoValues.has(token)) continue;
        if (i === 0 && !token.startsWith("--") && knownModels.includes(token)) continue;
        questionTokens.push(token);
      }
      question = questionTokens.join(" ").trim();
      
      try {
        await askCommand({
          question: question || undefined,
          model: model || getArg("--model", args),
          askModel: getArg("--ask-model", args),
          agentDir: getArg("--agent-dir", args),
          pluginDir: getArg("--plugin-dir", args),
          ollamaUrl: getArg("--ollama-url", args),
          ollamaModel: getArg("--ollama-model", args),
          dbPath: getArg("--db-path", args),
          showSources: args.includes("--sources"),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Ask failed: ${message}`);
        process.exit(1);
      }
      break;

    case "config":
      // Handle "ronin config set <path> <value>" subcommand
      if (args[0] === "set") {
        const configPath = args[1];
        const configValue = args.slice(2).join(" ");
        if (!configPath || configValue === "") {
          console.error("❌ Usage: ronin config set <path> <value>");
          console.log("Example: ronin config set ai.provider gemini");
          console.log("Example: ronin config set ai.temperature 0.3");
          console.log("Example: ronin config set ai.models.fast ministral-3:3b");
          console.log("Example: ronin config set ai.fallback.enabled true");
          process.exit(1);
        }
        const { configSetCommand } = await import("./commands/config-set.js");
        await configSetCommand(configPath, configValue);
        break;
      }
      await configCommand({
        agentDir: getArg("--agent-dir", args),
        externalAgentDir: getArg("--external-agent-dir", args),
        userPluginDir: getArg("--user-plugin-dir", args),
        init: args.includes("--init"),
        grokApiKey: getArg("--grok-api-key", args),
        geminiApiKey: getArg("--gemini-api-key", args),
        braveApiKey: getArg("--brave-api-key", args),
        geminiModel: getArg("--gemini-model", args),
        realmUrl: getArg("--realm-url", args),
        realmCallsign: getArg("--realm-callsign", args),
        realmToken: getArg("--realm-token", args),
        realmLocalPort: getArg("--realm-local-port", args),
        show: args.includes("--show"),
        edit: args.includes("--edit"),
        setPassword: args.includes("--set-password"),
        backup: args.includes("--backup"),
        listBackups: args.includes("--list-backups"),
        restore: getArg("--restore", args),
        export: getArg("--export", args),
        importPath: getArg("--import", args),
        validate: args.includes("--validate"),
      });
      break;

    case "docs":
      await docsCommand({
        document: args[0] && !args[0].startsWith("--") ? args[0] : undefined,
        browser: !args.includes("--terminal"),
        terminal: args.includes("--terminal"),
        port: getArg("--port", args) ? parseInt(getArg("--port", args)!) : undefined,
        list: args.includes("--list"),
      });
      break;

    case "realm":
      if (args[0] === "connect") {
        const url = getArg("--url", args);
        const callsign = getArg("--callsign", args) || getArg("--call-sign", args);
        if (!url || !callsign) {
          console.error("❌ --url and --callsign required");
          console.log("Usage: ronin realm connect --url wss://realm.afiwi.net --callsign Leerie");
          console.log("   Or for local: ronin realm connect --url ws://localhost:3033 --callsign Leerie");
          process.exit(1);
        }
        await realmConnectCommand({
          url,
          callsign,
          token: getArg("--token", args),
          localPort: getArg("--local-port", args) ? parseInt(getArg("--local-port", args)!) : undefined,
          agentDir: getArg("--agent-dir", args),
          pluginDir: getArg("--plugin-dir", args),
          ollamaUrl: getArg("--ollama-url", args),
          ollamaModel: getArg("--ollama-model", args),
          dbPath: getArg("--db-path", args),
        });
      } else if (args[0] === "status") {
        await realmStatusCommand({
          agentDir: getArg("--agent-dir", args),
          pluginDir: getArg("--plugin-dir", args),
          ollamaUrl: getArg("--ollama-url", args),
          ollamaModel: getArg("--ollama-model", args),
          dbPath: getArg("--db-path", args),
        });
      } else if (args[0] === "discover") {
        const callsign = args[1];
        if (!callsign) {
          console.error("❌ Call sign required");
          console.log("Usage: ronin realm discover <callsign>");
          process.exit(1);
        }
        await realmDiscoverCommand({
          callsign,
          agentDir: getArg("--agent-dir", args),
          pluginDir: getArg("--plugin-dir", args),
          ollamaUrl: getArg("--ollama-url", args),
          ollamaModel: getArg("--ollama-model", args),
          dbPath: getArg("--db-path", args),
        });
      } else {
        console.error(`❌ Unknown realm command: ${args[0]}`);
        console.log("Available: ronin realm connect, ronin realm status, ronin realm discover <callsign>");
        process.exit(1);
      }
      break;

    case "mcp":
      await mcpCommand(args);
      break;

    case "cloudflare":
    case "cf":
      await cloudflareCommand(args, {
        pluginDir: getArg("--plugin-dir", args),
        userPluginDir: getArg("--user-plugin-dir", args),
      });
      break;

    case "os":
      const { handleOSCommand, parseOSArgs } = await import("./commands/os.js");
      const { action, subAction, options } = parseOSArgs(args);
      await handleOSCommand(action, subAction, options);
      break;

    case "init":
      await initCommand({
        quick: args.includes("--quick"),
        skipCloudflare: args.includes("--skip-cloudflare"),
        skipDesktop: args.includes("--skip-desktop"),
      });
      break;

    case "doctor": {
      if (args[0] === "ingest-docs") {
        const { doctorIngestDocsCommand } = await import("./commands/doctor.js");
        await doctorIngestDocsCommand();
      } else {
        const { doctorCommand } = await import("./commands/doctor.js");
        await doctorCommand();
      }
      break;
    }

    case "schedule":
      await scheduleCommand(args, {
        agentDir: getArg("--agent-dir", args),
        ollamaUrl: getArg("--ollama-url", args),
        ollamaModel: getArg("--ollama-model", args),
        dbPath: getArg("--db-path", args),
        pluginDir: getArg("--plugin-dir", args),
      });
      break;

    case "kdb": {
      const kdbFlags = new Set(["--db-path", "--plugin-dir", "--user-plugin-dir"]);
      const kdbArgs = args.filter((a, i) => {
        if (kdbFlags.has(a)) return false;
        if (i > 0 && kdbFlags.has(args[i - 1])) return false;
        return true;
      });
      await kdbCommand(kdbArgs, {
        dbPath: getArg("--db-path", args),
        pluginDir: getArg("--plugin-dir", args),
        userPluginDir: getArg("--user-plugin-dir", args),
      });
      break;
    }

    case "help":
    case "--help":
    case "-h": {
      const helpTarget = args[0];
      if (helpTarget) {
        const helpText = getCommandHelp(helpTarget);
        if (helpText) {
          console.log(helpText);
        } else {
          console.error(`❌ No help available for: ${helpTarget}`);
          printHelp();
        }
      } else {
        printHelp();
      }
      break;
    }

    default:
      if (!command) {
        printHelp();
      } else {
        console.error(`❌ Unknown command: ${command}`);
        printHelp();
        process.exit(1);
      }
  }
}

function printHelp() {
  console.log(`
Ronin - Bun AI Agent Library

Usage: ronin <command> [options]
       ronin help <command>          Show detailed help for a command

Core:
  init                 Interactive setup wizard (--quick for defaults)
  interactive, i       Start Ronin in REPL mode
  start                Start and schedule all agents
  start --ninja        Start in background; logs to ~/.ronin/ninja.log
  start --daemon       Start as daemon; logs to ~/.ronin/daemon.log, PID in ~/.ronin/ronin.pid
  daemon start         Start daemon
  daemon stop          Stop daemon
  daemon status        Check daemon status
  daemon restart       Restart daemon
  daemon logs          Tail daemon logs
  start --host         Share webhook server on network (bind 0.0.0.0)
  stop                 Stop the running instance
  restart              Stop and restart Ronin
  kill                 Force-kill all Ronin instances
  run <agent>          Run a specific agent manually
  list                 List all available agents
  status               Show runtime status and active schedules
  emit <event> [data]  Send event to running Ronin (Shortcuts, scripts)
  doctor               Run health checks on the installation
  kdb                  Ontology/memory stats and queries (knowledge DB)

AI & Tools:
  ask [model] [question]  Ask running Ronin instance (start first)
  ai <subcommand>         Manage AI model definitions (alias: models)
  config                  Manage configuration
  config set <path> <val> Set a config value by dot-path

Creation:
  create plugin <name>    Create a new plugin template
  create agent [desc]     AI-powered agent creation

Plugins & Routes:
  plugins list            List loaded plugins
  plugins info <name>     Show plugin details
  routes                  List registered HTTP routes (alias: listRoutes)

Integrations:
  realm connect           Connect to Realm discovery server
  realm status            Show Realm connection status
  realm discover <call>   Discover a peer by call sign
  mcp <subcommand>        Manage MCP server connections
  cloudflare <subcommand> Manage Cloudflare tunnels and route policy
  os <subcommand>         Desktop Mode commands (macOS)
  docs [doc]              View documentation

Global Options:
  --debug                 Enable debug logging
  --ninja                 Start in background, logs to ~/.ronin/ninja.log
  --daemon                Start as daemon, logs to ~/.ronin/daemon.log, PID in ~/.ronin/ronin.pid
  --host                  Share webhook server on network (bind 0.0.0.0)
  --agent-dir <dir>       Agent directory (default: ./agents)
  --plugin-dir <dir>      Plugin directory (default: ./plugins)
  --user-plugin-dir <dir> User plugins directory (default: ~/.ronin/plugins)
  --ollama-url <url>      Ollama API URL (default: http://localhost:11434)
  --ollama-model <name>   Default Ollama model (default: ministral-3:3b)
  --db-path <path>        Database file path (default: ronin.db)

Examples:
  ronin start                          Start all agents
  ronin emit transcribe.text '{"audioPath":"/tmp/a.wav"}'  Send STT event
  ronin ask grok "explain quantum"     Ask Grok a question
  ronin config set ai.provider gemini  Switch to Gemini
  ronin doctor                         Validate setup
  ronin help emit                      Detailed help for emit command
`);
}

main().catch(error => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

