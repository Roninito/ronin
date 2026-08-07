/**
 * Messenger Agent - Enhanced SAR Chain Version with Conversation History
 *
 * Single responsibility: Receive user messages from Telegram, Discord, WhatsApp, etc.
 * Let AI choose appropriate tools/actions. No hardcoded command handlers.
 * Features: conversation history, dynamic Ronin context, SAR chain awareness.
 */

import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import type { ChainContext, ChainMessage } from "../src/chain/types.js";
import type { Middleware } from "../src/middleware/MiddlewareStack.js";
import { MiddlewareStack } from "../src/middleware/MiddlewareStack.js";
import {
  getRoninContext,
  buildSystemPrompt,
} from "../src/utils/prompt.js";
import { createOntologyResolveMiddleware } from "../src/middleware/ontologyResolve.js";
import { createOntologyInjectMiddleware } from "../src/middleware/ontologyInject.js";
import { createArtifactInjectMiddleware } from "../src/middleware/artifactInject.js";
import { createTokenGuardMiddleware } from "../src/middleware/tokenGuard.js";
import { createAiToolMiddleware } from "../src/middleware/aiToolMiddleware.js";
import { createExecutionTrackingMiddleware } from "../src/middleware/executionTracking.js";
import { modelResolution } from "../src/middleware/modelResolution.js";
import { createChainLoggingMiddleware } from "../src/middleware/chainLogging.js";

const SOURCE = "messenger";
// HotReloadService re-imports this file with a cache-busting query string on every edit
// (`import(filePath + '?t=' + Date.now())`), which creates a genuinely fresh module instance
// each time — a plain top-level `const` here would reset to empty on every reload. The
// Telegram bot connection in plugins/telegram.ts is NOT reloaded (it's set up once at
// startup and persists), so a reset guard can never see handlers a prior module instance
// already registered on it, and keeps adding duplicates — the same inbound message then
// gets processed (and replied to) once per surviving duplicate handler. Anchoring this
// state on globalThis instead makes it survive the reload along with the bot connection.
const sharedProcessedUpdates: Map<string, number> =
  ((globalThis as any).__roninMessengerProcessedUpdates ??= new Map());
const sharedConversations: Map<string, ConversationEntry[]> =
  ((globalThis as any).__roninMessengerConversations ??= new Map());
const registeredTelegramHandlers: Set<string> =
  ((globalThis as any).__roninMessengerTelegramHandlers ??= new Set());
const registeredDiscordHandlers: Set<string> =
  ((globalThis as any).__roninMessengerDiscordHandlers ??= new Set());
const MESSENGER_IDENTITY_AND_INTERFACE = `
**IDENTITY (DO NOT FORGET):**
- You are Ronin AI for the Ronin AI agent framework (Bun + TypeScript/JavaScript).
- "Ronin" here is NOT blockchain/DeFi/crypto.

**YOUR INTERFACE INSIDE RONIN:**
- You run in a SAR (Sense-Act-Respond) chain.
- "Act" means emitting tool calls; tool results are returned to you as "tool" messages.
- Use available Ronin tools/plugins (including ontology_*, skills.*, local.*) to do the work.
- Ronin Script is Ronin's token-efficient context format; use local.ronin_script.aggregate/parse/to_json/from_json when users ask about Ronin Script or structured context snapshots.
- After tools (or if no tools are needed), always send a clear user-facing response.
`;

/** Conversation history entry */
interface ConversationEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

/** Chat message interface */
interface ChatMessage {
  text: string;
  source: "telegram" | "discord" | "cli" | "webhook";
  sourceChannel: string;
  sourceUser: string;
  replyCallback?: (response: string) => Promise<void>;
}

