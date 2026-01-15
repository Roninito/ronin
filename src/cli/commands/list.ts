import { createAPI } from "../../api/index.js";
import { AgentLoader } from "../../agent/AgentLoader.js";
import { AgentRegistry } from "../../agent/AgentRegistry.js";
import { loadConfig, ensureDefaultAgentDir, ensureDefaultExternalAgentDir } from "./config.js";

export interface ListOptions {
  agentDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
}

/**
 * List command: Show all registered agents and their schedules
 */
export async function listCommand(options: ListOptions = {}): Promise<void> {
  const config = await loadConfig();
  const agentDir = options.agentDir || config.agentDir || ensureDefaultAgentDir();
  const externalAgentDir =
    process.env.RONIN_EXTERNAL_AGENT_DIR || config.externalAgentDir || ensureDefaultExternalAgentDir();

  // Create API
  const api = await createAPI({
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    dbPath: options.dbPath,
    pluginDir: options.pluginDir,
  });

  // Load agents
  const loader = new AgentLoader(agentDir, externalAgentDir);
  const agents = await loader.loadAllAgents(api);

  if (agents.length === 0) {
    console.log("No agents found.");
    return;
  }

  console.log(`\n📋 Found ${agents.length} agent(s):\n`);

  for (const agent of agents) {
    console.log(`🤖 ${agent.name}`);
    if (agent.schedule) {
      console.log(`   Schedule: ${agent.schedule}`);
    }
    if (agent.watch && agent.watch.length > 0) {
      console.log(`   Watch: ${agent.watch.join(", ")}`);
    }
    if (agent.webhook) {
      console.log(`   Webhook: ${agent.webhook}`);
    }
    console.log();
  }
}

