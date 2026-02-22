/**
 * @enabled true
 * Plugin Manager — Tracks loaded plugins and their usage
 * Maintains plugin registry for dashboard visualization
 */

import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

interface PluginMetadata {
  name: string;
  methods: string[];
  usedByAgents: string[];
  status: "loaded" | "failed" | "disabled";
}

export default class PluginManager extends BaseAgent {
  static schedule = "*/5 * * * *"; // Every 5 minutes
  static description = "Tracks loaded plugins and their usage patterns";

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    try {
      const pluginRegistry = await this.buildPluginRegistry();
      await this.api.memory.store("plugin-registry", pluginRegistry);
      console.log(`[plugin-manager] Updated plugin registry with ${pluginRegistry.plugins.length} plugins`);
    } catch (error) {
      console.error("[plugin-manager] Error building plugin registry:", error);
    }
  }

  /**
   * Build complete plugin registry with usage information
   */
  private async buildPluginRegistry(): Promise<{ plugins: PluginMetadata[] }> {
    const plugins = this.api.plugins?.list?.() || [];
    const agentRegistry = (await this.api.memory.retrieve("agent-registry")) || [];

    // Map which agents use which plugins
    const pluginUsage = new Map<string, Set<string>>();

    for (const agent of agentRegistry) {
      for (const plugin of agent.requiredPlugins || []) {
        if (!pluginUsage.has(plugin)) {
          pluginUsage.set(plugin, new Set());
        }
        pluginUsage.get(plugin)!.add(agent.name);
      }
    }

    // Build metadata for each plugin
    const pluginMetadata: PluginMetadata[] = [];

    for (const pluginName of plugins) {
      const metadata: PluginMetadata = {
        name: pluginName,
        methods: this.getPluginMethods(pluginName),
        usedByAgents: Array.from(pluginUsage.get(pluginName) || []),
        status: "loaded",
      };
      pluginMetadata.push(metadata);
    }

    return {
      plugins: pluginMetadata,
    };
  }

  /**
   * Get available methods for a plugin
   * This is a static mapping based on known plugins
   */
  private getPluginMethods(pluginName: string): string[] {
    const knownMethods: Record<string, string[]> = {
      ai: ["complete", "chat", "stream", "streamChat", "callTools"],
      memory: ["store", "retrieve", "search", "addContext", "getRecent", "getByMetadata"],
      files: ["read", "write", "list", "watch"],
      db: ["query", "execute", "transaction"],
      events: ["emit", "on", "off"],
      http: ["get", "post", "put", "delete", "patch"],
      plugins: ["call", "has", "list"],
      git: ["commit", "push", "pull", "clone", "createBranch", "switchBranch", "status", "diff"],
      shell: ["run", "exec"],
      scrape: ["fetch", "scrapeHTML", "parseJSON"],
      torrent: ["search", "download", "getStatus"],
      telegram: ["sendMessage", "sendPhoto", "editMessage", "deleteMessage"],
      discord: ["sendMessage", "createChannel", "editChannel", "deleteChannel", "setRole"],
      langchain: ["load", "chat", "embed"],
      rag: ["init", "addDocuments", "query", "delete"],
      email: ["send", "receive", "search"],
    };

    return knownMethods[pluginName] || [];
  }
}
