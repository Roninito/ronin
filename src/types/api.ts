/**
 * AI completion options
 */
export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  /**
   * Network timeout for AI requests (ms). If omitted, Ronin uses a generous default.
   */
  timeoutMs?: number;
  /**
   * Enable/disable thinking mode (for models like Qwen3 that support it)
   * Set to false to disable thinking and get direct responses
   */
  thinking?: boolean;
  /**
   * Number of retry attempts on transient failures (network errors, 503s, timeouts).
   * Set to 0 to disable retries. Defaults to 3.
   */
  retries?: number;
  /**
   * When true, use the default (local) AI provider only, not the smart/cloud tier.
   * Useful for synthesis rounds where the smart model may not be available on the remote endpoint.
   */
  useLocalProvider?: boolean;
}

/**
 * Chat message
 */
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Chat options
 */
export interface ChatOptions extends CompletionOptions {
  messages: Message[];
}

/**
 * Tool/Function definition for Ollama function calling
 */
export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, {
        type: string;
        description?: string;
      }>;
      required?: string[];
    };
  };
}

/**
 * Tool call result from Ollama
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool calling options
 */
export interface ToolCallOptions extends CompletionOptions {
  tools: Tool[];
}

/**
 * Memory entry
 */
export interface Memory {
  id: string;
  key?: string;
  value: unknown;
  text?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * HTTP request options
 */
export interface RequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * Database transaction interface
 */
export interface Transaction {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

/**
 * Main API interface provided to agents
 */
export interface AgentAPI {
  /**
   * AI operations via Ollama
   */
  ai: {
    complete(prompt: string, options?: CompletionOptions): Promise<string>;
    stream(prompt: string, options?: CompletionOptions): AsyncIterable<string>;
    chat(messages: Message[], options?: Omit<ChatOptions, "messages">): Promise<Message>;
    streamChat(
      messages: Message[],
      options?: Omit<ChatOptions, "messages">
    ): AsyncIterable<string>;
    callTools(
      prompt: string,
      tools: Tool[],
      options?: CompletionOptions
    ): Promise<{ message: Message; toolCalls: ToolCall[] }>;
  };

  /**
   * Memory/Context operations
   */
  memory: {
    store(key: string, value: unknown): Promise<void>;
    retrieve(key: string): Promise<unknown>;
    search(query: string, limit?: number): Promise<Memory[]>;
    addContext(text: string, metadata?: Record<string, unknown>): Promise<string>;
    getRecent(limit?: number): Promise<Memory[]>;
    getByMetadata(metadata: Record<string, unknown>): Promise<Memory[]>;
  };

  /**
   * File operations
   */
  files: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    ensureDir(path: string): Promise<void>;
    watch(pattern: string, callback: (path: string, event: string) => void): void;
    list(dir: string, pattern?: string): Promise<string[]>;
  };

  /**
   * Database operations
   */
  db: {
    query<T>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<void>;
    transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  };

  /**
   * HTTP operations
   */
  http: {
    get(url: string, options?: RequestOptions): Promise<Response>;
    post(url: string, data: unknown, options?: RequestOptions): Promise<Response>;
    serve(handler: (req: Request) => Response | Promise<Response>): void;
    registerRoute(path: string, handler: (req: Request) => Response | Promise<Response>, metadata?: {title?: string, description?: string, icon?: string}): void;
    registerRoutes(routes: Record<string, (req: Request) => Response | Promise<Response>>): void;
    getAllRoutes(): Map<string, (req: Request) => Response | Promise<Response>>;
    getRouteMetadata(path: string): {title?: string, description?: string, icon?: string} | undefined;
    getAllRoutesWithMetadata(): Array<{path: string, metadata?: {title?: string, description?: string, icon?: string}}>;
  };

  /**
   * Event system for inter-agent communication
   */
  events: {
    emit(event: string, data: unknown, source: string): void;
    on(event: string, handler: (data: unknown) => void): void;
    off(event: string, handler: (data: unknown) => void): void;
    beam(targets: string | string[], eventType: string, payload: unknown): void;
    query(targets: string | string[], queryType: string, payload: unknown, timeout?: number): Promise<unknown>;
    reply(requestId: string, data: unknown, error?: string | null): void;
    getRegisteredEvents(): Array<{event: string, handlerCount: number}>;
  };

  /**
   * When running under the Ronin server, returns the current list of agents from the registry (post hot-reload).
   * Omitted when API is used standalone (e.g. CLI). Use for up-to-date schedule data.
   */
  getAgents?: () => Array<{ name: string; filePath: string; schedule?: string; watch?: string[]; webhook?: string }>;