function buildCondensedToolContext(api: DutyAPI): string {
  if (!api.tools?.list) return "";
  const tools = api.tools.list().map((t) => t.name);
  const has = (name: string) => tools.includes(name);
  const collectPrefix = (prefix: string, limit: number): string[] =>
    tools.filter((t) => t.startsWith(prefix)).slice(0, limit);

  const priority: string[] = [
    "skills.run",
    "local.memory.search",
    "local.file.read",
    "local.file.list",
    "local.db.query",
    "local.shell.safe",
    "local.ronin_script.aggregate",
    "local.ronin_script.parse",
    "local.ronin_script.to_json",
    "local.ronin_script.from_json",
    "ontology_search",
    "ontology_related",
    "ontology_stats",
  ].filter(has);

  const mcp = collectPrefix("mcp_", 8);
  const plugin = tools
    .filter((t) => !t.startsWith("local.") && !t.startsWith("ontology_") && !t.startsWith("mcp_") && t.includes("_"))
    .slice(0, 8);

  const lines: string[] = ["AVAILABLE TOOLS (CONDENSED):"];
  if (priority.length > 0) lines.push(`- Core: ${priority.join(", ")}`);
  if (plugin.length > 0) lines.push(`- Plugin-derived: ${plugin.join(", ")}`);
  if (mcp.length > 0) {
    lines.push(`- MCP (enabled): ${mcp.join(", ")}`);
    lines.push("- MCP naming convention: mcp_<server>_<tool>");
  }
  lines.push("- If unsure which tool to call, do tool discovery first via ontology_search(type: \"Tool\" or \"ReferenceDoc\") and then call the discovered tool.");
  return lines.join("\n");
}

async function buildSkillContext(api: DutyAPI): Promise<string> {
  if (!api.plugins?.has("skills")) return "";
  try {
    const rows = (await api.plugins.call("skills", "list_skills_with_abilities", {
      limit: 50,
    })) as Array<{ name?: string; abilities?: Array<{ name?: string }> }>;
    const names = rows
      .map((s) => String(s?.name ?? "").trim())
      .filter((n) => n.length > 0);
    if (names.length === 0) return "";

    const comms = names.filter((n) => /mail|email|inbox|gmail|outlook|message|telegram|discord/i.test(n));
    const others = names.filter((n) => !comms.includes(n));
    const selected = [...comms.slice(0, 6), ...others.slice(0, 8)];
    const unique = Array.from(new Set(selected));
    if (unique.length === 0) return "";

    return [
      "INSTALLED SKILLS (use via skills.run):",
      `- Available skill names: ${unique.join(", ")}`,
      '- First discover capabilities with skills.list ("list skills") to see all installed skills, then choose the best matching skill.',
      '- To execute a skill, call skills.run with {"query":"<skill or domain>","action":"<user intent>","params":{...}}.',
      '- Mail/email requests should usually use skills.run with query like "mail" or "email" and an explicit action (e.g., "list unread", "search invoices", "draft reply").',
      '- If no suitable skill exists and the task is macOS app/system automation, write AppleScript and execute it with available file/shell tools.',
    ].join("\n");
  } catch (error) {
    console.warn("[messenger] Failed to load skills context:", error);
    return "";
  }
}

/**
 * Build dynamic system prompt with SAR chain instructions and Ronin context
 */
