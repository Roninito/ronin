/**
 * Tools/Skills Indexer Agent
 *
 * Runs daily to index all available tools and their metadata.
 * Discovers tools from the skills plugin plus known system/common tools.
 * Stores: memory/notes/tool-<tool_id>.md, overwritten each run
 */

import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";

interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

interface ToolMetadataNode {
  tool_id: string;
  domain?: string;
  parameters: ToolParameter[];
  version: string;
}

export default class ToolsIndexerAgent extends BaseDuty {
  // Run daily at midnight
  static schedule = "0 0 * * *";

  constructor(api: DutyAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    try {
      console.log("[tools-indexer] Starting tools indexing...");

      // Get all tools
      const tools = await this.discoverTools();

      if (tools.length === 0) {
        console.warn("[tools-indexer] ⚠️ No tools found to index");
        return;
      }

      // Store each tool as a memory note
      let indexed = 0;
      for (const tool of tools) {
        try {
          await this.api.memory.store(`tool-${tool.tool_id}`, {
            ...tool,
            source_agent: "tools-indexer",
          });
          indexed++;
        } catch (error) {
          console.error(`[tools-indexer] Error indexing tool ${tool.tool_id}:`, error);
        }
      }

      console.log(`[tools-indexer] ✅ Indexed ${indexed}/${tools.length} tools`);

      // Log summary by domain
      this.logToolsSummary(tools);
    } catch (error) {
      console.error("[tools-indexer] ❌ Error indexing tools:", error);
    }
  }

  private async discoverTools(): Promise<
    Array<ToolMetadataNode & { name: string; description: string }>
  > {
    const tools: Array<ToolMetadataNode & { name: string; description: string }> = [];

    try {
      // Try to get tools from various sources

      // 1. Skills discovered via the skills plugin (installed AgentSkills)
      if (this.api.plugins.has("skills")) {
        try {
          const skillResults = (await this.api.plugins.call("skills", "discover_skills", "")) as Array<{
            name: string;
            description: string;
          }>;

          for (const skill of skillResults) {
            tools.push({
              tool_id: skill.name,
              name: skill.name,
              description: skill.description || "Skill tool",
              domain: "skills",
              parameters: [],
              version: "1.0",
            });
          }
        } catch (error) {
          console.warn("[tools-indexer] discover_skills failed:", error);
        }
      }

      // 2. Common Ronin skills (known skills)
      const commonSkills = this.getCommonSkills();
      tools.push(...commonSkills);

      // 3. System tools
      const systemTools = this.getSystemTools();
      tools.push(...systemTools);

      // Deduplicate by tool_id
      const seen = new Set<string>();
      return tools.filter((tool) => {
        if (seen.has(tool.tool_id)) return false;
        seen.add(tool.tool_id);
        return true;
      });
    } catch (error) {
      console.warn("[tools-indexer] Error discovering tools:", error);
      return tools;
    }
  }

  private getCommonSkills(): Array<ToolMetadataNode & { name: string; description: string }> {
    return [
      {
        tool_id: "memory.store",
        name: "Store Memory",
        description: "Store a value in agent memory",
        domain: "memory",
        parameters: [
          {
            name: "key",
            type: "string",
            description: "Memory key",
            required: true,
          },
          {
            name: "value",
            type: "string",
            description: "Value to store",
            required: true,
          },
        ],
        version: "1.0",
      },
      {
        tool_id: "memory.retrieve",
        name: "Retrieve Memory",
        description: "Retrieve a value from agent memory",
        domain: "memory",
        parameters: [
          {
            name: "key",
            type: "string",
            description: "Memory key",
            required: true,
          },
        ],
        version: "1.0",
      },
      {
        tool_id: "memory.search",
        name: "Search Memory",
        description: "Search agent memory by query",
        domain: "memory",
        parameters: [
          {
            name: "query",
            type: "string",
            description: "Search query",
            required: true,
          },
          {
            name: "limit",
            type: "number",
            description: "Max results",
            required: false,
          },
        ],
        version: "1.0",
      },
      {
        tool_id: "files.read",
        name: "Read File",
        description: "Read the contents of a file on disk",
        domain: "files",
        parameters: [
          {
            name: "path",
            type: "string",
            description: "Absolute path to the file",
            required: true,
          },
        ],
        version: "1.0",
      },
      {
        tool_id: "files.write",
        name: "Write File",
        description: "Write contents to a file on disk",
        domain: "files",
        parameters: [
          {
            name: "path",
            type: "string",
            description: "Absolute path to the file",
            required: true,
          },
          {
            name: "content",
            type: "string",
            description: "Content to write",
            required: true,
          },
        ],
        version: "1.0",
      },
      {
        tool_id: "shell.exec",
        name: "Execute Shell Command",
        description: "Execute a shell command and return output",
        domain: "shell",
        parameters: [
          {
            name: "command",
            type: "string",
            description: "Shell command to execute",
            required: true,
          },
          {
            name: "timeout",
            type: "number",
            description: "Timeout in milliseconds",
            required: false,
          },
        ],
        version: "1.0",
      },
      {
        tool_id: "skills.list",
        name: "List Available Skills",
        description: "List all available skills",
        domain: "skills",
        parameters: [],
        version: "1.0",
      },
      {
        tool_id: "skills.run",
        name: "Run Skill",
        description: "Execute a skill with given parameters",
        domain: "skills",
        parameters: [
          {
            name: "skill_id",
            type: "string",
            description: "Skill identifier",
            required: true,
          },
          {
            name: "params",
            type: "object",
            description: "Skill parameters",
            required: false,
          },
        ],
        version: "1.0",
      },
    ];
  }

  private getSystemTools(): Array<ToolMetadataNode & { name: string; description: string }> {
    return [
      {
        tool_id: "system.info",
        name: "Get System Info",
        description: "Get current system capabilities (CPU, memory, OS)",
        domain: "system",
        parameters: [],
        version: "1.0",
      },
      {
        tool_id: "system.environment",
        name: "Get Environment Variables",
        description: "Get non-sensitive environment variables",
        domain: "system",
        parameters: [],
        version: "1.0",
      },
    ];
  }

  private logToolsSummary(
    tools: Array<ToolMetadataNode & { name: string; description: string }>
  ): void {
    // Group by domain
    const byDomain: Record<string, number> = {};
    for (const tool of tools) {
      const domain = tool.domain || "unknown";
      byDomain[domain] = (byDomain[domain] || 0) + 1;
    }

    console.log(`
[tools-indexer] 🔧 Tools Summary:
  Total tools: ${tools.length}
  By domain:
    ${Object.entries(byDomain)
      .map(([domain, count]) => `${domain}: ${count}`)
      .join("\n    ")}
    `);
  }
}
