/**
 * @enabled true
 * Agent Registry — Scans and catalogs all agents in the system
 * Extracts metadata and dependencies to populate dashboard
 */

import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { readdir, readFile } from "fs/promises";
import { join } from "path";

interface AgentMetadata {
  name: string;
  enabled: boolean;
  schedule?: string;
  watch?: string[];
  webhook?: string;
  requiredPlugins: string[];
  emitsEvents: string[];
  consumesEvents: string[];
  description?: string;
}

export default class AgentRegistry extends BaseAgent {
  static schedule = "0 * * * *"; // Every hour
  static description = "Scans and catalogs all agents in the system";

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    try {
      const metadata = await this.scanAgents();
      await this.api.memory.store("agent-registry", metadata);
      console.log(`[agent-registry] Cataloged ${metadata.length} agents`);
    } catch (error) {
      console.error("[agent-registry] Error scanning agents:", error);
    }
  }

  /**
   * Scan all agent files and extract metadata
   */
  private async scanAgents(): Promise<AgentMetadata[]> {
    const agentsDir = join(process.cwd(), "agents");
    const files = await readdir(agentsDir);
    const agents: AgentMetadata[] = [];

    for (const file of files) {
      if (!file.endsWith(".ts")) continue;

      const filePath = join(agentsDir, file);
      try {
        const content = await readFile(filePath, "utf-8");
        const metadata = this.parseAgentFile(file, content);
        if (metadata) {
          agents.push(metadata);
        }
      } catch (error) {
        console.warn(`[agent-registry] Failed to parse ${file}:`, error);
      }
    }

    return agents;
  }

  /**
   * Parse a single agent file and extract metadata
   */
  private parseAgentFile(filename: string, content: string): AgentMetadata | null {
    const name = filename.replace(/\.ts$/, "");

    // Check if enabled (default true)
    const enabledMatch = content.match(/@enabled\s+(true|false|"true"|"false")/i);
    const enabled = !enabledMatch || enabledMatch[1] !== "false";

    // Extract static schedule
    const scheduleMatch = content.match(/static\s+schedule\s*=\s*["']([^"']+)["']/);
    const schedule = scheduleMatch?.[1];

    // Extract static watch
    const watchMatches = [...content.matchAll(/static\s+watch\s*=\s*\[([\s\S]*?)\]/g)];
    const watch: string[] = [];
    for (const match of watchMatches) {
      const items = match[1].match(/["']([^"']+)["']/g);
      if (items) {
        watch.push(...items.map((s) => s.replace(/["']/g, "")));
      }
    }

    // Extract static webhook
    const webhookMatch = content.match(/static\s+webhook\s*=\s*["']([^"']+)["']/);
    const webhook = webhookMatch?.[1];

    // Extract description
    const descMatch = content.match(/static\s+description\s*=\s*["']([^"']+)["']/);
    const description = descMatch?.[1];

    // Extract API plugin usage (this.api.PLUGIN)
    const pluginUsageMatches = [...content.matchAll(/this\.api\.(\w+)\./g)];
    const requiredPlugins = [...new Set(pluginUsageMatches.map((m) => m[1]))];

    // Extract event emissions
    const emitMatches = [...content.matchAll(/this\.api\.events\.emit\(["']([^"']+)["']/g)];
    const emitsEvents = [...new Set(emitMatches.map((m) => m[1]))];

    // Extract event listeners
    const onMatches = [...content.matchAll(/this\.api\.events\.on\(["']([^"']+)["']/g)];
    const consumesEvents = [...new Set(onMatches.map((m) => m[1]))];

    return {
      name,
      enabled,
      schedule,
      watch: watch.length > 0 ? watch : undefined,
      webhook,
      description,
      requiredPlugins: requiredPlugins.filter((p) => p !== "memory" && p !== "files" && p !== "events"),
      emitsEvents,
      consumesEvents,
    };
  }
}