async function buildMessengerSystemPrompt(
  api: DutyAPI,
  isFirstMessage: boolean,
  hasOntology: boolean
): Promise<string> {
  const context = await getRoninContext(api);
  const condensedToolContext = buildCondensedToolContext(api);
  const skillContext = await buildSkillContext(api);
  
  const basePrompt = buildSystemPrompt(context, {
    includeArchitecture: isFirstMessage,
    includeAgentList: isFirstMessage,
    includePluginList: isFirstMessage,
    includeRouteList: false,
    ontologyHint: hasOntology,
  });

  const sarInstructions = `

**HOW SAR CHAIN WORKS (CRITICAL):**
You operate in a SAR (Sense-Act-Respond) loop with these phases:
1. **Sense**: Read the conversation and understand the request
2. **Act**: Call tools to gather information or perform actions
3. **Respond**: Provide a clear answer to the user based on tool results

**MULTIPLE TOOL CALLS PER ITERATION:**
- You can call MULTIPLE tools in a single iteration - batch them efficiently
- List all tool calls you need at once; they will execute in parallel
- Example: Call ontology_search AND local.memory.search together if both are relevant
- Maximum iterations: 5, so batch tool calls wisely

**TOOL CALL FORMAT:**
- When you need tools, the system will extract your tool calls automatically
- After tools execute, their results appear as "tool" messages in the conversation
- You will see: [your tool call] → [tool result] → then you respond
- Use exact tool names as registered (dots are valid), e.g. local.memory.search or local.ronin_script.aggregate

**WHEN TO STOP CALLING TOOLS:**
- After tools return results, you MUST respond to the user with a clear answer
- Do NOT call the same tool twice with identical arguments
- If a tool succeeds, use its result to answer - don't call more tools unnecessarily
- Maximum 1-2 rounds of tool calls, then ALWAYS respond to the user
- If you cannot continue, return a clear abort message explaining why; never return an empty response

**RESPONSE STYLE:**
- DO THE WORK yourself using tools - don't tell users to run commands
- After tools complete, present results clearly (formatted lists, code blocks, etc.)
- For Mermaid diagrams: Show diagram code AND include mermaid.live link
- Be concise but thorough - explain what results mean, don't just echo raw output
- If all tools fail, call local.memory.search as a fallback before giving up

**EXAMPLES:**
- "What's the weather?" → Call skills.run → Respond: "Here's the weather: [result]"
- "Show my notes" → Call skills.run → Respond: "Found these notes: [formatted list]"
- "How does Ronin work?" → Use ontology_search + memory.search → Synthesize answer

Remember: Tools are means to an end. After getting results, ALWAYS respond to the user.`;

  const toolContextSection = condensedToolContext ? `\n\n${condensedToolContext}` : "";
  const skillContextSection = skillContext ? `\n\n${skillContext}` : "";
  return basePrompt + sarInstructions + "\n\n" + MESSENGER_IDENTITY_AND_INTERFACE + toolContextSection + skillContextSection;
}

/**
 * Create conversation history injection middleware
 * Injects stored conversation into ctx.messages at the right point in the pipeline
 */
function createConversationHistoryMiddleware(
  getHistory: () => ChainMessage[]
): Middleware<ChainContext> {
  return async (ctx, next) => {
    const history = getHistory();
    if (history.length > 0) {
      // Insert history after system messages but before any existing messages
      const systemMessages = ctx.messages.filter((m) => m.role === "system");
      const nonSystemMessages = ctx.messages.filter((m) => m.role !== "system");
      
      ctx.messages = [
        ...systemMessages,
        ...history,
        ...nonSystemMessages,
      ];
    }
    await next();
  };
}

/**
 * Build custom SAR middleware stack for Messenger
 * Excludes smartTrim to preserve conversation history
 */
function buildMessengerSAR(options: {
  api: DutyAPI;
  maxTokens?: number;
  maxToolIterations?: number;
  conversationHistory?: () => ChainMessage[];
}): MiddlewareStack<ChainContext> {
  const stack = new MiddlewareStack<ChainContext>();

  // 1. Logging
  stack.use(
    createChainLoggingMiddleware({
      level: "info",
    })
  );

  // 2. Model resolution
  stack.use(modelResolution);

  // 3. Ontology resolution (resolve references in context)
  stack.use(
    createOntologyResolveMiddleware({
      maxDepth: 2,
    })
  );

  // 4. Ontology injection (inject ontology context)
  stack.use(
    createOntologyInjectMiddleware()
  );

  // 5. Artifact detection/injection — cross-chat continuity for Artifact
  // projects (mentioning "the game assets project" in a Telegram message
  // days after the fact should pull its live state into context, same as
  // ontology resolution does for skills/tasks).
  stack.use(
    createArtifactInjectMiddleware({ api: options.api })
  );

  // 6. Conversation history injection (if provided)
  if (options.conversationHistory) {
    stack.use(createConversationHistoryMiddleware(options.conversationHistory));
  }

  // 7. Token guard (enforce budget, but no trimming)
  stack.use(
    createTokenGuardMiddleware({
      maxTokens: options.maxTokens || 8192,
    })
  );

  // 8. Execution tracking
  stack.use(createExecutionTrackingMiddleware());

  // 9. AI tool execution
  stack.use(
    createAiToolMiddleware({
      maxIterations: options.maxToolIterations || 5,
    })
  );

  return stack;
}

