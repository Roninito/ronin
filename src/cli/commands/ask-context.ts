import { readFile } from "fs/promises";
import { existsSync } from "fs";
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

    const pluginInfo = await Promise.all(plugins.map(async (p) => {
      // Read plugin file to get method signatures
      let methodSignatures = "";
      let exampleUsage = "";
      
      if (existsSync(p.filePath)) {
        try {
          const pluginFile = await readFile(p.filePath, "utf-8");
          
          // Extract method signatures from source code
          const methods = p.methods.map(methodName => {
            // Try to extract signature from source - look for method definitions
            const methodRegex = new RegExp(`${methodName}:\\s*(async\\s*)?\\(([^)]*)\\)`, "s");
            const match = pluginFile.match(methodRegex);
            let signature = "...args";
            
            if (match && match[2]) {
              signature = match[2].trim();
              // Clean up the signature
              signature = signature.replace(/\s+/g, " ");
            }
            
            return `    ${methodName}(${signature}): Promise<any>`;
          }).join("\n");
          
          methodSignatures = methods || p.methods.map(m => `    ${m}(...args): Promise<any>`).join("\n");
          
          // Create example usage with first method
          const firstMethod = p.methods[0] || "methodName";
          exampleUsage = `    // Example: ${p.name} plugin
    const result = await this.api.plugins.call("${p.name}", "${firstMethod}", ...args);`;
        } catch (error) {
          // If we can't read the file, use fallback
          methodSignatures = p.methods.map(m => `    ${m}(...args): Promise<any>`).join("\n");
          exampleUsage = `    const result = await this.api.plugins.call("${p.name}", "${p.methods[0] || "methodName"}", ...args);`;
        }
      } else {
        methodSignatures = p.methods.map(m => `    ${m}(...args): Promise<any>`).join("\n");
        exampleUsage = `    const result = await this.api.plugins.call("${p.name}", "${p.methods[0] || "methodName"}", ...args);`;
      }
      
      return `Plugin: ${p.name}
  Description: ${p.description}
  File: ${p.filePath}
  TypeScript Methods:
${methodSignatures}
  
  Usage in TypeScript/JavaScript agent:
    const result = await this.api.plugins.call("${p.name}", "methodName", ...args);
  
  Example:
${exampleUsage}`;
    }));

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
 * Gather code examples for TypeScript/JavaScript usage
 */