  /**
   * Plugin system
   */
  plugins: {
    call(pluginName: string, method: string, ...args: unknown[]): Promise<unknown>;
    has(pluginName: string): boolean;
    list(): string[];
  };

  /**
   * Git operations (if git plugin is loaded)
   */
  git?: {
    init(): Promise<{ success: boolean; message: string }>;
    clone(url: string, dir?: string): Promise<{ success: boolean; output: string }>;
    status(): Promise<{ clean: boolean; files: Array<{ status: string; file: string }> }>;
    add(files: string | string[]): Promise<{ success: boolean }>;
    commit(message: string, files?: string[]): Promise<{ success: boolean; output: string }>;
    push(remote?: string, branch?: string): Promise<{ success: boolean; output: string }>;
    pull(remote?: string, branch?: string): Promise<{ success: boolean; output: string }>;
    branch(name?: string): Promise<{ success?: boolean; output?: string; branches?: string[] }>;
    checkout(branch: string): Promise<{ success: boolean; output: string }>;
  };

  /**
   * Shell operations (if shell plugin is loaded)
   */
  shell?: {
    exec(
      command: string,
      args?: string[],
      options?: { cwd?: string; env?: Record<string, string> }
    ): Promise<{ exitCode: number; stdout: string; stderr: string; success: boolean }>;
    execAsync(
      command: string,
      args?: string[],
      options?: { cwd?: string; env?: Record<string, string> }
    ): Promise<{
      process: import("bun").Subprocess;
      readOutput(): Promise<{ exitCode: number; stdout: string; stderr: string; success: boolean }>;
    }>;
    which(command: string): Promise<string | null>;
    env(): Promise<Record<string, string>>;
    cwd(): Promise<string>;
  };

  /**
   * Web scraping operations (if scrape plugin is loaded)
   */
  scrape?: {
    scrape_to_markdown(
      url: string,
      options?: {
        instructions?: string;
        selector?: string;
        includeImages?: boolean;
        timeoutMs?: number;
        userAgent?: string;
      }
    ): Promise<{ url: string; finalUrl: string; title?: string; markdown: string; images: string[]; links: string[] }>;
  };

  /**
   * Torrent operations (if torrent plugin is loaded)
   */
  torrent?: {
    search(query: string, options?: { site?: string; limit?: number }): Promise<Array<{
      title: string;
      magnet: string;
      size: string;
      seeders: number;
      leechers: number;
      uploadDate: string;
      category: string;
      url: string;
    }>>;
    add(magnetOrPath: string, options?: { downloadPath?: string }): Promise<{
      infoHash: string;
      name: string;
      status: {
        infoHash: string;
        name: string;
        progress: number;
        downloadSpeed: number;
        uploadSpeed: number;
        downloaded: number;
        uploaded: number;
        timeRemaining: number;
        peers: number;
        length: number;
        ready: boolean;
        done: boolean;
      };
    }>;
    list(): Promise<Array<{
      infoHash: string;
      name: string;
      progress: number;
      downloadSpeed: number;
      uploadSpeed: number;
      downloaded: number;
      uploaded: number;
      timeRemaining: number;
      peers: number;
      length: number;
      ready: boolean;
      done: boolean;
    }>>;
    status(infoHash: string): Promise<{
      infoHash: string;
      name: string;
      progress: number;
      downloadSpeed: number;
      uploadSpeed: number;
      downloaded: number;
      uploaded: number;
      timeRemaining: number;
      peers: number;
      length: number;
      ready: boolean;
      done: boolean;
    }>;
    pause(infoHash: string): Promise<{ success: boolean; message: string }>;
    resume(infoHash: string): Promise<{ success: boolean; message: string }>;
    remove(infoHash: string, options?: { removeFiles?: boolean }): Promise<{ success: boolean; message: string }>;
  };