export default class MessengerAgent extends BaseDuty {
  private botId: string | null = null;
  private discordClientId: string | null = null;
  private discordBotUserId: string | null = null;
  private model: string;
  private localModel: string;
  private readonly maxConversationHistory = 10;
  private lastHomeFeedEmitAt = 0;

  constructor(api: DutyAPI) {
    super(api);
    console.log("[messenger] Starting enhanced SAR chain agent with conversation history");

    const aiConfig = this.api.config.getAI();
    this.localModel = aiConfig.models?.default ?? aiConfig.ollamaModel ?? "ministral-3:3b";
    this.model = aiConfig.useSmartForTools && aiConfig.models?.smart ? "smart" : this.localModel;

    // Set up Telegram handler (initialize bot if needed)
    this.setupTelegramHandler();

    // Set up Discord handler (initialize bot if needed)
    this.setupDiscordHandler();

    console.log("[messenger] Ready - using enhanced SAR chains with conversation history");
    this.emitHomeFeed("Ready", "Listening for Telegram/Discord messages");
    setTimeout(() => this.emitHomeFeed("Ready", "Listening for Telegram/Discord messages"), 3000);
  }

  async execute(): Promise<void> {
    // Event-driven - handlers registered in constructor
  }

  private emitHomeFeed(status: string, detail: string, priority = 95): void {
    const now = Date.now();
    if (now - this.lastHomeFeedEmitAt < 2000) return;
    this.lastHomeFeedEmitAt = now;
    this.api.events.emit(
      "home-feed",
      {
        agent: "messenger",
        title: "Messenger",
        priority,
        updatedAt: new Date(now).toISOString(),
        html: `<div><strong>Messenger</strong><div>${status}</div><small>${detail}</small></div>`,
      },
      "messenger"
    );
  }

  /**
   * Get or create conversation history key
   */
  private getConversationKey(sourceChannel: string, sourceUser: string): string {
    return `${sourceChannel}:${sourceUser}`;
  }

  /**
   * Add message to conversation history. Updates the in-process cache synchronously
   * (existing callers rely on this) and persists to disk in the background so history
   * survives a full process restart — sharedConversations alone only survives hot reload.
   */
  private addToConversation(
    key: string,
    role: "user" | "assistant",
    content: string
  ): void {
    let entries = sharedConversations.get(key);
    if (!entries) {
      entries = [];
      sharedConversations.set(key, entries);
    }

    entries.push({ role, content, timestamp: Date.now() });

    // Prune old entries
    while (entries.length > this.maxConversationHistory) {
      entries.shift();
    }

    this.api.memory.store(`conversation:${key}`, entries).catch((err) => {
      console.error("[messenger] Failed to persist conversation history:", err);
    });
  }

  /**
   * Load conversation history from disk into the in-process cache the first time a
   * conversation key is touched in this process (sharedConversations is empty right
   * after a real restart, but the SQLite-backed memory store isn't).
   */
  private async hydrateConversationIfNeeded(key: string): Promise<void> {
    if (sharedConversations.has(key)) return;
    try {
      const stored = (await this.api.memory.retrieve(`conversation:${key}`)) as
        | ConversationEntry[]
        | undefined;
      if (Array.isArray(stored) && stored.length > 0) {
        sharedConversations.set(key, stored);
      }
    } catch (err) {
      console.error("[messenger] Failed to hydrate conversation history:", err);
    }
  }

  /**
   * Get conversation history as ChainMessage array
   */
  private getConversationHistory(key: string): ChainMessage[] {
    const entries = sharedConversations.get(key) || [];
    return entries.map((e) => ({
      role: e.role === "user" ? "user" : "assistant",
      content: e.content,
    }));
  }

  /**
   * Check if this is the first message in a conversation
   */
  private isFirstMessage(key: string): boolean {
    const entries = sharedConversations.get(key);
    return !entries || entries.length === 0;
  }

