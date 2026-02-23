/**
 * Tools/Skills Indexer Agent
 * 
 * Runs daily to index all available tools and their metadata in the ontology.
 * Discovers tools from UnifiedToolRegistry
 * Stores: Tool metadata nodes and relationships in ontology
 */

import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { createToolMetadataNode, linkToolToDomain, type ToolMetadataNode } from "../src/ontology/schemas.js";

export default class ToolsIndexerAgent extends BaseAgent {
  // Run daily at midnight
  static schedule = "0 0 * * *";

  constructor(api: AgentAPI) {
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

      // Store each tool in ontology
      let indexed = 0;
      for (const tool of tools) {
        try {
          if (this.api.ontology) {
            await createToolMetadataNode(this.api, {
              ...tool,
              collected_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
              source_agent: "tools-indexer",
            });

            // Create domain relationship
            if (tool.domain) {
              await linkToolToDomain(this.api, tool.tool_id, tool.domain);
            }

            indexed++;
          }
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

      // 1. Check if skills plugin is available
      if (this.api.ontology) {
        const skillResults = await this.api.ontology.search({
          type: "skill",
          limit: 1000,
        });

        for (const skill of skillResults) {
          tools.push({
            tool_id: skill.id,
            name: skill.name || skill.id,
            description: skill.summary || "Skill tool",
            domain: skill.domain || "skills",
            parameters: [],
            version: "1.0",
          });
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
        tool_id: "ontology.search",
        name: "Ontology Search",
        description: "Search the ontology for entities by type, name, or domain",
        domain: "ontology",
        parameters: [
          {
            name: "query",
            type: "string",
            description: "Search query",
            required: true,
          },
          {
            name: "domain",
            type: "string",
            description: "Filter by domain",
            required: false,
          },
        ],
        version: "1.0",
      },
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
