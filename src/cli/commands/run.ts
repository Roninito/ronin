import { createAPI } from "../../api/index.js";
import { AgentLoader } from "../../agent/AgentLoader.js";
import { AgentRegistry } from "../../agent/AgentRegistry.js";
import { loadConfig, ensureDefaultAgentDir, ensureDefaultExternalAgentDir } from "./config.js";
import { logger } from "../../utils/logger.js";

export interface RunOptions {
  agentName: string;
  agentDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
}

/**
 * Run command: Execute a specific agent manually
 */
export async function runCommand(options: RunOptions): Promise<void> {
  const config = await loadConfig();
  const agentDir = options.agentDir || config.agentDir || ensureDefaultAgentDir();
  const externalAgentDir =
    process.env.RONIN_EXTERNAL_AGENT_DIR || config.externalAgentDir || ensureDefaultExternalAgentDir();

  logger.info(`Running agent: ${options.agentName}`);

  // Create API (use fast model by default for agent execution speed)
  const api = await createAPI({
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    useFastModelForAgents: true,
    dbPath: options.dbPath,
    pluginDir: options.pluginDir || config.pluginDir,
  });

  // Load agents
  const loader = new AgentLoader(agentDir, externalAgentDir);
  const agents = await loader.loadAllAgents(api);

  // Find the agent
  const agent = agents.find(a => a.name === options.agentName);
  if (!agent) {
    logger.error("Agent not found", { agent: options.agentName, available: agents.map(a => a.name) });
    process.exit(1);
  }

  // Execute the agent
  try {
    await agent.instance.execute();
    logger.info(`Agent ${options.agentName} completed successfully`);
  } catch (error) {
    logger.error("Error executing agent", { agent: options.agentName, error });
    process.exit(1);
  }
}