  private setupTelegramHandler(): void {
    if (!this.api.telegram) {
      console.log("[intent-ingress] Telegram API not available");
      return;
    }

    const token = this.api.config.getTelegram().botToken;
    if (!token) {
      console.log("[intent-ingress] No Telegram bot token configured");
      return;
    }

    // Initialize bot (will reuse existing if already initialized)
    this.api.telegram.initBot(token).then((botId) => {
      // Store botId for later use
      this.api.memory.store("telegram_bot_id", botId).catch(() => {});

      if (registeredTelegramHandlers.has(botId)) {
        console.log(`[messenger] Telegram handler already registered for bot ${botId}, skipping duplicate`);
      } else {
        this.api.telegram.onMessage(botId, (msg: any) => {
          this.handleTelegramMessage(msg, botId).catch((err) => {
            console.error("[messenger] Error handling Telegram message:", err);
          });
        });
        registeredTelegramHandlers.add(botId);
        this.botId = botId;
        console.log(`[messenger] Telegram message handler registered for bot ${botId}`);
      }
    }).catch((err) => {
      // Bot already initialized - get existing botId and register handler
      console.debug("[messenger] Bot init returned error (may already exist):", err.message);
      this.api.memory.retrieve("telegram_bot_id").then((storedBotId) => {
        if (storedBotId) {
          try {
            if (registeredTelegramHandlers.has(storedBotId as string)) {
              console.log(`[messenger] Telegram handler already registered for bot ${storedBotId}, skipping duplicate`);
            } else {
              this.api.telegram.onMessage(storedBotId as string, (msg: any) => {
                this.handleTelegramMessage(msg, storedBotId as string).catch((err) => {
                  console.error("[messenger] Error handling Telegram message:", err);
                });
              });
              registeredTelegramHandlers.add(storedBotId as string);
              this.botId = storedBotId as string;
              console.log(`[messenger] Telegram message handler registered for existing bot ${storedBotId}`);
            }
          } catch (retryErr) {
            console.error("[messenger] Failed to register handler for existing bot:", retryErr);
          }
        }
      }).catch(() => {});
    });
  }

  private setupDiscordHandler(): void {
    if (!this.api.discord) {
      console.log("[messenger] Discord API not available");
      return;
    }

    const token = this.api.config.getDiscord().botToken;
    if (!token) {
      console.log("[messenger] No Discord bot token configured");
      return;
    }

    // plugins/discord.ts's initBot() caches by token, so this always resolves to the
    // same clientId whether this is a fresh boot or a hot-reload re-run of this duty.
    this.api.discord.initBot(token).then(async (clientId) => {
      this.discordClientId = clientId;

      if (registeredDiscordHandlers.has(clientId)) {
        console.log(`[messenger] Discord handler already registered for client ${clientId}, skipping duplicate`);
        return;
      }

      // Resolve the bot's real Discord snowflake ID so we can recognize `<@id>` mentions.
      // client.user is populated by the time initBot()'s login() resolves.
      try {
        const info = await this.api.discord!.getBotInfo(clientId);
        this.discordBotUserId = info.id;
      } catch (err) {
        console.warn("[messenger] Could not resolve Discord bot's own user ID (falling back to text-only '@ronin' mentions):", err);
      }

      this.api.discord!.onMessage(clientId, (msg: any) => {
        this.handleDiscordMessage(msg, clientId).catch((err) => {
          console.error("[messenger] Error handling Discord message:", err);
        });
      });
      registeredDiscordHandlers.add(clientId);
      console.log(`[messenger] Discord message handler registered for client ${clientId}`);
    }).catch((err) => {
      console.error("[messenger] Failed to initialize Discord bot:", err instanceof Error ? err.message : err);
    });
  }