  /**
   * Telegram operations (if telegram plugin is loaded)
   */
  telegram?: {
    initBot(token: string, options?: { webhookUrl?: string }): Promise<string>;
    sendMessage(botId: string, chatId: string | number, text: string, options?: { parseMode?: "HTML" | "Markdown" | "MarkdownV2" }): Promise<void>;
    sendPhoto(botId: string, chatId: string | number, photo: string | Buffer, caption?: string): Promise<void>;
    getUpdates(botId: string, options?: { limit?: number; offset?: number }): Promise<Array<{
      update_id: number;
      message?: {
        message_id: number;
        from?: { id: number; username?: string; first_name?: string; last_name?: string };
        chat: { id: number; type: string; title?: string; username?: string };
        reply_to_message?: { message_id: number; text?: string };
        text?: string;
        caption?: string;
        photo?: Array<{ file_id: string }>;
        date: number;
      };
    }>>;
    joinChannel(botId: string, channelId: string): Promise<void>;
    setWebhook(botId: string, url: string): Promise<void>;
    onMessage(botId: string, callback: (update: {
      update_id: number;
      message?: {
        message_id: number;
        from?: { id: number; username?: string; first_name?: string; last_name?: string };
        chat: { id: number; type: string; title?: string; username?: string };
        reply_to_message?: { message_id: number; text?: string };
        text?: string;
        caption?: string;
        photo?: Array<{ file_id: string }>;
        date: number;
      };
    }) => void): void;
    clearMessageHandlers(botId: string): void;
    getBotInfo(botId: string): Promise<{
      id: number;
      username: string;
      first_name: string;
      can_join_groups: boolean;
      can_read_all_group_messages: boolean;
    }>;
  };

  /**
   * Discord operations (if discord plugin is loaded)
   */
  discord?: {
    initBot(token: string, options?: { intents?: number[] }): Promise<string>;
    sendMessage(clientId: string, channelId: string, content: string, options?: {
      embed?: {
        title?: string;
        description?: string;
        color?: number;
        fields?: Array<{ name: string; value: string; inline?: boolean }>;
        footer?: string;
      };
    }): Promise<void>;
    getMessages(clientId: string, channelId: string, options?: { limit?: number; before?: string }): Promise<Array<{
      id: string;
      content: string;
      author: { id: string; username: string; bot: boolean };
      channelId: string;
      guildId: string | null;
      timestamp: number;
    }>>;
    onMessage(clientId: string, callback: (message: {
      id: string;
      content: string;
      author: { id: string; username: string; bot: boolean };
      channelId: string;
      guildId: string | null;
      timestamp: number;
    }) => void): void;
    onReady(clientId: string, callback: () => void): void;
    joinGuild(clientId: string, inviteCode: string): Promise<{
      code: string;
      guild?: { id: string; name: string };
      channel?: { id: string; name: string };
    }>;
    getChannel(clientId: string, channelId: string): Promise<{
      id: string;
      name: string;
      type: string;
      guildId: string | null;
    }>;
    listGuilds(clientId: string): Promise<Array<{ id: string; name: string }>>;
    listChannels(clientId: string, guildId: string): Promise<Array<{ id: string; name: string; type: string }>>;
    listDMChannels(clientId: string): Promise<Array<{
      id: string;
      recipient?: { id: string; username: string };
    }>>;
  };

  /**
   * Realm operations (if realm plugin is loaded)
   */
  realm?: {
    init(discoveryUrl: string, callSign: string, options?: {
      token?: string;
      localWsPort?: number;
      heartbeatInterval?: number;
      stunServers?: RTCIceServer[];
      turnServers?: RTCIceServer[];
    }): Promise<void>;
    disconnect(): void;
    sendMessage(to: string, content: string): Promise<void>;
    beam(target: string | string[], eventType: string, payload: unknown): Promise<void>;
    query(target: string, queryType: string, payload: unknown, timeout?: number): Promise<unknown>;
    getPeerStatus(callSign: string): Promise<{ online: boolean; wsAddress?: string }>;
    sendMedia(to: string, stream: MediaStream): Promise<void>;
  };

  /**
   * Mesh Network operations (if mesh networking is enabled)
   * Enables discovery and execution of services across Ronin instances
   */
  mesh?: {
    discoverServices(
      query?: string,
      options?: {
        serviceType?: "skill" | "agent" | "tool";
        maxDistance?: number;
        minReliability?: number;
      }
    ): Array<{
      instance: any;
      service: any;
      distance: number;
      reliability: number;
    }>;
    executeRemoteService(
      instanceId: string,
      serviceName: string,
      params: Record<string, any>
    ): Promise<any>;
    advertise(services: any[]): Promise<void>;
    getStats(): {
      instanceCount: number;
      serviceCount: number;
      cacheSize: number;
    };
    getCache(): any[];
  };

  /**
   * Skills operations (if skills plugin is loaded)
   * AgentSkills: discover, explore, use skill.md + scripts
   */
  skills?: {
    discover_skills(query: string): Promise<import("./skills.js").SkillMeta[]>;
    explore_skill(skill_name: string, include_scripts?: boolean): Promise<import("./skills.js").SkillDetail>;
    use_skill(
      skill_name: string,
      options?: { ability?: string; params?: Record<string, unknown>; pipeline?: string[] }
    ): Promise<import("./skills.js").UseSkillResult>;
  };

