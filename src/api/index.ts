import { AIAPI } from "./ai.js";
import { FilesAPI } from "./files.js";
import { DatabaseAPI } from "./database.js";
import { HTTPAPI } from "./http.js";
import { EventsAPI } from "./events.js";
import { PluginsAPI } from "./plugins.js";
import { MemoryStore } from "../memory/index.js";
import { PluginLoader } from "../plugins/PluginLoader.js";
import { pluginsToTools } from "../plugins/toolGenerator.js";
import type { AgentAPI } from "../types/api.js";

export interface APIOptions {
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
}

/**
 * Build the API object that gets passed to agents
 */
export async function createAPI(options: APIOptions = {}): Promise<AgentAPI> {
  const memoryStore = new MemoryStore(options.dbPath);
  const db = new DatabaseAPI(options.dbPath);
  const pluginsAPI = new PluginsAPI();

  // Load plugins from plugins directory
  const pluginDir = options.pluginDir || "./plugins";
  const pluginLoader = new PluginLoader(pluginDir);
  const plugins = await pluginLoader.loadAllPlugins();

  // Register all loaded plugins
  for (const plugin of plugins) {
    pluginsAPI.register(plugin.name, plugin.plugin.methods);
  }

  if (plugins.length > 0) {
    console.log(`✅ Loaded ${plugins.length} plugin(s): ${plugins.map(p => p.name).join(", ")}`);
  }

  // Generate tool definitions from plugins for function calling
  const pluginTools = pluginsToTools(plugins.map(p => p.plugin));
  
  const aiAPI = new AIAPI(options.ollamaUrl, options.ollamaModel);
  
  // Wrap callTools to automatically include plugin tools
  const originalCallTools = aiAPI.callTools.bind(aiAPI);
  aiAPI.callTools = async (prompt, tools, options) => {
    // Merge provided tools with plugin tools
    const allTools = [...pluginTools, ...tools];
    return originalCallTools(prompt, allTools, options);
  };

  const api: AgentAPI = {
    ai: aiAPI,
    memory: {
      store: (key: string, value: unknown) => memoryStore.store(key, value),
      retrieve: (key: string) => memoryStore.retrieve(key),
      search: (query: string, limit?: number) => memoryStore.search(query, limit),
      addContext: (text: string, metadata?: Record<string, unknown>) =>
        memoryStore.addContext(text, metadata),
      getRecent: (limit?: number) => memoryStore.getRecent(limit),
      getByMetadata: (metadata: Record<string, unknown>) =>
        memoryStore.getByMetadata(metadata),
    },
    files: new FilesAPI(),
    db: {
      query: <T>(sql: string, params?: unknown[]) => db.query<T>(sql, params),
      execute: (sql: string, params?: unknown[]) => db.execute(sql, params),
      transaction: <T>(fn: (tx: import("../types/api.js").Transaction) => Promise<T>) =>
        db.transaction(fn),
    },
    http: new HTTPAPI(),
    events: new EventsAPI(),
    plugins: pluginsAPI,
  };

  return api;
}