  /**
   * Handle an incoming Discord message. Always responds in DMs; in guild channels,
   * only responds when the bot is actually @mentioned (real `<@id>` mention or literal
   * "@ronin" text) so it doesn't reply to every message in every channel it can see.
   */
  private async handleDiscordMessage(
    message: {
      id: string;
      content: string;
      author: { id: string; username: string; bot: boolean };
      channelId: string;
      guildId: string | null;
      timestamp: number;
    },
    clientId: string
  ): Promise<void> {
    if (message.author.bot) return; // ignore other bots, including ourselves

    const text = message.content || "";
    if (!text.trim()) return;

    const isDM = message.guildId === null;
    const mentionPattern = this.discordBotUserId
      ? new RegExp(`<@!?${this.discordBotUserId}>`)
      : null;
    const isMentioned =
      (mentionPattern ? mentionPattern.test(text) : false) || /(^|\s)@ronin\b/i.test(text);

    if (!isDM && !isMentioned) return;

    const cleanText = (mentionPattern ? text.replace(mentionPattern, "") : text)
      .replace(/@ronin/gi, "")
      .trim();
    if (!cleanText) return;

    await this.processMessage({
      text: cleanText,
      source: "discord",
      sourceChannel: `discord:${message.channelId}`,
      sourceUser: message.author.username || message.author.id,
      replyCallback: async (response) => {
        console.log(`[messenger] Sending Discord reply to channel ${message.channelId}`);
        await this.api.discord?.sendMessage(clientId, message.channelId, response);
      },
    });
  }

  private async handleTelegramMessage(update: any, botId: string): Promise<void> {
    // Update structure: { update_id, message: { chat, from, text, ... } }
    const msg = update.message;
    if (!msg) {
      console.log("[messenger] No message in update");
      return;
    }

    const text = msg.text || msg.caption || "";
    const chatId = msg.chat?.id;
    const chatType = msg.chat?.type;
    const isPrivateChat = chatType === "private";
    const dedupeKey = `tg:${update.update_id ?? "u"}:${msg.message_id ?? "m"}:${chatId ?? "c"}`;
    const now = Date.now();
    // Keep map bounded and drop old entries (>5 minutes)
    if (sharedProcessedUpdates.size > 500) {
      for (const [k, ts] of sharedProcessedUpdates) {
        if (now - ts > 5 * 60_000) sharedProcessedUpdates.delete(k);
      }
    }
    if (sharedProcessedUpdates.has(dedupeKey)) {
      console.log(`[messenger] Skipping duplicate Telegram update ${dedupeKey}`);
      return;
    }
    sharedProcessedUpdates.set(dedupeKey, now);

    console.log(`[messenger] Received Telegram message: "${text.substring(0, 50)}" (chat: ${chatType}, id: ${chatId})`);

    if (!text.trim()) {
      console.log("[messenger] Skipping empty message");
      return;
    }

    const sourceChannel = `telegram:${chatId}`;
    const sourceUser = String(msg.from?.id ?? msg.from?.username ?? `user:${chatId}`);

    // Only respond to @ronin mentions in group chats
    if (!isPrivateChat && !text.toLowerCase().includes("@ronin") && !text.includes("@T2RoninBot")) {
      console.log(`[messenger] Skipping non-mention in group chat`);
      return;
    }

    // Strip mention for processing
    const cleanText = text.replace(/@ronin|@T2RoninBot/gi, "").trim();
    console.log(`[messenger] Processing: "${cleanText.substring(0, 50)}"`);

    await this.processMessage({
      text: cleanText,
      source: "telegram",
      sourceChannel,
      sourceUser,
      replyCallback: async (response) => {
        if (chatId) {
          console.log(`[messenger] Sending reply to ${chatId}`);
          await this.api.telegram?.sendMessage(botId, chatId, response, { parseMode: "HTML" });
        }
      },
    });
  }

