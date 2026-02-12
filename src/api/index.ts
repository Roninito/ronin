import { AIAPI } from "./ai.js";
import { FilesAPI } from "./files.js";
import { DatabaseAPI } from "./database.js";
import { HTTPAPI } from "./http.js";
import { EventsAPI } from "./events.js";
import { PluginsAPI } from "./plugins.js";
import { MemoryStore } from "../memory/index.js";
import { PluginLoader } from "../plugins/PluginLoader.js";
import { pluginsToTools } from "../plugins/toolGenerator.js";
import { getConfigService } from "../config/ConfigService.js";
import { initializeTools, getToolsAPI } from "./tools.js";
import type { AgentAPI } from "../types/api.js";

export interface APIOptions {
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
  userPluginDir?: string;
}

/**
 * Build the API object that gets passed to agents
 */
export async function createAPI(options: APIOptions = {}): Promise<AgentAPI> {
  // Initialize configuration service first
  const configService = getConfigService();
  await configService.load();
  
  const memoryStore = new MemoryStore(options.dbPath);
  const db = new DatabaseAPI(options.dbPath);
  const pluginsAPI = new PluginsAPI();

  // Load plugins from both built-in and user directories
  const builtinPluginDir = options.pluginDir || "./plugins";
  const userPluginDir = options.userPluginDir || null;
  const pluginLoader = new PluginLoader(builtinPluginDir, userPluginDir);
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

  const telegramPlugin = plugins.find(p => p.name === "telegram");
  const telegramAPI: AgentAPI["telegram"] = telegramPlugin ? {
    initBot: telegramPlugin.plugin.methods.initBot as NonNullable<AgentAPI["telegram"]>["initBot"],
    sendMessage: telegramPlugin.plugin.methods.sendMessage as NonNullable<AgentAPI["telegram"]>["sendMessage"],
    sendPhoto: telegramPlugin.plugin.methods.sendPhoto as NonNullable<AgentAPI["telegram"]>["sendPhoto"],
    getUpdates: telegramPlugin.plugin.methods.getUpdates as NonNullable<AgentAPI["telegram"]>["getUpdates"],
    joinChannel: telegramPlugin.plugin.methods.joinChannel as NonNullable<AgentAPI["telegram"]>["joinChannel"],
    setWebhook: telegramPlugin.plugin.methods.setWebhook as NonNullable<AgentAPI["telegram"]>["setWebhook"],
    onMessage: telegramPlugin.plugin.methods.onMessage as NonNullable<AgentAPI["telegram"]>["onMessage"],
    getBotInfo: telegramPlugin.plugin.methods.getBotInfo as NonNullable<AgentAPI["telegram"]>["getBotInfo"],
  } : undefined;

  const discordPlugin = plugins.find(p => p.name === "discord");
  const discordAPI: AgentAPI["discord"] = discordPlugin ? {
    initBot: discordPlugin.plugin.methods.initBot as NonNullable<AgentAPI["discord"]>["initBot"],
    sendMessage: discordPlugin.plugin.methods.sendMessage as NonNullable<AgentAPI["discord"]>["sendMessage"],
    getMessages: discordPlugin.plugin.methods.getMessages as NonNullable<AgentAPI["discord"]>["getMessages"],
    onMessage: discordPlugin.plugin.methods.onMessage as NonNullable<AgentAPI["discord"]>["onMessage"],
    onReady: discordPlugin.plugin.methods.onReady as NonNullable<AgentAPI["discord"]>["onReady"],
    joinGuild: discordPlugin.plugin.methods.joinGuild as NonNullable<AgentAPI["discord"]>["joinGuild"],
    getChannel: discordPlugin.plugin.methods.getChannel as NonNullable<AgentAPI["discord"]>["getChannel"],
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

  const eventsAPI = new EventsAPI();

  // Set events API for realm plugin if loaded
  const realmPlugin = plugins.find(p => p.name === "realm");
  if (realmPlugin && realmPlugin.plugin.methods.setEventsAPI) {
    (realmPlugin.plugin.methods.setEventsAPI as any)(eventsAPI);
  }

  const realmAPI: AgentAPI["realm"] = realmPlugin ? {
    init: realmPlugin.plugin.methods.init as NonNullable<AgentAPI["realm"]>["init"],
    disconnect: realmPlugin.plugin.methods.disconnect as NonNullable<AgentAPI["realm"]>["disconnect"],
    sendMessage: realmPlugin.plugin.methods.sendMessage as NonNullable<AgentAPI["realm"]>["sendMessage"],
    beam: realmPlugin.plugin.methods.beam as NonNullable<AgentAPI["realm"]>["beam"],
    query: realmPlugin.plugin.methods.query as NonNullable<AgentAPI["realm"]>["query"],
    getPeerStatus: realmPlugin.plugin.methods.getPeerStatus as NonNullable<AgentAPI["realm"]>["getPeerStatus"],
    sendMedia: realmPlugin.plugin.methods.sendMedia as NonNullable<AgentAPI["realm"]>["sendMedia"],
  } : undefined;

  const langchainPlugin = plugins.find(p => p.name === "langchain");
  const langchainAPI: AgentAPI["langchain"] = langchainPlugin ? {
    runChain: langchainPlugin.plugin.methods.runChain as NonNullable<AgentAPI["langchain"]>["runChain"],
    runAgent: langchainPlugin.plugin.methods.runAgent as NonNullable<AgentAPI["langchain"]>["runAgent"],
    buildAgentCreationGraph: langchainPlugin.plugin.methods.buildAgentCreationGraph as NonNullable<AgentAPI["langchain"]>["buildAgentCreationGraph"],
    runAnalysisChain: langchainPlugin.plugin.methods.runAnalysisChain as NonNullable<AgentAPI["langchain"]>["runAnalysisChain"],
    buildResearchGraph: langchainPlugin.plugin.methods.buildResearchGraph as NonNullable<AgentAPI["langchain"]>["buildResearchGraph"],
  } : undefined;

  const ragPlugin = plugins.find(p => p.name === "rag");
  const ragAPI: AgentAPI["rag"] = ragPlugin ? {
    init: ragPlugin.plugin.methods.init as NonNullable<AgentAPI["rag"]>["init"],
    addDocuments: ragPlugin.plugin.methods.addDocuments as NonNullable<AgentAPI["rag"]>["addDocuments"],
    search: ragPlugin.plugin.methods.search as NonNullable<AgentAPI["rag"]>["search"],
    query: ragPlugin.plugin.methods.query as NonNullable<AgentAPI["rag"]>["query"],
    removeDocuments: ragPlugin.plugin.methods.removeDocuments as NonNullable<AgentAPI["rag"]>["removeDocuments"],
    listDocuments: ragPlugin.plugin.methods.listDocuments as NonNullable<AgentAPI["rag"]>["listDocuments"],
    getStats: ragPlugin.plugin.methods.getStats as NonNullable<AgentAPI["rag"]>["getStats"],
    clearNamespace: ragPlugin.plugin.methods.clearNamespace as NonNullable<AgentAPI["rag"]>["clearNamespace"],
  } : undefined;

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
    events: eventsAPI,
    plugins: pluginsAPI,
    config: {
      get: <T>(path: string) => configService.get<T>(path as any),
      getAll: () => configService.getAll(),
      getTelegram: () => configService.getTelegram(),
      getDiscord: () => configService.getDiscord(),
      getAI: () => configService.getAI(),
      getGemini: () => configService.getGemini(),
      getGrok: () => configService.getGrok(),
      getSystem: () => configService.getSystem(),
      getCLIOptions: () => configService.getCLIOptions(),
      getEventMonitor: () => configService.getEventMonitor(),
      getBlogBoy: () => configService.getBlogBoy(),
      getConfigEditor: () => configService.getConfigEditor(),
      getRssToTelegram: () => configService.getRssToTelegram(),
      getRealm: () => configService.getRealm(),
      isFromEnv: (path: string) => configService.isFromEnv(path as any),
      reload: () => configService.reload(),
    },
    ...(gitAPI && { git: gitAPI }),
    ...(shellAPI && { shell: shellAPI }),
    ...(scrapeAPI && { scrape: scrapeAPI }),
    ...(torrentAPI && { torrent: torrentAPI }),
    ...(telegramAPI && { telegram: telegramAPI }),
    ...(discordAPI && { discord: discordAPI }),
    ...(realmAPI && { realm: realmAPI }),
    ...(langchainAPI && { langchain: langchainAPI }),
    ...(ragAPI && { rag: ragAPI }),
    tools: {} as AgentAPI["tools"], // Placeholder, will be set after init
  };

  // Initialize tool system with full API
  initializeTools(api);
  
  // Add tools API to the api object
  const toolsAPI = getToolsAPI(api);
  (api as any).tools = toolsAPI;

  return api;
}

