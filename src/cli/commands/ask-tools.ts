import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type { Tool } from "../../types/api.js";
import { PluginLoader } from "../../plugins/PluginLoader.js";
import { DutyLoader } from "../../duty/DutyLoader.js";
import type { DutyAPI } from "../../types/api.js";
import { formatCronTable } from "../../utils/cron.js";

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
 * Get duty information
 */
async function getDutyInfo(
  dutyDir: string = "./duties",
  api: DutyAPI
): Promise<string> {
  try {
    const loader = new DutyLoader(dutyDir);
    const duties = await loader.loadAllDuties(api);

    if (duties.length === 0) {
      return "No duties found.";
    }

    const info = duties.map(d => {
      const parts = [`${d.name}: ${d.filePath}`];
      if (d.schedule) {
        parts.push(`  Schedule: ${d.schedule}`);
        const table = formatCronTable(d.schedule);
        parts.push(table.split('\n').map(line => `  ${line}`).join('\n'));
      }
      if (d.watch && d.watch.length > 0) parts.push(`  Watch: ${d.watch.join(", ")}`);
      if (d.webhook) parts.push(`  Webhook: ${d.webhook}`);
      return parts.join("\n");
    });

    return `Duties (${duties.length}):\n${info.join("\n\n")}`;
  } catch (error) {
    return `Error loading duties: ${error}`;
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
  api: DutyAPI,
  dutyDir: string = "./duties",
  pluginDir: string = "./plugins"
): Promise<unknown> {
  switch (toolName) {
    case "list_files":
      return await listFiles(args.directory as string, args.pattern as string | undefined);

    case "read_file":
      return await readFileContent(args.filePath as string);

    case "list_plugins":
      return await getPluginInfo(pluginDir);

    case "list_duties":
      return await getDutyInfo(dutyDir, api);

    case "get_system_info":
      return await getSystemInfo();

    default: {
      const availableTools = ["list_files", "read_file", "list_plugins", "list_duties", "get_system_info"];
      const suggestions = availableTools.filter(t => 
        t.includes(toolName) || (toolName.includes("list") && t.includes("list"))
      );
      throw new Error(
        `Unknown tool: "${toolName}". ` +
        `Available tools: ${availableTools.join(", ")}. ` +
        (suggestions.length > 0 ? `Did you mean: ${suggestions.join(" or ")}?` : "")
      );
    }
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
              description: "Directory path to list files from (e.g., 'plugins', './duties', 'src/cli')",
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
        name: "list_duties",
        description: "Get information about all loaded duties including their names, schedules, file watchers, and webhooks.",
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

