import { createAPI } from "../../api/index.js";
import { AgentLoader } from "../../agent/AgentLoader.js";
import { AgentRegistry } from "../../agent/AgentRegistry.js";
import { loadConfig, ensureDefaultAgentDir, ensureDefaultExternalAgentDir, ensureDefaultUserPluginDir } from "./config.js";
import { ensureAiRegistry } from "./ai.js";

export interface StartOptions {
  agentDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
  userPluginDir?: string;
}

/**
 * Start command: Discover, load, and schedule all agents
 */
export async function startCommand(options: StartOptions = {}): Promise<void> {
  await ensureAiRegistry();
  // Load config from file if available
  const config = await loadConfig();
  // Default to ~/.ronin/agents if no agentDir specified
  const agentDir = options.agentDir || config.agentDir || ensureDefaultAgentDir();
  const externalAgentDir =
    process.env.RONIN_EXTERNAL_AGENT_DIR || config.externalAgentDir || ensureDefaultExternalAgentDir();
  const userPluginDir = options.userPluginDir || config.userPluginDir || ensureDefaultUserPluginDir();
  
  // Global error handlers to prevent crashes from unhandled errors
  process.on("uncaughtException", (error) => {
    console.error("⚠️  Uncaught exception (prevented crash):", error);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("⚠️  Unhandled rejection (prevented crash):", reason);
  });

  console.log("🚀 Starting Ronin Agent System...");
  console.log(`📁 Agent directory: ${agentDir}`);
  console.log(`📁 External agent directory: ${externalAgentDir}`);
  console.log(`📁 User plugins directory: ${userPluginDir}`);

  // Create API
  const api = await createAPI({
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    dbPath: options.dbPath,
    pluginDir: options.pluginDir || config.pluginDir,
    userPluginDir,
  });

  // Auto-connect to Realm if configured
  if (config.realmUrl && config.realmCallsign && api.realm) {
    try {
      console.log(`🔌 Connecting to Realm...`);
      await api.realm.init(
        config.realmUrl,
        config.realmCallsign,
        {
          token: config.realmToken,
          localWsPort: config.realmLocalPort ? parseInt(config.realmLocalPort) : undefined,
        }
      );
      console.log(`✅ Connected to Realm at ${config.realmUrl} as ${config.realmCallsign}`);
    } catch (error) {
      console.warn(`⚠️  Failed to connect to Realm: ${error instanceof Error ? error.message : String(error)}`);
      console.warn(`   Continuing startup without Realm connection...`);
    }
  } else if (api.realm) {
    console.log(`ℹ️  Realm not configured. Use 'ronin config --realm-url <url> --realm-callsign <callsign>' to enable`);
  }

  // Load agents
  const loader = new AgentLoader(agentDir, externalAgentDir);
  console.log("🔍 Discovering agents...");
  const agents = await loader.loadAllAgents(api);

  if (agents.length === 0) {
    console.warn("⚠️  No agents found!");
    return;
  }

  console.log(`✅ Loaded ${agents.length} agent(s)`);

  // Create registry and register all agents
  const registry = new AgentRegistry({
    files: api.files as any,
    http: api.http as any,
    events: api.events as any,
  });

  // Always start webhook server so status endpoint is available
  registry.startWebhookServerIfNeeded();

  registry.registerAll(agents);

  // Display status
  const status = registry.getStatus();
  console.log("\n📊 Agent Status:");
  console.log(`   Total agents: ${status.totalAgents}`);
  console.log(`   Scheduled: ${status.scheduledAgents}`);
  console.log(`   File watchers: ${status.watchedAgents}`);
  console.log(`   Webhooks: ${status.webhookAgents}`);

  console.log("\n✨ All agents are running. Press Ctrl+C to stop.\n");

  // Handle graceful shutdown
  const cleanup = () => {
    console.log("\n🛑 Shutting down...");
    registry.cleanup();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep process alive
  // The process will stay alive due to cron jobs and webhook server
}

