import type { Plugin, PluginMethodMeta } from "./base.js";
import type { Tool } from "../types/api.js";

/**
 * Convert a plugin method to a tool definition for Ollama function calling.
 * Uses the plugin's declared toolMetadata for this method when present (real
 * description + named parameter schema); otherwise falls back to a generic,
 * low-information description with a single untyped "args" array — the model has
 * to guess both what the tool does and how to call it in that fallback case.
 */
export function pluginMethodToTool(
  pluginName: string,
  methodName: string,
  method: (...args: unknown[]) => unknown | Promise<unknown>,
  meta?: PluginMethodMeta
): Tool {
  const tool: Tool = {
    type: "function",
    function: {
      name: `${pluginName}_${methodName}`,
      description: meta?.description || `Call ${methodName} method from ${pluginName} plugin`,
      parameters: meta?.parameters || {
        type: "object",
        properties: {
          // Generic parameters - plugin authors should document expected args
          args: {
            type: "array",
            description: `Arguments for ${pluginName}.${methodName}`,
          },
        },
        required: [],
      },
    },
  };

  return tool;
}

/**
 * Convert a plugin to tool definitions for all its methods
 */
export function pluginToTools(plugin: Plugin): Tool[] {
  const tools: Tool[] = [];

  for (const [methodName, method] of Object.entries(plugin.methods)) {
    tools.push(pluginMethodToTool(plugin.name, methodName, method, plugin.toolMetadata?.[methodName]));
  }

  return tools;
}

/**
 * Convert multiple plugins to tool definitions
 */
export function pluginsToTools(plugins: Plugin[]): Tool[] {
  const tools: Tool[] = [];

  for (const plugin of plugins) {
    tools.push(...pluginToTools(plugin));
  }

  return tools;
}

