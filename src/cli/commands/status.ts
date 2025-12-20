import { createAPI } from "../../api/index.js";
import { AgentLoader } from "../../agent/AgentLoader.js";
import { AgentRegistry } from "../../agent/AgentRegistry.js";

export interface StatusOptions {
  agentDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
}

/**
 * Status command: Show runtime info and active schedules
 */
export async function statusCommand(options: StatusOptions = {}): Promise<void> {
  const agentDir = options.agentDir || "./agents";

  // Create API
  const api = await createAPI({
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    dbPath: options.dbPath,
    pluginDir: options.pluginDir,
  });

  // Load agents
  const loader = new AgentLoader(agentDir);
  const agents = await loader.loadAllAgents(api);

  // Create registry to get status
  const registry = new AgentRegistry({
    files: api.files as any,
    http: api.http as any,
  });

  registry.registerAll(agents);
  const status = registry.getStatus();

  console.log("\n📊 Ronin Agent System Status\n");
  console.log(`Total Agents: ${status.totalAgents}`);
  console.log(`Scheduled: ${status.scheduledAgents}`);
  console.log(`File Watchers: ${status.watchedAgents}`);
  console.log(`Webhooks: ${status.webhookAgents}`);

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

  console.log();
}

