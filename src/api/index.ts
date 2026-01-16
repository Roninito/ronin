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

  // Create direct plugin APIs if plugins are loaded
  const gitPlugin = plugins.find(p => p.name === "git");
  const gitAPI: AgentAPI["git"] = gitPlugin ? {
    init: gitPlugin.plugin.methods.init as NonNullable<AgentAPI["git"]>["init"],
    clone: gitPlugin.plugin.methods.clone as NonNullable<AgentAPI["git"]>["clone"],
    status: gitPlugin.plugin.methods.status as NonNullable<AgentAPI["git"]>["status"],
    add: gitPlugin.plugin.methods.add as NonNullable<AgentAPI["git"]>["add"],
    commit: gitPlugin.plugin.methods.commit as NonNullable<AgentAPI["git"]>["commit"],
    push: gitPlugin.plugin.methods.push as NonNullable<AgentAPI["git"]>["push"],
    pull: gitPlugin.plugin.methods.pull as NonNullable<AgentAPI["git"]>["pull"],
    branch: gitPlugin.plugin.methods.branch as NonNullable<AgentAPI["git"]>["branch"],
    checkout: gitPlugin.plugin.methods.checkout as NonNullable<AgentAPI["git"]>["checkout"],
  } : undefined;

  const shellPlugin = plugins.find(p => p.name === "shell");
  const shellAPI: AgentAPI["shell"] = shellPlugin ? {
    exec: shellPlugin.plugin.methods.exec as NonNullable<AgentAPI["shell"]>["exec"],
    execAsync: shellPlugin.plugin.methods.execAsync as NonNullable<AgentAPI["shell"]>["execAsync"],
    which: shellPlugin.plugin.methods.which as NonNullable<AgentAPI["shell"]>["which"],
    env: shellPlugin.plugin.methods.env as NonNullable<AgentAPI["shell"]>["env"],
    cwd: shellPlugin.plugin.methods.cwd as NonNullable<AgentAPI["shell"]>["cwd"],
  } : undefined;

  const scrapePlugin = plugins.find(p => p.name === "scrape");
  const scrapeAPI: AgentAPI["scrape"] = scrapePlugin ? {
    scrape_to_markdown: scrapePlugin.plugin.methods.scrape_to_markdown as NonNullable<AgentAPI["scrape"]>["scrape_to_markdown"],
  } : undefined;

  const torrentPlugin = plugins.find(p => p.name === "torrent");
  const torrentAPI: AgentAPI["torrent"] = torrentPlugin ? {
    search: torrentPlugin.plugin.methods.search as NonNullable<AgentAPI["torrent"]>["search"],
    add: torrentPlugin.plugin.methods.add as NonNullable<AgentAPI["torrent"]>["add"],
    list: torrentPlugin.plugin.methods.list as NonNullable<AgentAPI["torrent"]>["list"],
    status: torrentPlugin.plugin.methods.status as NonNullable<AgentAPI["torrent"]>["status"],
    pause: torrentPlugin.plugin.methods.pause as NonNullable<AgentAPI["torrent"]>["pause"],
    resume: torrentPlugin.plugin.methods.resume as NonNullable<AgentAPI["torrent"]>["resume"],
    remove: torrentPlugin.plugin.methods.remove as NonNullable<AgentAPI["torrent"]>["remove"],
  } : undefined;

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
    ...(gitAPI && { git: gitAPI }),
    ...(shellAPI && { shell: shellAPI }),
    ...(scrapeAPI && { scrape: scrapeAPI }),
    ...(torrentAPI && { torrent: torrentAPI }),
  };

  return api;
}

