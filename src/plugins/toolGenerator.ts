import type { Plugin } from "./base.js";
import type { Tool } from "../types/api.js";

/**
 * Convert a plugin method to a tool definition for Ollama function calling
 */
export function pluginMethodToTool(
  pluginName: string,
  methodName: string,
  method: (...args: unknown[]) => unknown | Promise<unknown>
): Tool {
  // Infer parameter types from function signature
  // For now, we'll use a generic object type
  // In a more advanced implementation, we could use TypeScript reflection
  // or require plugin authors to provide schema definitions

  const tool: Tool = {
    type: "function",
    function: {
      name: `${pluginName}_${methodName}`,
      description: `Call ${methodName} method from ${pluginName} plugin`,
      parameters: {
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
    tools.push(pluginMethodToTool(plugin.name, methodName, method));
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

