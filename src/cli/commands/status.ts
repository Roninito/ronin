import { createAPI } from "../../api/index.js";
import { AgentLoader } from "../../agent/AgentLoader.js";
import { AgentRegistry } from "../../agent/AgentRegistry.js";
import { loadConfig, ensureDefaultAgentDir } from "./config.js";

export interface StatusOptions {
  agentDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
}

/**
 * Check if Ronin is running and get status from running instance
 */
async function checkRunningInstance(port: number = 3000): Promise<any | null> {
  try {
    const response = await fetch(`http://localhost:${port}/api/status`, {
      signal: AbortSignal.timeout(2000), // 2 second timeout
    });
    
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    // Server not running or not accessible
    return null;
  }
  return null;
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

/**
 * Status command: Show runtime info and active schedules
 */
export async function statusCommand(options: StatusOptions = {}): Promise<void> {
  try {
    const webhookPort = process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : 3000;
    
    // First, try to get status from running instance
    const runningStatus = await checkRunningInstance(webhookPort);
    
    if (runningStatus && runningStatus.running) {
    // Show status from running instance
    console.log("\n📊 Ronin Agent System Status (Running Instance)\n");
    console.log(`🟢 Status: Running`);
    console.log(`   Port: ${runningStatus.port}`);
    console.log(`   PID: ${runningStatus.pid}`);
    console.log(`   Uptime: ${formatUptime(runningStatus.uptime)}`);
    console.log(`\n   Total Agents: ${runningStatus.totalAgents}`);
    console.log(`   Scheduled: ${runningStatus.scheduledAgents}`);
    console.log(`   File Watchers: ${runningStatus.watchedAgents}`);
    console.log(`   Webhooks: ${runningStatus.webhookAgents}`);

    if (runningStatus.agents && runningStatus.agents.length > 0) {
      console.log("\n🤖 Agents:\n");
      for (const agent of runningStatus.agents) {
        console.log(`   ${agent.name}`);
        if (agent.schedule) console.log(`      ⏰ ${agent.schedule}`);
        if (agent.watch && agent.watch.length > 0) {
          console.log(`      👁️  ${agent.watch.join(", ")}`);
        }
        if (agent.webhook) console.log(`      🔗 ${agent.webhook}`);
      }
    }
    console.log();
    return;
  }

  // If not running, show what would be loaded
  console.log("🔴 Ronin is not currently running\n");
  console.log("📋 Agent Configuration (would be loaded on start):\n");

  // Load config
  const config = await loadConfig();
  // Use same default logic as start command
  const agentDir = options.agentDir || config.agentDir || ensureDefaultAgentDir();
  const externalAgentDir = process.env.RONIN_EXTERNAL_AGENT_DIR || config.externalAgentDir;

  console.log(`   Agent directory: ${agentDir}`);
  if (externalAgentDir) {
    console.log(`   External agent directory: ${externalAgentDir}`);
  }

  // Create API and load agents to show what would be registered
  // Note: We don't actually register them to avoid scheduling/executing
  const api = await createAPI({
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    dbPath: options.dbPath,
    pluginDir: options.pluginDir,
  });

  // Load agents (but don't register them - just get metadata)
  const loader = new AgentLoader(agentDir);
  const agents = await loader.loadAllAgents(api);

  // Calculate status without actually registering (to avoid scheduling)
  const totalAgents = agents.length;
  const scheduledAgents = agents.filter(a => a.schedule).length;
  const watchedAgents = agents.filter(a => a.watch && a.watch.length > 0).length;
  const webhookAgents = agents.filter(a => a.webhook).length;
  
  const status = {
    totalAgents,
    scheduledAgents,
    watchedAgents,
    webhookAgents,
    agents: agents.map(a => ({
      name: a.name,
      schedule: a.schedule,
      watch: a.watch,
      webhook: a.webhook,
    })),
  };

  console.log(`\n   Total Agents: ${status.totalAgents}`);
  console.log(`   Scheduled: ${status.scheduledAgents}`);
  console.log(`   File Watchers: ${status.watchedAgents}`);
  console.log(`   Webhooks: ${status.webhookAgents}`);

  if (status.agents.length > 0) {
    console.log("\n🤖 Agents:\n");
    for (const agent of status.agents) {
      console.log(`   ${agent.name}`);
      if (agent.schedule) console.log(`      ⏰ ${agent.schedule}`);
      if (agent.watch && agent.watch.length > 0) {
        console.log(`      👁️  ${agent.watch.join(", ")}`);
      }
      if (agent.webhook) console.log(`      🔗 ${agent.webhook}`);
    }
  }

    console.log("\n💡 To start Ronin, run: ronin start");
    console.log();
  } catch (error) {
    console.error("❌ Error getting status:", error);
    process.exit(1);
  }
}