  /**
   * LangChain operations (if langchain plugin is loaded)
   */
  langchain?: {
    runChain(prompt: string, input: any, api?: AgentAPI): Promise<string>;
    runAgent(query: string, tools?: any[], api?: AgentAPI): Promise<any>;
    buildAgentCreationGraph(cancellationToken?: { isCancelled: boolean }, api?: AgentAPI): Promise<any>;
    runAnalysisChain(input: string, dataSource?: string, api?: AgentAPI): Promise<string>;
    buildResearchGraph(api?: AgentAPI): Promise<any>;
  };

  /**
   * Ontology / knowledge graph operations (if ontology plugin is loaded)
   */
  ontology?: {
    setNode(node: {
      id: string;
      type: string;
      name?: string;
      summary?: string;
      metadata?: string;
      domain?: string;
      confidence?: number;
      sensitivity?: string;
    }): Promise<void>;
    setEdge(edge: {
      id: string;
      from_id: string;
      to_id: string;
      relation: string;
      metadata?: string;
      confidence?: number;
    }): Promise<void>;
    removeNode(id: string): Promise<void>;
    removeEdge(id: string): Promise<void>;
    lookup(id: string): Promise<{
      id: string;
      type: string;
      name: string | null;
      summary: string | null;
      metadata: string | null;
      domain: string;
      confidence: number;
      sensitivity: string;
      created_at: number;
      updated_at: number;
    } | null>;
    search(params: { type?: string; nameLike?: string; domain?: string; limit?: number }): Promise<Array<{
      id: string;
      type: string;
      name: string | null;
      summary: string | null;
      metadata: string | null;
      domain: string;
      confidence: number;
      sensitivity: string;
      created_at: number;
      updated_at: number;
    }>>;
    related(params: {
      nodeId: string;
      relation?: string;
      direction?: "out" | "in" | "both";
      depth?: number;
      limit?: number;
    }): Promise<Array<{ node: Record<string, unknown>; edges: Array<Record<string, unknown>> }>>;
    context(params: { taskId: string; depth?: number; limit?: number }): Promise<{
      task: Record<string, unknown> | null;
      skills: Array<Record<string, unknown>>;
      failures: Array<Record<string, unknown>>;
      pipelines: Array<Record<string, unknown>>;
      conversations: Array<Record<string, unknown>>;
    }>;
    history(params: {
      type?: string;
      nameLike?: string;
      successfulOnly?: boolean;
      limit?: number;
    }): Promise<Array<Record<string, unknown>>>;
    stats(): Promise<{ nodes: Record<string, number>; edges: Record<string, number> }>;
  };

  /**
   * Email operations (if email plugin is loaded)
   */
  email?: {
    addAccount(config: {
      name: string;
      email: string;
      imap: {
        host: string;
        port: number;
        secure: boolean;
        auth: { user: string; pass: string };
      };
      smtp: {
        host: string;
        port: number;
        secure: boolean;
        auth: { user: string; pass: string };
      };
    }): Promise<{ id: string; email: string; name: string }>;

    removeAccount(accountId: string): Promise<{ success: boolean }>;

    listAccounts(): Promise<Array<{
      id: string;
      name: string;
      email: string;
      isMonitoring: boolean;
      createdAt: number;
    }>>;

    getInbox(accountId: string, options?: { limit?: number; offset?: number }): Promise<Array<{
      id: string;
      uid: number;
      from: Array<{ name?: string; address: string }>;
      to: Array<{ name?: string; address: string }>;
      cc?: Array<{ name?: string; address: string }>;
      subject: string;
      date: Date;
      snippet: string;
      body?: string;
      html?: string;
      flags: string[];
    }>>;

    getEmail(accountId: string, messageId: string): Promise<{
      id: string;
      uid: number;
      from: Array<{ name?: string; address: string }>;
      to: Array<{ name?: string; address: string }>;
      cc?: Array<{ name?: string; address: string }>;
      subject: string;
      date: Date;
      snippet: string;
      body?: string;
      html?: string;
      flags: string[];
    }>;

    sendEmail(
      accountId: string,
      to: string | string[],
      subject: string,
      body: string,
      options?: {
        cc?: string | string[];
        bcc?: string | string[];
        html?: boolean;
        replyTo?: string;
        attachments?: Array<{
          filename: string;
          content: string | Buffer;
          contentType?: string;
        }>;
      }
    ): Promise<{ messageId: string; success: boolean }>;

    replyToEmail(
      accountId: string,
      messageId: string,
      body: string,
      options?: {
        html?: boolean;
        replyAll?: boolean;
        quote?: boolean;
      }
    ): Promise<{ messageId: string; success: boolean }>;

    forwardEmail(
      accountId: string,
      messageId: string,
      to: string | string[],
      body?: string
    ): Promise<{ messageId: string; success: boolean }>;

    deleteEmail(
      accountId: string,
      messageId: string,
      options?: { permanent?: boolean }
    ): Promise<{ success: boolean }>;

    markRead(accountId: string, messageId: string): Promise<{ success: boolean }>;

    markUnread(accountId: string, messageId: string): Promise<{ success: boolean }>;

    searchEmails(
      accountId: string,
      query: string,
      options?: { limit?: number; folder?: string }
    ): Promise<Array<{
      id: string;
      uid: number;
      from: Array<{ name?: string; address: string }>;
      to: Array<{ name?: string; address: string }>;
      subject: string;
      date: Date;
      snippet: string;
      flags: string[];
    }>>;

    startMonitoring(accountId: string): Promise<{ success: boolean }>;

    stopMonitoring(accountId: string): Promise<{ success: boolean }>;

    onNewEmail(accountId: string, callback: (email: {
      id: string;
      uid: number;
      from: Array<{ name?: string; address: string }>;
      to: Array<{ name?: string; address: string }>;
      subject: string;
      date: Date;
      snippet: string;
      body?: string;
      flags: string[];
    }) => void): void;

    offNewEmail(accountId: string, callback: (email: unknown) => void): void;

    listFolders(accountId: string): Promise<Array<{
      name: string;
      path: string;
      specialUse?: string;
    }>>;
  };

