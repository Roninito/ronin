import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type { Tool } from "../../types/api.js";
import { PluginLoader } from "../../plugins/PluginLoader.js";
import { AgentLoader } from "../../agent/AgentLoader.js";
import type { AgentAPI } from "../../types/api.js";

/**
 * System tools that the AI can call to gather information
 */

/**
 * List files in a directory
 */
async function listFiles(directory: string, pattern?: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    let files = entries
      .filter(entry => entry.isFile())
      .map(entry => entry.name);

    if (pattern) {
      // Simple pattern matching (supports * wildcard)
      const regex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*").replace(/\./g, "\\.") + "$"
      );
      files = files.filter(file => regex.test(file));
    }

    return files;
  } catch (error) {
    throw new Error(`Failed to list files in ${directory}: ${error}`);
  }
}

/**
 * Read file contents
 */
async function readFileContent(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content;
  } catch (error) {
    throw new Error(`Failed to read file ${filePath}: ${error}`);
  }
}

/**
 * Get plugin information
 */
async function getPluginInfo(pluginDir: string = "./plugins"): Promise<string> {
  try {
    const loader = new PluginLoader(pluginDir);
    const plugins = await loader.loadAllPlugins();

    if (plugins.length === 0) {
      return "No plugins found.";
    }

    const info = plugins.map(p => {
      return `${p.name}: ${p.description}\n  Methods: ${p.methods.join(", ")}\n  File: ${p.filePath}`;
    });

    return `Plugins (${plugins.length}):\n${info.join("\n\n")}`;
  } catch (error) {
    return `Error loading plugins: ${error}`;
  }
}

/**
 * Get agent information
 */
async function getAgentInfo(
  agentDir: string = "./agents",
  api: AgentAPI
): Promise<string> {
  try {
    const loader = new AgentLoader(agentDir);
    const agents = await loader.loadAllAgents(api);

    if (agents.length === 0) {
      return "No agents found.";
    }

    const info = agents.map(a => {
      const parts = [`${a.name}: ${a.filePath}`];
      if (a.schedule) parts.push(`  Schedule: ${a.schedule}`);
      if (a.watch && a.watch.length > 0) parts.push(`  Watch: ${a.watch.join(", ")}`);
      if (a.webhook) parts.push(`  Webhook: ${a.webhook}`);
      return parts.join("\n");
    });

    return `Agents (${agents.length}):\n${info.join("\n\n")}`;
  } catch (error) {
    return `Error loading agents: ${error}`;
  }
}

/**
 * Get system information
 */
async function getSystemInfo(): Promise<string> {
  const info = [
    `Working Directory: ${process.cwd()}`,
    `Platform: ${process.platform}`,
    `Node/Bun Version: ${process.version}`,
  ];

  if (process.env.OLLAMA_URL) {
    info.push(`OLLAMA_URL: ${process.env.OLLAMA_URL}`);
  }
  if (process.env.OLLAMA_MODEL) {
    info.push(`OLLAMA_MODEL: ${process.env.OLLAMA_MODEL}`);
  }

  return info.join("\n");
}

/**
 * Execute a tool call
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  api: AgentAPI,
  agentDir: string = "./agents",
  pluginDir: string = "./plugins"
): Promise<unknown> {
  switch (toolName) {
    case "list_files":
      return await listFiles(args.directory as string, args.pattern as string | undefined);

    case "read_file":
      return await readFileContent(args.filePath as string);

    case "list_plugins":
      return await getPluginInfo(pluginDir);

    case "list_agents":
      return await getAgentInfo(agentDir, api);

    case "get_system_info":
      return await getSystemInfo();

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * Get all available system tools as Tool definitions
 */
export function getSystemTools(): Tool[] {
  return [
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List files in a directory. Use this to answer questions about what files exist in a folder, directory contents, or file listings.",
        parameters: {
          type: "object",
          properties: {
            directory: {
              type: "string",
              description: "Directory path to list files from (e.g., 'plugins', './agents', 'src/cli')",
            },
            pattern: {
              type: "string",
              description: "Optional file pattern filter (e.g., '*.ts', '*.md'). Supports * wildcard.",
            },
          },
          required: ["directory"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the contents of a file. Use this to answer questions about file contents, code, or documentation.",
        parameters: {
          type: "object",
          properties: {
            filePath: {
              type: "string",
              description: "Path to the file to read (e.g., 'plugins/git.ts', 'README.md')",
            },
          },
          required: ["filePath"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_plugins",
        description: "Get information about all loaded plugins including their names, descriptions, methods, and file paths.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_agents",
        description: "Get information about all loaded agents including their names, schedules, file watchers, and webhooks.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_system_info",
        description: "Get system information including working directory, platform, and environment variables.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
  ];
}

