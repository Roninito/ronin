import { readFile } from "fs/promises";
import { join } from "path";
import { PluginLoader } from "../../plugins/PluginLoader.js";
import { AgentLoader } from "../../agent/AgentLoader.js";
import { createAPI } from "../../api/index.js";
import { getSystemTools } from "./ask-tools.js";
import { pluginsToTools } from "../../plugins/toolGenerator.js";

export interface SystemContext {
  plugins: string;
  agents: string;
  documentation: string;
  systemState: string;
}

/**
 * Gather plugin context information
 */
export async function gatherPluginContext(
  pluginDir: string = "./plugins"
): Promise<string> {
  try {
    const loader = new PluginLoader(pluginDir);
    const plugins = await loader.loadAllPlugins();

    if (plugins.length === 0) {
      return "No plugins are currently loaded.";
    }

    const pluginInfo = plugins.map((p) => {
      return `Plugin: ${p.name}
  Description: ${p.description}
  Methods: ${p.methods.join(", ")}
  File: ${p.filePath}`;
    });

    return `Loaded Plugins (${plugins.length}):\n${pluginInfo.join("\n\n")}`;
  } catch (error) {
    return `Error loading plugins: ${error}`;
  }
}

/**
 * Gather agent context information
 */
export async function gatherAgentContext(
  agentDir: string = "./agents",
  api: Awaited<ReturnType<typeof createAPI>>
): Promise<string> {
  try {
    const loader = new AgentLoader(agentDir);
    const agents = await loader.loadAllAgents(api);

    if (agents.length === 0) {
      return "No agents are currently loaded.";
    }

    const agentInfo = agents.map((a) => {
      const parts = [`Agent: ${a.name}`, `  File: ${a.filePath}`];
      if (a.schedule) parts.push(`  Schedule: ${a.schedule}`);
      if (a.watch && a.watch.length > 0)
        parts.push(`  Watch: ${a.watch.join(", ")}`);
      if (a.webhook) parts.push(`  Webhook: ${a.webhook}`);
      return parts.join("\n");
    });

    return `Loaded Agents (${agents.length}):\n${agentInfo.join("\n\n")}`;
  } catch (error) {
    return `Error loading agents: ${error}`;
  }
}

/**
 * Gather documentation content
 */
export async function gatherDocumentation(
  projectRoot: string = "."
): Promise<string> {
  const docFiles = [
    "README.md",
    "docs/ARCHITECTURE.md",
    "docs/PLUGINS.md",
    "docs/TOOL_CALLING.md",
    "AGENTS.md",
    "TESTING.md",
  ];

  const docs: string[] = [];

  for (const file of docFiles) {
    try {
      const path = join(projectRoot, file);
      const content = await readFile(path, "utf-8");
      docs.push(`=== ${file} ===\n${content}\n`);
    } catch (error) {
      // File doesn't exist, skip
    }
  }

  return docs.join("\n");
}

/**
 * Gather system state information
 */
export async function gatherSystemState(): Promise<string> {
  const state = [
    `Current working directory: ${process.cwd()}`,
    `Node/Bun version: ${process.version}`,
    `Platform: ${process.platform}`,
  ];

  // Add environment variables if relevant
  if (process.env.OLLAMA_URL) {
    state.push(`OLLAMA_URL: ${process.env.OLLAMA_URL}`);
  }
  if (process.env.OLLAMA_MODEL) {
    state.push(`OLLAMA_MODEL: ${process.env.OLLAMA_MODEL}`);
  }

  return `System State:\n${state.join("\n")}`;
}

/**
 * Build complete context prompt for AI
 */
export async function buildContextPrompt(
  agentDir: string = "./agents",
  pluginDir: string = "./plugins",
  projectRoot: string = ".",
  api?: Awaited<ReturnType<typeof createAPI>>
): Promise<string> {
  const [plugins, agents, docs, state] = await Promise.all([
    gatherPluginContext(pluginDir),
    api ? gatherAgentContext(agentDir, api) : Promise.resolve("Agents not loaded"),
    gatherDocumentation(projectRoot),
    gatherSystemState(),
  ]);

  // Get tool definitions
  const systemTools = getSystemTools();
  const pluginTools = api ? pluginsToTools(
    (await new PluginLoader(pluginDir).loadAllPlugins()).map(p => p.plugin)
  ) : [];

  const allTools = [...systemTools, ...pluginTools];
  const toolsDescription = allTools.map(tool => {
    const func = tool.function;
    const params = Object.entries(func.parameters.properties || {})
      .map(([name, schema]) => {
        const required = func.parameters.required?.includes(name) ? " (required)" : "";
        return `    - ${name}: ${schema.type}${required} - ${schema.description || ""}`;
      })
      .join("\n");
    
    return `  ${func.name}: ${func.description}
    Parameters:
${params || "    (none)"}`;
  }).join("\n\n");

  return `You are a helpful assistant for the Ronin AI Agent Library. You help users understand:
- How Ronin works internally
- Available plugins and how to use them
- Available agents and their purposes
- Architecture and design decisions
- API capabilities and usage examples
- Code structure and organization
- File system contents and structure

When answering questions:
- Be specific and accurate
- Reference source files when relevant (show file paths)
- Provide code examples when helpful
- Explain both "what" and "why"
- Suggest best practices
- USE TOOLS to gather dynamic information when needed (file listings, file contents, etc.)

IMPORTANT: You have access to tools/functions that you can call to gather information. When a user asks about:
- Files in a directory → use list_files tool
- File contents → use read_file tool
- Plugin information → use list_plugins tool
- Agent information → use list_agents tool
- System information → use get_system_info tool

Always use tools to get current, accurate information rather than guessing.

Available Tools:

${toolsDescription}

Current System Context:

${plugins}

${agents}

${state}

Documentation:

${docs}

Remember to cite sources when referencing specific files or documentation.`;
}