  /**
   * Speech operations (if piper and/or stt plugins are loaded)
   * Provides text-to-speech and speech-to-text capabilities
   */
  speech?: {
    say(text: string): Promise<void>;
    listen(duration?: number, options?: { language?: string }): Promise<{ text: string; audioPath?: string }>;
  };

  /**
   * Notification operations for user interaction
   * Shows desktop notifications and interactive dialogs
   */
  notify?: {
    show(title: string, message: string, options?: { subtitle?: string; sound?: boolean }): Promise<void>;
    ask(title: string, message: string, buttons: string[], options?: {
      defaultButton?: string;
      icon?: 'note' | 'caution' | 'stop';
    }): Promise<{ answer: string | null; cancelled?: boolean }>;
  };

  /**
   * Configuration access
   * Provides centralized access to all configuration settings
   */
  config: {
    get<T>(path: string): T;
    getAll(): import("../config/types.js").FullConfig;
    getTelegram(): import("../config/types.js").TelegramConfig;
    getDiscord(): import("../config/types.js").DiscordConfig;
    getAI(): import("../config/types.js").AIConfig;
    getGemini(): import("../config/types.js").GeminiConfig;
    getGrok(): import("../config/types.js").GrokConfig;
    getBraveSearch(): import("../config/types.js").BraveSearchConfig;
    getSystem(): import("../config/types.js").SystemConfig;
    getCLIOptions(): import("../config/types.js").CLIOptions;
    getEventMonitor(): import("../config/types.js").EventMonitorConfig;
    getBlogBoy(): import("../config/types.js").BlogBoyConfig;
    getConfigEditor(): import("../config/types.js").ConfigEditorConfig;
    getRssToTelegram(): import("../config/types.js").RssToTelegramConfig;
    getRealm(): import("../config/types.js").RealmConfig;
    getMCP(): import("../config/types.js").MCPConfig;
    getNotifications(): import("../config/types.js").NotificationsConfig;
    isFromEnv(path: string): boolean;
    reload(): Promise<void>;
  };

  /**
   * Tool system for Hybrid Intelligence
   * Local and cloud tool orchestration with policy enforcement
   */
  tools: {
    register(tool: import("../tools/types.js").ToolDefinition): void;
    unregister(toolName: string): void;
    execute(name: string, args: Record<string, any>, context?: Partial<import("../tools/types.js").ToolContext>): Promise<import("../tools/types.js").ToolResult>;
    list(): import("../tools/types.js").ToolDefinition[];
    getSchemas(): import("../tools/types.js").OpenAIFunctionSchema[];
    has(name: string): boolean;
    registerWorkflow(workflow: import("../tools/types.js").WorkflowDefinition): void;
    executeWorkflow(name: string, args: Record<string, any>, context?: Partial<import("../tools/types.js").ToolContext>): Promise<any>;
    getWorkflow(name: string): import("../tools/types.js").WorkflowDefinition | undefined;
    listWorkflows(): import("../tools/types.js").WorkflowDefinition[];
    setPolicy(policy: import("../tools/types.js").ToolPolicy): void;
    getPolicy(): import("../tools/types.js").ToolPolicy;
    getCostStats(): { daily: number; monthly: number };
  };
}

