import { logger } from "../utils/logger.js";
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
import type { AgentAPI, Message, CompletionOptions, ChatOptions, Tool } from "../types/api.js";
import type { ToolDefinition } from "../tools/types.js";

export interface APIOptions {
  ollamaUrl?: string;
  ollamaModel?: string;
  /** When true, use the configured "fast" model (e.g. ministral-3:3b) as default for speed. Used by the agent server. */
  useFastModelForAgents?: boolean;
  dbPath?: string;
  pluginDir?: string;
  userPluginDir?: string;
  /** When true, skip plugin and MCP loading. Use for read-only CLI commands that only need DB access. */
  skipPlugins?: boolean;
}

/** Internal methods that should not be exposed as tools */
const PLUGIN_TOOL_SKIP_METHODS = new Set(["setAPI", "setEventsAPI"]);

function isPluginMethodSkipped(methodName: string): boolean {
  if (PLUGIN_TOOL_SKIP_METHODS.has(methodName)) return true;
  if (methodName.startsWith("set") || methodName.startsWith("init") || methodName.startsWith("remove")) return true;
  return false;
}

/**
 * Register plugin-generated tools (e.g. skills_discover_skills) with the ToolRouter
 * so that api.tools.execute() can dispatch to the correct plugin method.
 */
function registerPluginToolsWithRouter(
  api: AgentAPI,
  pluginTools: Tool[],
  toolsAPI: { register(tool: ToolDefinition): void },
): void {
  for (const t of pluginTools) {
    const name = t.function?.name;
    if (!name || !t.function) continue;
    // Skills plugin has explicit skills.discover / skills.use in LocalTools; skip generic skills_* tools
    if (name.startsWith("skills_")) continue;
    const underscore = name.indexOf("_");
    if (underscore <= 0) continue;
    const pluginName = name.slice(0, underscore);
    const methodName = name.slice(underscore + 1);
    if (isPluginMethodSkipped(methodName)) continue;

    const def: ToolDefinition = {
      name,
      description: t.function.description || `Call ${methodName} from ${pluginName} plugin`,
      parameters: (t.function.parameters || { type: "object", properties: {} }) as ToolDefinition["parameters"],
      provider: `plugin:${pluginName}`,
      riskLevel: "low",
      cacheable: false,
      handler: async (args: Record<string, unknown>, _context): Promise<import("../tools/types.js").ToolResult> => {
        const start = Date.now();
        try {
          // Ontology plugin methods expect a single params object; pass it as-is (or unwrap args[0] if model sent { args: [params] }).
          const isSingleObjectMethod = name.startsWith("ontology_");
          let result: unknown;
          if (isSingleObjectMethod) {
            const params =
              Array.isArray(args?.args) && args.args.length === 1 && typeof args.args[0] === "object" && args.args[0] !== null
                ? args.args[0]
                : args;
            result = await api.plugins.call(pluginName, methodName, params);
          } else {
            const argsArr = Array.isArray(args?.args) ? (args.args as unknown[]) : (args && typeof args === "object" ? Object.values(args) : []);
            result = await api.plugins.call(pluginName, methodName, ...argsArr);
          }
          return {
            success: true,
            data: result,
            metadata: {
              toolName: name,
              provider: `plugin:${pluginName}`,
              duration: Date.now() - start,
              cached: false,
              timestamp: Date.now(),
              callId: `plugin-${Date.now()}`,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            data: null,
            error: message,
            metadata: {
              toolName: name,
              provider: `plugin:${pluginName}`,
              duration: Date.now() - start,
              cached: false,
              timestamp: Date.now(),
              callId: `plugin-${Date.now()}`,
            },
          };
        }
      },
    };
    toolsAPI.register(def);
  }
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
  const plugins = options.skipPlugins ? [] : await pluginLoader.loadAllPlugins();

  // Register all loaded plugins
  for (const plugin of plugins) {
    pluginsAPI.register(plugin.name, plugin.plugin.methods);
  }

  if (plugins.length > 0 && !process.env.RONIN_QUIET) {
    logger.info("Plugins loaded", { count: plugins.length, plugins: plugins.map(p => p.name) });
  }

  // ── Generic plugin-to-API binder ──────────────────────────────────────
  // Replaces ~120 lines of repetitive per-plugin wiring with a single helper.
  function bindPluginAPI<K extends keyof AgentAPI>(
    pluginName: string,
  ): AgentAPI[K] | undefined {
    const found = plugins.find(p => p.name === pluginName);
    if (!found) return undefined;
    return { ...found.plugin.methods } as AgentAPI[K];
  }

  const gitAPI = bindPluginAPI<"git">("git");
  const shellAPI = bindPluginAPI<"shell">("shell");
  const scrapeAPI = bindPluginAPI<"scrape">("scrape");
  const torrentAPI = bindPluginAPI<"torrent">("torrent");
  const telegramAPI = bindPluginAPI<"telegram">("telegram");
  const discordAPI = bindPluginAPI<"discord">("discord");
  const langchainAPI = bindPluginAPI<"langchain">("langchain");
  const ragAPI = bindPluginAPI<"rag">("rag");
  const ontologyAPI = bindPluginAPI<"ontology">("ontology");
  const skillsAPI = bindPluginAPI<"skills">("skills");
  const pythonAPI = bindPluginAPI<"python">("python");
  const reticulumAPI = bindPluginAPI<"reticulum">("reticulum");

  // console.log("[createAPI] All plugins loaded:", plugins.map(p => p.name));

  // Realm needs special handling for setEventsAPI
  const realmPlugin = plugins.find(p => p.name === "realm");
  const realmAPI = bindPluginAPI<"realm">("realm");

  // Generate tool definitions from plugins for function calling
  // Filter out skills_* tools — skills have a dedicated skills.run tool in LocalTools
  const pluginTools = pluginsToTools(plugins.map(p => p.plugin))
    .filter(t => !t.function?.name?.startsWith("skills_"));

  // Resolve AI config with proper priority: CLI flag > env var > config file > hardcoded default
  const aiConfig = configService.getAI();
  const geminiConfig = configService.getGemini();
  const grokConfig = configService.getGrok();
  const resolvedOllamaUrl = options.ollamaUrl ?? aiConfig.ollamaUrl;
  const resolvedOllamaModel =
    options.ollamaModel ??
    (options.useFastModelForAgents && aiConfig.models?.fast ? aiConfig.models.fast : aiConfig.ollamaModel);
  const resolvedTimeoutMs = aiConfig.ollamaTimeoutMs;
  const aiAPI = new AIAPI(resolvedOllamaUrl, resolvedOllamaModel, resolvedTimeoutMs, aiConfig, geminiConfig, grokConfig);

  const eventsAPI = new EventsAPI();

  // Wire events API into realm plugin if loaded
  if (realmPlugin && realmPlugin.plugin.methods.setEventsAPI) {
    (realmPlugin.plugin.methods.setEventsAPI as any)(eventsAPI);
  }

  // Wire events API into STT plugin for transcribe.text → stt.transcribed
  const sttPlugin = plugins.find(p => p.name === "stt");
  if (sttPlugin && sttPlugin.plugin.methods.setEventsAPI) {
    (sttPlugin.plugin.methods.setEventsAPI as any)(eventsAPI);
  }

  // Initialize mesh discovery if Reticulum is available
  let meshAPI: any = null;
  const meshConfig = configService.getMesh();
  if (reticulumAPI && meshConfig.enabled) {
    try {
      const { createMeshDiscovery } = await import("../mesh/index.js");
      const meshDiscovery = createMeshDiscovery({
        ai: wrappedAi as any,
        memory: {} as any,
        files: {} as any,
        db: {} as any,
        http: {} as any,
        events: eventsAPI,
        plugins: pluginsAPI,
        config: configService as any,
        tools: {} as any,
        git: gitAPI,
        shell: shellAPI,
        scrape: scrapeAPI,
        torrent: torrentAPI,
        telegram: telegramAPI,
        discord: discordAPI,
        realm: realmAPI,
        reticulum: reticulumAPI,
        langchain: langchainAPI,
        rag: ragAPI,
        ontology: ontologyAPI,
        skills: skillsAPI,
      } as any);
      
      meshAPI = {
        discoverServices: (query?: any, options?: any) => meshDiscovery.discoverServices(query, options),
        executeRemoteService: (instanceId: string, serviceName: string, params: any) =>
          meshDiscovery.executeRemoteService(instanceId, serviceName, params),
        advertise: (services: any[]) => meshDiscovery.advertise(services),
        getStats: () => meshDiscovery.getStats(),
        getCache: () => meshDiscovery.getCache(),
      };
      
      console.log("[mesh] Mesh discovery initialized");
    } catch (error) {
      console.warn("[mesh] Failed to initialize mesh discovery:", error);
    }
  }

  // Wrap api.ai to emit analytics events for every completion, stream, and callTools
  const AI_SOURCE = "api.ai";
  const defaultModel = resolvedOllamaModel;

  const wrappedAi: AgentAPI["ai"] = {
    checkModel: (model?: string) => aiAPI.checkModel(model),

    async complete(prompt: string, options?: CompletionOptions): Promise<string> {
      const start = Date.now();
      const model = options?.model ?? defaultModel;
      try {
        const result = await aiAPI.complete(prompt, options);
        eventsAPI.emit(
          "ai.completion",
          { type: "complete", model, duration: Date.now() - start, success: true, timestamp: Date.now() },
          AI_SOURCE,
        );
        return result;
      } catch (err) {
        eventsAPI.emit(
          "ai.completion",
          {
            type: "complete",
            model,
            duration: Date.now() - start,
            success: false,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          },
          AI_SOURCE,
        );
        throw err;
      }
    },

    async chat(messages: Message[], options?: Omit<ChatOptions, "messages">): Promise<Message> {
      const start = Date.now();
      const model = options?.model ?? defaultModel;
      try {
        const result = await aiAPI.chat(messages, options);
        eventsAPI.emit(
          "ai.completion",
          { type: "chat", model, duration: Date.now() - start, success: true, timestamp: Date.now() },
          AI_SOURCE,
        );
        return result;
      } catch (err) {
        eventsAPI.emit(
          "ai.completion",
          {
            type: "chat",
            model,
            duration: Date.now() - start,
            success: false,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          },
          AI_SOURCE,
        );
        throw err;
      }
    },

    async *stream(prompt: string, options?: CompletionOptions): AsyncIterable<string> {
      const start = Date.now();
      const model = options?.model ?? defaultModel;
      let emitted = false;
      try {
        yield* aiAPI.stream(prompt, options);
      } catch (err) {
        emitted = true;
        eventsAPI.emit(
          "ai.stream",
          {
            type: "stream",
            model,
            duration: Date.now() - start,
            success: false,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          },
          AI_SOURCE,
        );
        throw err;
      } finally {
        if (!emitted) {
          eventsAPI.emit(
            "ai.stream",
            { type: "stream", model, duration: Date.now() - start, success: true, timestamp: Date.now() },
            AI_SOURCE,
          );
        }
      }
    },

    async *streamChat(
      messages: Message[],
      options?: Omit<ChatOptions, "messages">,
    ): AsyncIterable<string> {
      const start = Date.now();
      const model = options?.model ?? defaultModel;
      let emitted = false;
      try {
        yield* aiAPI.streamChat(messages, options);
      } catch (err) {
        emitted = true;
        eventsAPI.emit(
          "ai.stream",
          {
            type: "streamChat",
            model,
            duration: Date.now() - start,
            success: false,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          },
          AI_SOURCE,
        );
        throw err;
      } finally {
        if (!emitted) {
          eventsAPI.emit(
            "ai.stream",
            { type: "streamChat", model, duration: Date.now() - start, success: true, timestamp: Date.now() },
            AI_SOURCE,
          );
        }
      }
    },

    async callTools(
      prompt: string,
      tools: Tool[],
      options?: CompletionOptions,
    ): Promise<{ message: Message; toolCalls: import("../types/api.js").ToolCall[] }> {
      const start = Date.now();
      const model = options?.model ?? defaultModel;
      const allTools = [...pluginTools, ...tools];
      try {
        const result = await aiAPI.callTools(prompt, allTools, options);
        eventsAPI.emit(
          "ai.toolCall",
          {
            model,
            duration: Date.now() - start,
            success: true,
            toolCount: result.toolCalls.length,
            timestamp: Date.now(),
          },
          AI_SOURCE,
        );
        return result;
      } catch (err) {
        eventsAPI.emit(
          "ai.toolCall",
          {
            model,
            duration: Date.now() - start,
            success: false,
            toolCount: 0,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          },
          AI_SOURCE,
        );
        throw err;
      }
    },
  };

  const api: AgentAPI = {
    ai: wrappedAi,
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
      getBraveSearch: () => configService.getBraveSearch(),
      getSystem: () => configService.getSystem(),
      getCLIOptions: () => configService.getCLIOptions(),
      getEventMonitor: () => configService.getEventMonitor(),
      getBlogBoy: () => configService.getBlogBoy(),
      getConfigEditor: () => configService.getConfigEditor(),
      getRssToTelegram: () => configService.getRssToTelegram(),
      getRealm: () => configService.getRealm(),
      getMCP: () => configService.getMCP(),
      getNotifications: () => configService.getNotifications(),
      isFromEnv: (path: string) => configService.isFromEnv(path as any),
      reload: () => configService.reload(),
      set: (path: string, value: unknown) => configService.set(path as any, value),
    },
    ...(gitAPI && { git: gitAPI }),
    ...(shellAPI && { shell: shellAPI }),
    ...(scrapeAPI && { scrape: scrapeAPI }),
    ...(torrentAPI && { torrent: torrentAPI }),
    ...(telegramAPI && { telegram: telegramAPI }),
    ...(discordAPI && { discord: discordAPI }),
    ...(realmAPI && { realm: realmAPI }),
    ...(pythonAPI && { python: pythonAPI }),
    ...(reticulumAPI && { reticulum: reticulumAPI }),
    ...(meshAPI && { mesh: meshAPI }),
    ...(langchainAPI && { langchain: langchainAPI }),
    ...(ragAPI && { rag: ragAPI }),
    ...(ontologyAPI && { ontology: ontologyAPI }),
    ...(skillsAPI && { skills: skillsAPI }),
    tools: {} as AgentAPI["tools"],
  };

  // Initialize tool system with full API (skip for read-only CLI commands)
  if (!options.skipPlugins) {
    await initializeTools(api);
  }

  // Add tools API to the api object
  const toolsAPI = options.skipPlugins ? null : getToolsAPI(api);
  if (toolsAPI) (api as any).tools = toolsAPI;

  // Register plugin tools with the router so execute() can dispatch to plugins
  // (pluginTools are already passed to the AI in callTools; without this, execute would fail)
  registerPluginToolsWithRouter(api, pluginTools, toolsAPI);

  // Skills plugin needs API reference for files, shell, config, events
  const skillsPlugin = plugins.find(p => p.name === "skills");
  if (skillsPlugin?.plugin?.methods?.setAPI) {
    (skillsPlugin.plugin.methods.setAPI as (api: AgentAPI) => void)(api);
  }

  return api;
}

