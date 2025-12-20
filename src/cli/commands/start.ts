import { createAPI } from "../../api/index.js";
import { AgentLoader } from "../../agent/AgentLoader.js";
import { AgentRegistry } from "../../agent/AgentRegistry.js";

export interface StartOptions {
  agentDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
}

/**
 * Start command: Discover, load, and schedule all agents
 */
export async function startCommand(options: StartOptions = {}): Promise<void> {
  const agentDir = options.agentDir || "./agents";
  
  console.log("🚀 Starting Ronin Agent System...");
  console.log(`📁 Agent directory: ${agentDir}`);

  // Create API
  const api = await createAPI({
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    dbPath: options.dbPath,
    pluginDir: options.pluginDir,
  });

  // Load agents
  const loader = new AgentLoader(agentDir);
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
  });

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