  /**
   * Process any message using SAR Chain with conversation history
   * AI decides: chat directly, call skills, emit events, use tools
   */
  private async processMessage(message: ChatMessage, retryNoResponse = false): Promise<void> {
    console.log(`[messenger] Processing from ${message.source}: "${message.text.substring(0, 60)}..."`);
    if (process.env.RONIN_MESSENGER_TOOL_DEBUG === "1" && this.api.tools?.list) {
      const names = this.api.tools.list().map((t) => t.name);
      const sample = names.slice(0, 20).join(", ");
      console.log(`[messenger] Tool visibility: ${names.length} total${sample ? ` | sample: ${sample}` : ""}`);
    }

    const conversationKey = this.getConversationKey(message.sourceChannel, message.sourceUser);
    await this.hydrateConversationIfNeeded(conversationKey);
    const isFirst = this.isFirstMessage(conversationKey);
    const hasOntology = this.api.plugins.has("ontology");

    // Build dynamic system prompt with Ronin context and SAR instructions
    const systemPrompt = await buildMessengerSystemPrompt(this.api, isFirst, hasOntology);

    // Get conversation history (as closure for middleware)
    const getHistory = () => {
      const history = this.getConversationHistory(conversationKey);
      const last = history[history.length - 1];
      if (last?.role === "user" && last.content === message.text) {
        return history.slice(0, -1);
      }
      return history;
    };

    // Add user message to history BEFORE chain runs (skip on no-response retry)
    if (!retryNoResponse) {
      this.addToConversation(conversationKey, "user", message.text);
    }

    const ctx: ChainContext = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message.text },
      ],
      ontology: {
        domain: "ingress",
        relevantSkills: [],
      },
      budget: {
        max: 8192,
        current: 0,
        reservedForResponse: 512,
      },
      conversationId: `${message.sourceChannel}-${Date.now()}`,
      model: this.model,
    };

    try {
      // Build custom SAR stack with conversation history injection
      const stack = buildMessengerSAR({
        api: this.api,
        maxTokens: 8192,
        maxToolIterations: 5,
        conversationHistory: getHistory,
      });
      
      const chain = this.createChain(SOURCE);
      chain.useMiddlewareStack(stack);
      chain.withContext(ctx);
      await chain.run();

      // Extract assistant messages from the chain execution
      const assistantMessages = ctx.messages
        .filter((m) => m.role === "assistant")
        .map((m) => {
          if (typeof m.content === "string") return m.content.trim();
          try {
            return JSON.stringify(m.content).trim();
          } catch {
            return String(m.content ?? "").trim();
          }
        })
        .filter((content) => content.length > 0)
        .join("\n\n");

      // This feeds the synthesis prompt (and can become the literal fallback reply sent
      // to the user verbatim if synthesis fails) — not just a terminal log line — so it
      // needs real fidelity. A 700-char cap was cutting structured tool results like
      // git_log's commit list off mid-JSON, and the synthesis model correctly reported
      // the malformed tail as "truncated" back to the user.
      const toPreview = (value: unknown, max = 4000): string => {
        try {
          const raw = typeof value === "string" ? value : JSON.stringify(value);
          return raw.length > max ? `${raw.slice(0, max)}...` : raw;
        } catch {
          const raw = String(value);
          return raw.length > max ? `${raw.slice(0, max)}...` : raw;
        }
      };

      const toolMessages = ctx.messages.filter((m) => m.role === "tool");
      let anyToolFailed = false;
      const toolSummaries = toolMessages.slice(0, 8).map((m: any, idx) => {
        try {
          const parsed = JSON.parse(m.content);
          const ok = parsed.success === true;
          if (!ok) anyToolFailed = true;
          const status = ok ? "✅ success" : "❌ error";
          const details = ok ? toPreview(parsed.data) : toPreview(parsed.error || "Unknown error");
          return `${idx + 1}. ${m.name || "tool"} — ${status}\n${details}`;
        } catch {
          return `${idx + 1}. ${m.name || "tool"} — ${toPreview(m.content)}`;
        }
      });
      const toolSummaryText = toolSummaries.join("\n\n");

      // Synthesize final response from tool results
      let finalResponse: string | null = null;

      if (toolMessages.length > 0 && message.replyCallback) {
        const synthesisPrompt =
          `System identity and interface:\n${MESSENGER_IDENTITY_AND_INTERFACE}\n\n` +
          `You are preparing the final user reply for a completed tool run.\n\n` +
          `User request:\n${message.text}\n\n` +
          `Draft assistant text (may be empty):\n${assistantMessages || "(none)"}\n\n` +
          `Tool execution summary:\n${toolSummaryText}\n\n` +
          `Write a concise, helpful final answer. Do not dump raw JSON. Do not repeat the draft text verbatim — ` +
          `it was written before the tools ran and does not reflect the outcome. ` +
          `If a tool failed, you MUST say so plainly (never leave the user thinking you're "still checking") ` +
          `and explain what that means for their request.`;
        try {
          const synthesized = await this.api.ai.complete(synthesisPrompt, {
            model: this.model,
            maxTokens: 700,
          });
          const synthesizedTrimmed = synthesized?.trim() ?? "";
          // A model can ignore the failure instruction and just echo the pre-tool-call
          // draft back (e.g. "I'll check on that..."), which silently hides a real error
          // from the user. If any tool in this turn failed, require the synthesis to
          // actually mention it — otherwise fall through to the deterministic summary below.
          const mentionsFailure = /error|fail|couldn'?t|could not|unable|issue|problem|not configured|not set up|not available/i.test(
            synthesizedTrimmed
          );
          if (synthesizedTrimmed && (!anyToolFailed || mentionsFailure)) {
            finalResponse = synthesizedTrimmed;
          }
        } catch (err) {
          console.error("[messenger] Synthesis failed, using summary fallback:", err);
        }

        if (!finalResponse) {
          finalResponse = toolSummaryText || assistantMessages || "✅ Completed.";
        }
      } else if (assistantMessages) {
        finalResponse = assistantMessages;
      }

      // Some model/tool-provider combinations can produce an empty assistant message
      // when no tool calls are emitted. Ensure users always get a textual reply.
      if (!finalResponse && message.replyCallback) {
        try {
          const fallback = await this.api.ai.complete(
            `System identity and interface:\n${MESSENGER_IDENTITY_AND_INTERFACE}\n\n` +
            `Reply naturally and helpfully to this user message:\n\n${message.text}`,
            {
              model: this.model,
              maxTokens: 300,
            }
          );
          if (fallback?.trim()) {
            finalResponse = fallback.trim();
          }
        } catch (err) {
          console.error("[messenger] Fallback response generation failed:", err);
        }
      }

      if (!finalResponse && message.replyCallback) {
        finalResponse = "✅ I completed your request, but couldn't format the full result. Please ask me to summarize it again.";
      }

      // Send response and save to conversation history
      if (finalResponse && message.replyCallback) {
        this.addToConversation(conversationKey, "assistant", finalResponse);
        await message.replyCallback(this.formatResponse(finalResponse));
        this.emitHomeFeed("Responded", `${message.source}: ${message.text.slice(0, 80)}`);
      } else {
        if (!retryNoResponse && message.replyCallback) {
          console.warn("[messenger] No response to send; re-running chain once...");
          this.emitHomeFeed("Retrying", "No response generated; retrying once", 96);
          await this.processMessage(message, true);
          return;
        }
        console.warn("[messenger] No response to send!");
        this.emitHomeFeed("No response", "Chain ended without user-facing response", 97);
      }
    } catch (error) {
      console.error("[messenger] Chain execution failed:", error);
      if (!retryNoResponse && message.replyCallback) {
        console.warn("[messenger] Chain failed; re-running once...");
        this.emitHomeFeed("Retrying", "Chain execution failed; retrying once", 97);
        await this.processMessage(message, true);
        return;
      }
      if (message.replyCallback) {
        await message.replyCallback(`❌ Error processing request: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
      this.emitHomeFeed("Error", error instanceof Error ? error.message.slice(0, 120) : "Unknown error", 98);
    }
  }

  /**
   * Format AI response for Telegram/HTML
   */
  private formatResponse(text: string): string {
    // Escape raw HTML first so Telegram entity parsing stays valid
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Apply a conservative markdown->HTML conversion using Telegram-safe tags
    let formatted = escaped
      .replace(/```[\w-]*\n([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/\n/g, "\n");

    // Truncate if too long for Telegram
    if (formatted.length > 4000) {
      formatted = formatted.substring(0, 3900) + "\n...\n<i>(Response truncated)</i>";
    }

    return formatted;
  }

  /**
   * Handle CLI requests (called from CLI commands)
   */
  async handleCLIRequest(text: string): Promise<string> {
    let response = "";
    await this.processMessage({
      text,
      source: "cli",
      sourceChannel: "cli:terminal",
      sourceUser: process.env.USER || "user",
      replyCallback: async (r) => { response = r; },
    });
    return response;
  }
}