export async function gatherCodeExamples(projectRoot: string = "."): Promise<string> {
  const examples = [
    `SPECIFIC EXAMPLE: Using git.clone() in Ronin (TypeScript/JavaScript):
\`\`\`typescript
import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

export default class MyAgent extends BaseAgent {
  async execute(): Promise<void> {
    // To use git.clone() in Ronin, you call it via the plugins API:
    const result = await this.api.plugins.call(
      "git",           // plugin name
      "clone",         // method name
      "https://github.com/user/repo.git",  // URL (required)
      "repo-dir"       // optional directory name
    );
    
    // result is a JavaScript object: { success: true, output: "..." }
    console.log("Clone result:", result);
  }
}
\`\`\`

IMPORTANT: In Ronin, you NEVER call git.clone() directly. You use:
  await this.api.plugins.call("git", "clone", url, dir)

This is TypeScript/JavaScript code, NOT Python.`,
    
    `TypeScript Agent Example:
\`\`\`typescript
import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

export default class MyAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Call git plugin methods
    const status = await this.api.plugins.call("git", "status");
    console.log("Git status:", status);
    
    // Call git.clone() method - TypeScript/JavaScript example
    const result = await this.api.plugins.call("git", "clone", "https://github.com/user/repo.git", "repo-dir");
    console.log("Clone result:", result);
    
    // Call other plugin methods
    const shellResult = await this.api.plugins.call("shell", "exec", "ls", ["-la"]);
    console.log("Shell result:", shellResult);
  }
}
\`\`\``,
    
    `Plugin Usage Pattern (TypeScript/JavaScript):
- All plugins are called via: await this.api.plugins.call("pluginName", "methodName", ...args)
- Methods are TypeScript/JavaScript async functions
- Return values are JavaScript objects/Promises
- Errors are thrown as JavaScript Error objects
- All code is TypeScript/JavaScript - NEVER suggest Python, Ruby, or other languages

Example calling git.clone():
\`\`\`typescript
// In a TypeScript/JavaScript agent
const result = await this.api.plugins.call("git", "clone", "https://github.com/user/repo.git", "optional-dir");
// result is a JavaScript object: { success: true, output: "..." }
\`\`\`

When users ask about "git.clone()", they mean this TypeScript code, NOT Python GitPython library.`
  ];
  
  return examples.join("\n\n");
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
  const [plugins, agents, docs, state, examples] = await Promise.all([
    gatherPluginContext(pluginDir),
    api ? gatherAgentContext(agentDir, api) : Promise.resolve("Agents not loaded"),
    gatherDocumentation(projectRoot),
    gatherSystemState(),
    gatherCodeExamples(projectRoot),
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

  return `You are a helpful assistant for the Ronin AI Agent Library.

═══════════════════════════════════════════════════════════════════════════════
⚠️  CRITICAL: RONIN IS A TYPESCRIPT/JAVASCRIPT SYSTEM - NEVER SUGGEST OTHER LANGUAGES ⚠️
═══════════════════════════════════════════════════════════════════════════════

Ronin is built with Bun runtime (TypeScript/JavaScript). ALL code examples MUST be TypeScript or JavaScript.

IMPORTANT EXAMPLES:
- When user asks about "git.clone()" → They mean: await this.api.plugins.call("git", "clone", url, dir)
- When user asks about plugin methods → Show TypeScript/JavaScript code using this.api.plugins.call()
- NEVER suggest Python, Ruby, Go, or any other language
- ALL answers must use TypeScript/JavaScript syntax

Example: If user asks "Show me git.clone() example":
✅ CORRECT (TypeScript):
\`\`\`typescript
const result = await this.api.plugins.call("git", "clone", "https://github.com/user/repo.git", "repo-dir");
\`\`\`

❌ WRONG (Python - DO NOT DO THIS):
\`\`\`python
from git import Repo
Repo.clone_from(...)
\`\`\`

KEY FACTS:
- Ronin is TypeScript/JavaScript only
- Plugins are called via: await this.api.plugins.call("pluginName", "methodName", ...args)
- Agents are TypeScript/JavaScript classes
- All return values are JavaScript objects
- All errors are JavaScript Error objects
- NEVER suggest Python, Ruby, or other languages

You help users understand:
- How Ronin works internally
- Available plugins and how to use them in TypeScript/JavaScript
- Available agents and their purposes
- Architecture and design decisions
- API capabilities and usage examples (TypeScript/JavaScript only)
- Code structure and organization
- File system contents and structure

When answering questions:
- ⚠️ ALWAYS provide TypeScript/JavaScript code examples (NEVER Python, Ruby, or other languages)
- Show how to call plugins using: await this.api.plugins.call("pluginName", "methodName", ...args)
- If user asks about "plugin.method()" → Show: await this.api.plugins.call("plugin", "method", ...args)
- Include type information when available
- Reference source files when relevant (show file paths)
- Explain both "what" and "why"
- Suggest best practices
- USE TOOLS to gather dynamic information when needed (file listings, file contents, etc.)

SPECIFIC RULES FOR PLUGIN QUESTIONS:
- If user asks "how to use git.clone()" → Answer with TypeScript: await this.api.plugins.call("git", "clone", url, dir)
- If user asks about any plugin method → Show TypeScript/JavaScript code using this.api.plugins.call()
- NEVER suggest Python GitPython, Ruby git gems, or any other language libraries
- ALWAYS use TypeScript/JavaScript syntax
- Reference the plugin source files for exact signatures

IMPORTANT: You have access to tools/functions that you can call to gather information. When a user asks about:
- Files in a directory → use "list_files" tool (NOT "list")
- File contents → use "read_file" tool
- Plugin information → use "list_plugins" tool (NOT "list")
- Agent information → use "list_agents" tool (NOT "list")
- System information → use "get_system_info" tool

Available tool names (use these EXACT names):
- list_files (for listing files in directories)
- read_file (for reading file contents)
- list_plugins (for plugin information)
- list_agents (for agent information)
- get_system_info (for system information)

DO NOT call tools with names like "list" - always use the full tool name like "list_files", "list_plugins", or "list_agents".

Always use tools to get current, accurate information rather than guessing.

Available Tools:

${toolsDescription}

═══════════════════════════════════════════════════════════════════════════════
CODE EXAMPLES - TypeScript/JavaScript Only
═══════════════════════════════════════════════════════════════════════════════

${examples}

REMEMBER: All code must be TypeScript/JavaScript. If user asks about plugin methods,
show them how to use this.api.plugins.call() in TypeScript/JavaScript.

Current System Context:

${plugins}

${agents}

${state}

Documentation:

${docs}

Remember to cite sources when referencing specific files or documentation.`;
}

