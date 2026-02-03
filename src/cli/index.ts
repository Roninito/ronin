#!/usr/bin/env bun

import { startCommand } from "./commands/start.js";
import { runCommand } from "./commands/run.js";
import { listCommand } from "./commands/list.js";
import { listRoutesCommand } from "./commands/list-routes.js";
import { aiCommand } from "./commands/ai.js";
import { statusCommand } from "./commands/status.js";
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
import { existsSync } from "fs";
import { join } from "path";

// Check if we're in the right directory
const packageJsonPath = join(process.cwd(), "package.json");
if (!existsSync(packageJsonPath)) {
  // Try parent directory (ronin/)
  const parentPackageJson = join(process.cwd(), "ronin", "package.json");
  if (existsSync(parentPackageJson)) {
    console.error("❌ Please run this command from the ronin directory:");
    console.error(`   cd ronin`);
    console.error(`   bun run ronin ${process.argv.slice(2).join(" ")}`);
    process.exit(1);
  } else {
    console.error("❌ Could not find package.json. Please run from the ronin project directory.");
    process.exit(1);
  }
}

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
  switch (command) {
    case "start":
      await startCommand({
        agentDir: getArg("--agent-dir", args),
        ollamaUrl: getArg("--ollama-url", args),
        ollamaModel: getArg("--ollama-model", args),
        dbPath: getArg("--db-path", args),
        pluginDir: getArg("--plugin-dir", args),
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

    case "listRoutes":
    case "routes":
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
      } else {
        console.error(`❌ Unknown create command: ${args[0]}`);
        console.log("Available: ronin create plugin <name>, ronin create agent [description]");
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

    case "ask":
      // Check if first arg is a model name (grok, gemini, etc.)
      let question = args.join(" ");
      let model: string | undefined;
      
      // Check if first arg is a known model name
      const firstArg = args[0];
      const knownModels = ["grok", "gemini", "local", "ollama"];
      if (firstArg && !firstArg.startsWith("--") && knownModels.includes(firstArg)) {
        model = firstArg;
        question = args.slice(1).join(" ");
      }
      
      await askCommand({
        question: question || undefined,
        model: model || getArg("--model", args),
        agentDir: getArg("--agent-dir", args),
        pluginDir: getArg("--plugin-dir", args),
        ollamaUrl: getArg("--ollama-url", args),
        ollamaModel: getArg("--ollama-model", args),
        dbPath: getArg("--db-path", args),
        showSources: args.includes("--sources"),
      });
      break;

    case "config":
      await configCommand({
        agentDir: getArg("--agent-dir", args),
        externalAgentDir: getArg("--external-agent-dir", args),
        grokApiKey: getArg("--grok-api-key", args),
        geminiApiKey: getArg("--gemini-api-key", args),
        geminiModel: getArg("--gemini-model", args),
        show: args.includes("--show"),
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
          console.log("Usage: ronin realm connect --url ws://realm.example.com:3000 --callsign Leerie");
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

    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

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

function getArg(flag: string, args: string[]): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return undefined;
}

function printHelp() {
  console.log(`
Ronin - Bun AI Agent Library

Usage: ronin <command> [options]

Commands:
  start              Start and schedule all agents
  run <agent-name>   Run a specific agent manually
  list               List all available agents
  ai <command>       Manage AI definitions (local registry)
  models <command>   Alias for ai
  listRoutes         List all registered server routes
  status             Show runtime status and active schedules
  create plugin <name> Create a new plugin template
  create agent [desc]  AI-powered agent creation (interactive)
                        Use --local to create in ~/.ronin/agents
  cancel agent-creation [taskId] Cancel active agent creation
                        Omit taskId to cancel all active creations
  plugins list       List all loaded plugins
  plugins info <name> Show detailed plugin information
  ask [model] [question] Ask questions about Ronin (interactive)
                        Models: local (default), grok, gemini
                        Example: ronin ask grok "question"
                        Example: ronin ask gemini "question"
  config              Manage configuration (agent directories, etc.)
                        ronin config --show
                        ronin config --external-agent-dir <path>
  docs [doc]          View documentation in browser
                        ronin docs CLI
                        ronin docs --list
                        ronin docs --terminal
  realm connect      Connect to Realm discovery server
                        ronin realm connect --url ws://realm.example.com:3000 --callsign Leerie
  realm status       Show Realm connection status
  realm discover     Discover a peer by call sign
                        ronin realm discover Tyro
  help               Show this help message

Options:
  --agent-dir <dir>     Agent directory (default: ./agents)
  --plugin-dir <dir>    Plugin directory (default: ./plugins)
  --ollama-url <url>    Ollama API URL (default: http://localhost:11434)
  --ollama-model <name> Ollama model name (default: qwen3:1.7b)
  --db-path <path>      Database file path (default: ronin.db)
  --port <number>       Server port (listRoutes only; default: 3000)

Examples:
  ronin start
  ronin run my-agent
  ronin list
  ronin ai list
  ronin listRoutes
  ronin status
`);
}

main().catch(error => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});

