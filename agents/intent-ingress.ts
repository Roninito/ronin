import { BaseAgent } from "/Users/ronin/Desktop/Bun Apps/ronin/src/agent/index.js";
import type { AgentAPI } from "/Users/ronin/Desktop/Bun Apps/ronin/src/types/index.js";
import { readdir, readFile, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { ensureDefaultExternalAgentDir, ensureDefaultAgentDir } from "/Users/ronin/Desktop/Bun Apps/ronin/src/cli/commands/config.js";

interface PlanProposedPayload {
  id: string;
  title: string;
  description: string;
  tags: string[];
  source: "telegram" | "discord" | "cli" | "webhook";
  sourceChannel: string;
  sourceUser: string;
  proposedAt: number;
  rawContent: string;
  command?: string;
}

interface ChatSession {
  messages: Array<{ role: "user" | "assistant"; content: string; timestamp: number }>;
  lastActivity: number;
}

/**
 * Intent Ingress Agent
 * 
 * Processes incoming messages from various sources (Telegram, Discord, etc.)
 * and creates tasks/plans based on commands or engages in conversational chat.
 * 
 * Supported formats:
 * - @ronin create-agent AgentName that does X → Creates agent with #create tag
 * - @ronin task Description here → Creates task with #plan tag  
 * - #ronin #plan Description → Legacy format, creates plan
 * - General chat → Conversational AI with Ronin context
 */
interface PendingApproval {
  planId: string;
  title: string;
  description: string;
  tags: string[];
  source: string;
  sourceChannel: string;
  sourceUser: string;
  command?: string;
  createdAt: number;
}

export default class IntentIngressAgent extends BaseAgent {
  private botId: string | null = null;
  private sourceChannels: Map<string, { type: string; id: string | number }> = new Map();
  private chatSessions: Map<string, ChatSession> = new Map();
  private processedMessages: Set<string> = new Set(); // Deduplication
  private pendingApprovals: Map<string, PendingApproval> = new Map(); // Track tasks awaiting approval
  private model: string;
  private maxChatHistory = 20; // Keep last 20 messages per session
  private sessionTimeout = 30 * 60 * 1000; // 30 minutes
  private approvalTimeout = 24 * 60 * 60 * 1000; // 24 hours
  private telegramInitialized = false;
  private telegramHandlerRegistered = false;
  private discordInitialized = false;

  constructor(api: AgentAPI) {
    super(api);
    console.log("[intent-ingress] Agent initializing...");
    this.model = this.api.config.getAI().ollamaModel || "qwen3:4b";
    this.initializeTelegram();
    this.initializeDiscord();
    this.startSessionCleanup();
    this.startApprovalCleanup();
    this.registerCompletionListeners();

    // Analytics: report lifecycle
    this.api.events.emit("agent.lifecycle", {
      agent: "intent-ingress", status: "started", timestamp: Date.now(),
    }, "intent-ingress");

    console.log("[intent-ingress] Agent initialized successfully");
  }

  /**
   * Register listeners for plan completion to notify users
   */
  private registerCompletionListeners(): void {
    // Listen for PlanCompleted events and notify the original user
    this.api.events.on("PlanCompleted", (data: unknown) => {
      const payload = data as {
        id: string;
        title?: string;
        source?: string;
        sourceChannel?: string;
        sourceUser?: string;
        reloadStatus?: string;
      };
      
      if (payload.source && payload.sourceChannel) {
        console.log(`[intent-ingress] Plan ${payload.id} completed, notifying user`);
        this.sendCompletionNotification(payload, true);
      }
    }, "intent-ingress");

    // Listen for PlanFailed events and notify the original user
    this.api.events.on("PlanFailed", (data: unknown) => {
      const payload = data as {
        id: string;
        title?: string;
        source?: string;
        sourceChannel?: string;
        sourceUser?: string;
        error?: string;
      };
      
      if (payload.source && payload.sourceChannel) {
        console.log(`[intent-ingress] Plan ${payload.id} failed, notifying user`);
        this.sendCompletionNotification(payload, false);
      }
    }, "intent-ingress");

    console.log("[intent-ingress] Registered completion listeners");
  }

  /**
   * Send completion notification back to the user
   */
  private async sendCompletionNotification(
    payload: {
      id: string;
      title?: string;
      source?: string;
      sourceChannel?: string;
      sourceUser?: string;
      error?: string;
      reloadStatus?: string;
    },
    success: boolean
  ): Promise<void> {
    const { source, sourceChannel, id, title } = payload;
    const [sourceType, channelId] = sourceChannel!.split(":");
    
    const emoji = success ? "✅" : "❌";
    const status = success ? "COMPLETED" : "FAILED";
    const shortId = id.substring(0, 20);
    
    let message: string;
    if (success) {
      message = `${emoji} <b>Task ${status}</b>\n\n` +
        `<b>Title:</b> ${title || "Task"}\n` +
        `<b>ID:</b> <code>${shortId}...</code>\n` +
        `<b>Status:</b> Successfully created and deployed\n` +
        `<b>View:</b> Check your Kanban board at /todo`;
    } else {
      message = `${emoji} <b>Task ${status}</b>\n\n` +
        `<b>Title:</b> ${title || "Task"}\n` +
        `<b>ID:</b> <code>${shortId}...</code>\n` +
        `<b>Error:</b> ${payload.error?.substring(0, 100) || "Unknown error"}\n\n` +
        `Check the Kanban board at /todo for details.`;
    }

    try {
      if (sourceType === "telegram" && this.botId) {
        await this.api.telegram.sendMessage(
          this.botId,
          channelId,
          message,
          { parseMode: "HTML" }
        );
        console.log(`[intent-ingress] Sent completion notification to Telegram user`);
      } else if (sourceType === "discord") {
        console.log(`[intent-ingress] Would send Discord notification: ${message.substring(0, 100)}`);
      }
    } catch (err) {
      console.error(`[intent-ingress] Failed to send completion notification:`, err);
    }
  }

  /**
   * Initialize Telegram bot
   */
  private async initializeTelegram(): Promise<void> {
    // Prevent multiple initializations
    if (this.telegramInitialized) {
      console.log("[intent-ingress] Telegram already initialized, skipping");
      return;
    }

    try {
      const configTelegram = this.api.config.getTelegram();
      const botToken = configTelegram.botToken || 
        process.env.TELEGRAM_BOT_TOKEN || 
        await this.api.memory.retrieve("telegram_bot_token");
      
      if (!botToken || typeof botToken !== "string") {
        console.log("[intent-ingress] Telegram not configured");
        return;
      }

      // Only initialize if not already done
      if (!this.botId) {
        if (!this.api.telegram) {
          console.log("[intent-ingress] Telegram plugin not loaded, skipping initialization");
          return;
        }
        this.botId = await this.api.telegram.initBot(botToken, {
          allowed_updates: ["message"]
        });
        console.log("[intent-ingress] Telegram bot initialized");

        // Only register the handler once - using a named function to prevent dupes
        if (!this.telegramHandlerRegistered) {
          const handler = (msg: any) => {
            this.handleTelegramMessage(msg).catch(err => {
              console.error("[intent-ingress] Error handling Telegram message:", err);
            });
          };
          
          this.api.telegram.onMessage(this.botId, handler);
          this.telegramHandlerRegistered = true;
          console.log("[intent-ingress] Telegram message handler registered");
        } else {
          console.log("[intent-ingress] Telegram handler already registered");
          return;
        }
        
        console.log("[intent-ingress] Listening for Telegram commands...");
      }
    } catch (error) {
      console.error("[intent-ingress] Failed to initialize Telegram:", error);
    }
  }

  /**
   * Initialize Discord bot (if configured)
   */
  private discordBotId: string | null = null;

  private async initializeDiscord(): Promise<void> {
    // Prevent multiple initializations
    if (this.discordInitialized) {
      console.log("[intent-ingress] Discord already initialized, skipping");
      return;
    }
    
    try {
      const configDiscord = this.api.config.getDiscord();
      if (!configDiscord.enabled) {
        return;
      }

      const botToken = configDiscord.botToken || process.env.DISCORD_BOT_TOKEN;
      if (!botToken) {
        console.log("[intent-ingress] Discord not configured");
        return;
      }

      this.discordInitialized = true;
      this.discordBotId = await this.api.discord.initBot(botToken);
      console.log("[intent-ingress] Discord bot initialized");

      // Only register the handler once
      this.api.discord.onMessage(this.discordBotId, (msg) => {
        this.handleDiscordMessage(msg, this.discordBotId!);
      });

      console.log("[intent-ingress] Listening for Discord commands...");
    } catch (error) {
      this.discordInitialized = false;
      console.error("[intent-ingress] Failed to initialize Discord:", error);
    }
  }

  /**
   * Parse a command from message text
   */
  private parseCommand(text: string): {
    command: string | null;
    args: string;
    tags: string[];
    isChat: boolean;
  } {
    const lowerText = text.toLowerCase();
    
    // Check for @ronin commands
    const roninMatch = text.match(/@ronin\s+(\w+)(?:-(\w+))?\s+(.+)/is);
    if (roninMatch) {
      const action = roninMatch[1].toLowerCase();
      const subAction = roninMatch[2]?.toLowerCase();
      const args = roninMatch[3].trim();
      
      if (action === "create" && subAction === "agent") {
        return { command: "create-agent", args, tags: ["create", "agent"], isChat: false };
      }
      if (action === "task") {
        return { command: "task", args, tags: ["plan"], isChat: false };
      }
      if (action === "fix") {
        return { command: "fix", args, tags: ["create", "fix"], isChat: false };
      }
      if (action === "update") {
        return { command: "update", args, tags: ["create", "update"], isChat: false };
      }
    }

    // Check for hashtag commands
    const hasRoninTag = lowerText.includes("#ronin");
    const hasPlanTag = lowerText.includes("#plan");
    const hasCreateTag = lowerText.includes("#create");
    const hasBuildTag = lowerText.includes("#build");
    const hasFixTag = lowerText.includes("#fix");
    const hasUpdateTag = lowerText.includes("#update");
    
    // #ronin #plan together (legacy format)
    if (hasRoninTag && hasPlanTag) {
      const cleanContent = text
        .replace(/#ronin/gi, "")
        .replace(/#plan/gi, "")
        .trim();
      const tags = this.extractTags(text);
      return { command: "plan", args: cleanContent, tags, isChat: false };
    }
    
    // Just #plan by itself (create a task)
    if (hasPlanTag) {
      const cleanContent = text
        .replace(/#plan/gi, "")
        .trim();
      const tags = ["plan", ...this.extractTags(text)];
      return { command: "plan", args: cleanContent, tags, isChat: false };
    }

    // #create or #build with or without #ronin
    if (hasCreateTag || hasBuildTag) {
      const cleanContent = text
        .replace(/#ronin/gi, "")
        .replace(/#create/gi, "")
        .replace(/#build/gi, "")
        .trim();
      const tags = ["create", ...this.extractTags(text)];
      return { command: "create", args: cleanContent, tags, isChat: false };
    }
    
    // #fix for bug fixes
    if (hasFixTag) {
      const cleanContent = text
        .replace(/#fix/gi, "")
        .trim();
      const tags = ["fix", ...this.extractTags(text)];
      return { command: "fix", args: cleanContent, tags, isChat: false };
    }
    
    // #update for modifications
    if (hasUpdateTag) {
      const cleanContent = text
        .replace(/#update/gi, "")
        .trim();
      const tags = ["update", ...this.extractTags(text)];
      return { command: "update", args: cleanContent, tags, isChat: false };
    }

    // Natural language detection for agent creation
    // Pattern: "create an agent that..." or "make an agent to..."
    const createAgentPattern = /^(?:create|make|build)\s+(?:an?\s+)?agent\s+(?:that|to|for)\s+(.+)$/i;
    const createAgentMatch = text.match(createAgentPattern);
    if (createAgentMatch) {
      const description = createAgentMatch[1].trim();
      // Extract agent name from description (first word or capitalized words)
      const nameMatch = description.match(/^([A-Z][a-z]+(?:[A-Z][a-z]+)*)/);
      const agentName = nameMatch ? nameMatch[1] : "NewAgent";
      const cleanDescription = description.replace(/^[A-Z][a-z]+(?:[A-Z][a-z]+)*\s*/, "").trim();
      return { 
        command: "create-agent", 
        args: `${agentName} ${cleanDescription}`, 
        tags: ["create", "agent"], 
        isChat: false 
      };
    }

    // Natural language detection for task creation
    // Pattern: "create a task to..." or "I need a task for..."
    const createTaskPattern = /^(?:create|make|add)\s+(?:a\s+)?task\s+(?:to|for)\s+(.+)$/i;
    const createTaskMatch = text.match(createTaskPattern);
    if (createTaskMatch) {
      return { 
        command: "plan", 
        args: createTaskMatch[1].trim(), 
        tags: ["plan"], 
        isChat: false 
      };
    }

    // Default to chat mode for any message that doesn't match a command
    return { command: null, args: text, tags: [], isChat: true };
  }

  /**
   * Handle Telegram messages
   * 
   * In groups/channels: Only respond to @ronin mentions or commands
   * In direct messages: Respond to all messages
   */
  private async handleTelegramMessage(update: { 
    update_id: number;
    message?: {
      message_id: number;
      chat?: { id: number; type?: string };
      from?: { username?: string; first_name?: string; id: number };
      reply_to_message?: { text?: string };
      text?: string;
    };
  }): Promise<void> {
    const msg = update.message;
    if (!msg) {
      console.log(`[intent-ingress] Ignoring update without message`);
      return;
    }
    
    // Deduplication: Check if we've already processed this message
    const messageKey = `telegram:${msg.chat?.id || 'unknown'}:${msg.message_id}`;
    console.log(`[intent-ingress] Checking dedup key: ${messageKey}`);
    if (this.processedMessages.has(messageKey)) {
      console.log(`[intent-ingress] Ignoring duplicate message: ${messageKey}`);
      return;
    }
    this.processedMessages.add(messageKey);
    console.log(`[intent-ingress] Added to processed messages. Total: ${this.processedMessages.size}`);
    
    // Clean up old message IDs (keep last 1000)
    if (this.processedMessages.size > 1000) {
      const iterator = this.processedMessages.values();
      for (let i = 0; i < 500; i++) {
        const oldKey = iterator.next().value;
        this.processedMessages.delete(oldKey);
      }
    }
    
    const text = msg.text || "";
    
    // Check if chat exists
    if (!msg.chat) {
      console.log(`[intent-ingress] Ignoring message without chat context`);
      return;
    }
    
    const chatType = msg.chat.type || "private";
    const isPrivateChat = chatType === "private";
    const sourceUser = msg.from?.username || msg.from?.first_name || "unknown";
    
    // DEBUG: Log full message structure
    console.log(`[intent-ingress] DEBUG - Full msg.from:`, JSON.stringify(msg.from));
    console.log(`[intent-ingress] DEBUG - Full msg.chat:`, JSON.stringify(msg.chat));
    
    // Build candidate identities so auth works with either numeric IDs or usernames.
    const authCandidates: string[] = [];
    if (msg.from?.id) {
      authCandidates.push(`${msg.from.id}`);
    }
    if (msg.from?.username) {
      authCandidates.push(msg.from.username);
      authCandidates.push(`@${msg.from.username}`);
    }
    // Last resort for unusual updates where from is missing.
    if (authCandidates.length === 0 && msg.chat?.id) {
      authCandidates.push(`chat:${msg.chat.id}`);
    }

    console.log(`[intent-ingress] Extracted auth candidates: ${authCandidates.join(", ") || "FAILED"}`);
    console.log(`[intent-ingress] Message from ${sourceUser} in ${chatType} chat: "${text.substring(0, 50)}"`);
    
    // AUTHENTICATION CHECK
    if (authCandidates.length === 0) {
      console.error(`[intent-ingress] CRITICAL: Could not extract user ID from message`);
      console.error(`[intent-ingress] Message structure:`, JSON.stringify(msg, null, 2));
      return;
    }
    
    // Check authorization using auth service
    const isAuthorized = await this.checkAuthorization("telegram", authCandidates);
    if (!isAuthorized) {
      console.warn(`[intent-ingress] UNAUTHORIZED: User candidates [${authCandidates.join(", ")}] on Telegram`);
      // Optionally send a response
      if (this.botId && isPrivateChat) {
        await this.api.telegram.sendMessage(
          this.botId, 
          msg.chat.id, 
          "⛔ Access denied. You are not authorized to use this bot.",
          { parseMode: "HTML" }
        );
      }
      return;
    }
    
    // In groups/channels, only respond to @ronin mentions or /commands
    if (!isPrivateChat) {
      const hasMention = text.toLowerCase().includes("@ronin") || text.includes("@T2RoninBot");
      const isCommand = text.startsWith("/");
      
      if (!hasMention && !isCommand) {
        console.log(`[intent-ingress] Ignoring message in group without mention`);
        return;
      }
    }
    
    console.log(`[intent-ingress] Processing message...`);
    const parsed = this.parseCommand(text);
    
    console.log(`[intent-ingress] Parsed command: ${parsed.command || 'null'}, isChat: ${parsed.isChat}, args: "${parsed.args.substring(0, 30)}..."`);
    
    const sourceChannel = `telegram:${msg.chat.id}`;
    
    // Check for approval responses (yes/no)
    if (text.match(/^\s*(y|yes|yeah|sure|go|approve|start|do it)\s*$/i)) {
      // Handle 'yes' approval
      if (msg.reply_to_message?.text) {
        const idMatch = msg.reply_to_message.text.match(/ID:\s*<code>(.+?)<\/code>/i);
        if (idMatch && idMatch[1]) {
          const planId = idMatch[1].trim();
          console.log(`[intent-ingress] Detected approval for plan ${planId}`);
          await this.handleApprovalResponse(planId, true, sourceChannel);
          return;
        }
      }
    } else if (text.match(/^\s*(n|no|nope|stop|stay|wait|deny|disapprove)\s*$/i)) {
      // Handle 'no' response
      if (msg.reply_to_message?.text) {
        const idMatch = msg.reply_to_message.text.match(/ID:\s*<code>(.+?)<\/code>/i);
        if (idMatch && idMatch[1]) {
          const planId = idMatch[1].trim();
          console.log(`[intent-ingress] Detected disapproval for plan ${planId}`);
          await this.handleApprovalResponse(planId, false, sourceChannel);
          return;
        }
      }
    }
    
    if (parsed.isChat || !parsed.command) {
      console.log(`[intent-ingress] Handling as chat message`);
      // Handle as conversational chat
      this.handleChatMessage({
        text: parsed.args,
        source: "telegram",
        sourceChannel,
        sourceUser,
        replyCallback: async (response: string) => {
          if (this.botId) {
            await this.api.telegram.sendMessage(this.botId, msg.chat!.id, response, { parseMode: "HTML" });
          }
        },
      });
      return;
    }

    // Handle as command
    console.log(`[intent-ingress] Telegram ${parsed.command}:`, parsed.args.substring(0, 50));
    console.log(`[intent-ingress] Message key: ${messageKey} - processing command`);

    this.createPlan({
      command: parsed.command,
      args: parsed.args,
      tags: parsed.tags,
      source: "telegram",
      sourceChannel,
      sourceUser,
      rawContent: text,
    });
  }

  /**
   * Handle Discord messages
   */
  private handleDiscordMessage(msg: {
    content?: string;
    channelId: string;
    author: { username: string; id: string };
  }, botId: string): void {
    const text = msg.content || "";
    
    // Check if bot is mentioned
    const botMention = `<@${botId}>`;
    if (!text.includes(botMention) && !text.includes("@ronin")) {
      return;
    }

    // Replace bot mention with @ronin for consistent parsing
    const normalizedText = text.replace(botMention, "@ronin");
    
    const parsed = this.parseCommand(normalizedText);

    const sourceChannel = `discord:${msg.channelId}`;
    const sourceUser = msg.author.username;

    if (parsed.isChat || !parsed.command) {
      // Handle as conversational chat
      this.handleChatMessage({
        text: parsed.args,
        source: "discord",
        sourceChannel,
        sourceUser,
        replyCallback: async (response: string) => {
          // Discord reply would go here
          console.log(`[intent-ingress] Discord reply: ${response.substring(0, 100)}...`);
        },
      });
      return;
    }

    // Handle as command
    console.log(`[intent-ingress] Discord ${parsed.command}:`, parsed.args.substring(0, 50));

    this.createPlan({
      command: parsed.command,
      args: parsed.args,
      tags: parsed.tags,
      source: "discord",
      sourceChannel,
      sourceUser,
      rawContent: text,
    });
  }

  /**
   * Handle conversational chat message with tool support
   */
  private async handleChatMessage(params: {
    text: string;
    source: string;
    sourceChannel: string;
    sourceUser: string;
    replyCallback: (response: string) => Promise<void>;
  }): Promise<void> {
    const sessionId = params.sourceChannel;
    
    console.log(`[intent-ingress] Chat from ${params.sourceUser}: ${params.text.substring(0, 50)}`);

    try {
      // Check if this is a web browsing request
      const webMatch = params.text.match(/(?:visit|check|view|browse|open)\s+(?:the\s+)?(?:url|website|site|page)?\s*:?\s*(https?:\/\/\S+|localhost:\d+\S*|\/\S+)/i);
      if (webMatch) {
        const url = webMatch[1];
        console.log(`[intent-ingress] Detected web browsing request: ${url}`);
        await params.replyCallback(`🔍 Fetching ${url}...`);
        
        try {
          const result = await this.fetchWebContent(url);
          await params.replyCallback(result);
          return;
        } catch (error) {
          await params.replyCallback(`❌ Failed to fetch ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return;
        }
      }

      // Check if this is a shell command request
      const shellMatch = params.text.match(/(?:run|execute|exec)\s+(?:command|cmd)[:\s]+(.+)/i) || 
                        params.text.match(/^[`\$](.+)[`\$]$/);
      if (shellMatch) {
        const command = shellMatch[1].trim();
        console.log(`[intent-ingress] Detected shell command request: ${command}`);
        
        // Check if dangerous
        if (this.isDangerousCommand(command)) {
          await params.replyCallback(`⚠️ Command "${command}" may be destructive. Use @ronin create-agent to create a safe execution environment.`);
          return;
        }
        
        await params.replyCallback(`💻 Executing: ${command}...`);
        
        try {
          const result = await this.executeShellCommand(command);
          await params.replyCallback(result);
          return;
        } catch (error) {
          await params.replyCallback(`❌ Command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return;
        }
      }

      // Regular chat handling
      // Get or create chat session
      let session = this.chatSessions.get(sessionId);
      if (!session) {
        session = { messages: [], lastActivity: Date.now() };
        this.chatSessions.set(sessionId, session);
      }

      // Add user message
      session.messages.push({
        role: "user",
        content: params.text,
        timestamp: Date.now(),
      });
      session.lastActivity = Date.now();

      // Trim history if needed
      if (session.messages.length > this.maxChatHistory) {
        session.messages = session.messages.slice(-this.maxChatHistory);
      }

      // Build context and system prompt
      const context = await this.buildRoninContext();
      const systemPrompt = this.buildSystemPrompt(context);

      // Prepare messages for AI
      const aiMessages = [
        { role: "system" as const, content: systemPrompt },
        ...session.messages.slice(-10).map(m => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      // Get AI response
      const response = await this.api.ai.chat(aiMessages, {
        model: this.model,
        maxTokens: 2000,
        temperature: 0.7,
      });

      const assistantContent = response.content || `I'm here to help you with Ronin! 

You can:
• Chat with me about how Ronin works
• Create agents: @ronin create-agent AgentName that does X
• Fix bugs: @ronin fix description of the issue  
• Create tasks: @ronin task description
• Browse web: "visit https://example.com" or "check localhost:3000/status"
• Run commands: "run command: ls -la" or \`pwd\`

What would you like to do?`;

      // Add assistant response to session
      session.messages.push({
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
      });

      // Send reply
      console.log(`[intent-ingress] Sending reply: "${assistantContent.substring(0, 100)}..."`);
      await params.replyCallback(assistantContent);

      console.log(`[intent-ingress] Replied to ${params.sourceUser}`);
    } catch (error) {
      console.error("[intent-ingress] Chat error:", error);
      try {
        await params.replyCallback("Sorry, I encountered an error processing your message.");
      } catch (replyError) {
        console.error("[intent-ingress] Failed to send error reply:", replyError);
      }
    }
  }

  /**
   * Check if a command is potentially dangerous
   */
  private isDangerousCommand(command: string): boolean {
    const dangerous = ['rm', 'del', 'dd', 'mkfs', 'format', 'sudo', 'su', 'shutdown', 'reboot', 'kill', '>'];
    return dangerous.some(d => command.toLowerCase().includes(d));
  }

  /**
   * Fetch web content via Web Viewer agent
   */
  private async fetchWebContent(url: string): Promise<string> {
    try {
      // Check if it's a local Ronin route
      if (url.startsWith('/')) {
        url = `http://localhost:3000${url}`;
      }

      console.log(`[intent-ingress] Fetching web content from: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Ronin-IntentIngress/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      let content: string;

      if (contentType.includes('json')) {
        const json = await response.json();
        content = JSON.stringify(json, null, 2);
      } else {
        content = await response.text();
        // Extract text from HTML
        if (contentType.includes('html')) {
          content = this.extractTextFromHtml(content);
        }
      }

      // Truncate if too long
      if (content.length > 4000) {
        content = content.substring(0, 4000) + '\n\n[Content truncated...]';
      }

      return `🌐 **Result from ${url}:**\n\n\`\`\`\n${content}\n\`\`\``;
    } catch (error) {
      throw new Error(`Failed to fetch ${url}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract readable text from HTML
   */
  private extractTextFromHtml(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }

  /**
   * Execute shell command via Term Manager (limited safe commands only)
   */
  private async executeShellCommand(command: string): Promise<string> {
    // Whitelist of safe commands
    const allowedCommands = ['ls', 'pwd', 'cat', 'head', 'tail', 'echo', 'ps', 'df', 'du', 'grep', 'find', 'git status', 'git log', 'git diff'];
    const baseCmd = command.trim().split(/\s+/)[0].toLowerCase();
    
    if (!allowedCommands.some(cmd => command.toLowerCase().startsWith(cmd))) {
      return `❌ Command "${baseCmd}" is not in the allowed list for safety.\n\nAllowed commands: ${allowedCommands.join(', ')}\n\nFor more complex operations, use @ronin create-agent to create a specialized agent.`;
    }

    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      console.log(`[intent-ingress] Executing safe command: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      });

      let result = stdout || 'Command executed successfully (no output)';
      if (stderr) {
        result += '\n\n**Stderr:**\n' + stderr;
      }

      // Truncate if too long
      if (result.length > 4000) {
        result = result.substring(0, 4000) + '\n\n[Output truncated...]';
      }

      return `💻 **Result of \`${command}\`:**\n\n\`\`\`\n${result}\n\`\`\``;
    } catch (error: any) {
      return `❌ Command failed:\n\n\`\`\`\n${error.message}\n${error.stderr || ''}\n\`\`\``;
    }
  }

  /**
   * Create a plan/task from parsed command
   */
  private createPlan(params: {
    command: string;
    args: string;
    tags: string[];
    source: "telegram" | "discord" | "cli" | "webhook";
    sourceChannel: string;
    sourceUser: string;
    rawContent: string;
  }): void {
    // Check for duplicate plan creation attempts
    const planKey = `${params.source}:${params.sourceChannel}:${params.rawContent}`;
    if (this.processedMessages.has(`plan:${planKey}`)) {
      console.log(`[intent-ingress] Preventing duplicate plan creation for: ${planKey.substring(0, 50)}...`);
      return;
    }
    this.processedMessages.add(`plan:${planKey}`);
    
    console.log(`[intent-ingress] Creating plan for command: ${params.command}`);
    
    // Generate unique ID
    const id = `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Extract title (first sentence) and description (rest)
    const title = this.extractTitle(params.args);
    const description = this.extractDescription(params.args);

    // Build payload
    const payload: PlanProposedPayload = {
      id,
      title,
      description,
      tags: params.tags,
      source: params.source,
      sourceChannel: params.sourceChannel,
      sourceUser: params.sourceUser,
      proposedAt: Date.now(),
      rawContent: params.rawContent,
      command: params.command,
    };

    // Store pending approval
    this.pendingApprovals.set(id, {
      planId: id,
      title,
      description,
      tags: params.tags,
      source: params.source,
      sourceChannel: params.sourceChannel,
      sourceUser: params.sourceUser,
      command: params.command,
      createdAt: Date.now(),
    });

    // Analytics: track plan creation as a task
    const taskStartTime = Date.now();
    this.api.events.emit("agent.task.started", {
      agent: "intent-ingress", taskId: id, taskName: `plan-${params.command}`, timestamp: taskStartTime,
    }, "intent-ingress");

    // Emit the event
    this.api.events.emit("PlanProposed", payload, "intent-ingress");
    console.log(`[intent-ingress] Emitted PlanProposed: ${id} (${params.command})`);

    // Send acknowledgment with approval request
    this.sendAcknowledgment(params.source, params.sourceChannel, params.command, title, id);

    // Analytics: plan created successfully
    this.api.events.emit("agent.task.completed", {
      agent: "intent-ingress", taskId: id, duration: Date.now() - taskStartTime, timestamp: Date.now(),
    }, "intent-ingress");
    this.api.events.emit("agent.metric", {
      agent: "intent-ingress", metric: "plans_created", value: this.pendingApprovals.size, timestamp: Date.now(),
    }, "intent-ingress");
  }

  /**
   * Send acknowledgment back to source
   */
  private async sendAcknowledgment(
    source: string,
    sourceChannel: string,
    command: string,
    title: string,
    id: string
  ): Promise<void> {
    const [sourceType, channelId] = sourceChannel.split(":");
    
    const emoji = command.includes("create") ? "🏗️" : 
                  command.includes("fix") ? "🔧" : 
                  command.includes("update") ? "📝" : "📋";

    // Build approval request message
    const message = `${emoji} <b>New Task Created</b>\n\n` +
      `<b>Title:</b> ${title}\n` +
      `<b>ID:</b> <code>${id}</code>\n\n` +
      `Reply with <b>yes</b> to start working on this task right now.\n` +
      `Reply with <b>no</b> to leave it in the backlog.`;

    try {
      if (sourceType === "telegram" && this.botId) {
        await this.api.telegram.sendMessage(
          this.botId,
          channelId,
          message,
          { parseMode: "HTML" }
        );
      } else if (sourceType === "discord") {
        // Discord plugin sendMessage would go here
        console.log(`[intent-ingress] Would send Discord approval request: ${message.replace(/<[^>]*>/g, '')}`);
      }
    } catch (err) {
      console.error(`[intent-ingress] Failed to send approval request to ${source}:`, err);
    }
  }

  /**
   * Extract title from content (first sentence or first line)
   */
  private extractTitle(content: string): string {
    // First sentence (preferred - captures full meaning)
    const sentenceEndMatch = content.match(/[.!?]/);
    if (sentenceEndMatch && sentenceEndMatch.index !== undefined && sentenceEndMatch.index > 0) {
      const firstSentence = content.substring(0, sentenceEndMatch.index).trim();
      if (firstSentence.length > 0 && firstSentence.length < 100) {
        return firstSentence;
      }
    }

    // For create-agent commands, extract agent name (only if no sentence structure)
    const agentMatch = content.match(/^(\w+)(?:\s+that|\s+which|\s+to)?/i);
    if (agentMatch) {
      const name = agentMatch[1];
      if (name.length > 0 && name.length < 50) {
        return name;
      }
    }

    // First line
    const firstLine = content.split("\n")[0].trim();
    if (firstLine.length > 0 && firstLine.length < 100) {
      return firstLine;
    }

    // Truncated
    return content.substring(0, 100).trim() + (content.length > 100 ? "..." : "");
  }

  /**
   * Extract description from content (everything after first sentence)
   */
  private extractDescription(content: string): string {
    // Find first sentence ending
    const sentenceEndMatch = content.match(/[.!?]/);
    if (sentenceEndMatch && sentenceEndMatch.index !== undefined) {
      const rest = content.substring(sentenceEndMatch.index + 1).trim();
      return rest || content; // If no rest, return full content
    }
    
    // No sentence delimiter found, return full content
    return content;
  }

  /**
   * Extract all hashtags from text
   */
  private extractTags(text: string): string[] {
    const tagRegex = /#(\w+)/g;
    const tags: string[] = [];
    let match;
    
    while ((match = tagRegex.exec(text)) !== null) {
      tags.push(match[1].toLowerCase());
    }
    
    return [...new Set(tags)]; // Remove duplicates
  }

  /**
   * Build Ronin context for chat
   */
  private async buildRoninContext(): Promise<{
    agents: Array<{ name: string; description?: string }>;
    plugins: string[];
    routes: Array<{ path: string; type: string }>;
    architecture: string;
  }> {
    const agents: Array<{ name: string; description?: string }> = [];
    const plugins: string[] = [];
    const routes: Array<{ path: string; type: string }> = [];

    try {
      // Discover agents from both directories
      const externalAgentDir = ensureDefaultExternalAgentDir();
      const localAgentDir = ensureDefaultAgentDir();
      
      // Try external directory first (~/.ronin/agents)
      try {
        const externalFiles = await readdir(externalAgentDir);
        for (const file of externalFiles) {
          if (file.endsWith(".ts") || file.endsWith(".js")) {
            const name = file.replace(/\.(ts|js)$/, "");
            let description: string | undefined;
            try {
              const content = await readFile(join(externalAgentDir, file), "utf-8");
              // Try to extract description from JSDoc or comments
              const descMatch = content.match(/\/\*\*[\s\S]*?\*\//) || 
                               content.match(/\/\/.*description.*/i) ||
                               content.match(/export default class \w+ extends BaseAgent[\s\S]{0,500}/);
              if (descMatch) {
                description = descMatch[0].substring(0, 200).replace(/\n/g, " ");
              }
            } catch {
              // Ignore read errors
            }
            agents.push({ name, description });
          }
        }
      } catch {
        // External directory might not exist
      }

      // Also check local agents directory
      try {
        const localFiles = await readdir(localAgentDir);
        for (const file of localFiles) {
          if (file.endsWith(".ts") || file.endsWith(".js")) {
            const name = file.replace(/\.(ts|js)$/, "");
            // Avoid duplicates
            if (!agents.find(a => a.name === name)) {
              agents.push({ name });
            }
          }
        }
      } catch {
        // Local directory might not exist
      }
    } catch (error) {
      console.warn("[intent-ingress] Error discovering agents:", error);
    }

    // Get plugins
    plugins.push(...this.api.plugins.list());

    // Get routes
    const allRoutes = this.api.http.getAllRoutes();
    for (const path of allRoutes.keys()) {
      routes.push({ path, type: "http" });
    }

    return {
      agents,
      plugins,
      routes,
      architecture: this.getArchitectureDescription(),
    };
  }

  /**
   * Get Ronin architecture description
   */
  private getArchitectureDescription(): string {
    return `Ronin is a Bun-based AI agent framework for TypeScript/JavaScript.

Key Components:
- Agents: Extend BaseAgent, implement execute(), auto-loaded from ~/.ronin/agents/
- Plugins: Tools in ~/.ronin/plugins/, accessed via api.plugins.call()
- Routes: Agents register HTTP routes via api.http.registerRoute()
- Events: Inter-agent communication via api.events.emit/on()
- Memory: Persistent storage via api.memory
- AI: Ollama integration via api.ai (complete, chat, callTools)
- Tasks: Plans can be created via #ronin #plan or @ronin commands

Agent Structure:
- Static schedule (cron) for scheduled execution
- Static watch (file patterns) for file watching
- Static webhook (path) for HTTP webhooks
- execute() method contains main logic
- Optional onFileChange() and onWebhook() handlers

You can help users:
- Create agents with @ronin create-agent
- Fix bugs with @ronin fix
- Update agents with @ronin update
- Create tasks with @ronin task
- Answer questions about Ronin's architecture`;
  }

  /**
   * Build system prompt with Ronin context
   */
  private buildSystemPrompt(context: {
    agents: Array<{ name: string; description?: string }>;
    plugins: string[];
    routes: Array<{ path: string; type: string }>;
    architecture: string;
  }): string {
    const agentList = context.agents.length > 0 
      ? context.agents.map((a) => `  - ${a.name}${a.description ? `: ${a.description.substring(0, 100)}` : ""}`).join("\n")
      : "  (No agents found)";
    
    const pluginList = context.plugins.length > 0 
      ? context.plugins.map(p => `  - ${p}`).join("\n")
      : "  (No plugins found)";

    return `You are Ronin, an AI assistant for the Ronin agent framework. You help users create agents, understand the system, and manage their automation tasks.

${context.architecture}

Available Agents:
${agentList}

Available Plugins:
${pluginList}

IMPORTANT - How to Help Users Create Things:
When a user wants to create an agent, fix a bug, or make a task, you CANNOT write code or bash commands. You must guide them to use the proper commands:

1. **Creating Agents**: If user says "create an agent that..."
   → Reply: "I'll create that agent for you! Use:
   
   @ronin create-agent [Name] that [description]
   
   Example: @ronin create-agent DiskMonitor that checks disk space"

2. **Fixing Bugs**: If user says "fix the auth bug"
   → Reply: "I can help fix that! Use:
   
   @ronin fix [description]
   
   Example: @ronin fix auth middleware error handling"

3. **Creating Tasks**: If user says "create a task"
   → Reply: "Creating a task now! Use:
   
   @ronin task [description]
   
   Or: #plan [description]"

4. **Web Browsing**: Users can browse websites by saying:
   - "visit https://example.com"
   - "check localhost:3000/status"
   - "view the page at /api/status"

5. **Safe Shell Commands**: Users can run safe commands by saying:
   - "run command: ls -la"
   - "execute: git status"
   - Wrap in backticks: \`pwd\`
   
   Allowed: ls, pwd, cat, echo, ps, df, git status/log, etc.
   
6. **NEVER DO THIS**:
   - Do NOT write bash commands like "ronin create-agent ..."
   - Do NOT write code blocks with commands
   - Do NOT say "enter this in terminal"
   - Simply provide the exact @ronin command to type

7. **General Chat**: For questions about how things work
   → Answer normally, no commands needed

Guidelines:
- Be helpful and concise
- ALWAYS guide users to use @ronin commands when they want to CREATE something
- Explain what will happen after they use the command (task created, agent built, etc.)
- Answer questions about Ronin's architecture and capabilities
- Be friendly and professional
- DO NOT attempt to write code or create files in chat mode - that's what the commands are for`;
  }

  /**
   * Clean up old chat sessions
   */
  private startSessionCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [sessionId, session] of this.chatSessions) {
        if (now - session.lastActivity > this.sessionTimeout) {
          this.chatSessions.delete(sessionId);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        console.log(`[intent-ingress] Cleaned up ${cleaned} inactive chat sessions`);
      }
    }, 5 * 60 * 1000); // Run every 5 minutes
  }

  /**
   * Start cleanup interval for expired approval requests
   */
  private startApprovalCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [planId, approval] of this.pendingApprovals) {
        if (now - approval.createdAt > this.approvalTimeout) {
          this.pendingApprovals.delete(planId);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        console.log(`[intent-ingress] Cleaned up ${cleaned} expired approval requests`);
      }
    }, 60 * 60 * 1000); // Run every hour
  }

  /**
   * Handle approval response from user
   */
  private async handleApprovalResponse(
    planId: string,
    approved: boolean,
    sourceChannel: string
  ): Promise<void> {
    const approval = this.pendingApprovals.get(planId);
    if (!approval) {
      console.log(`[intent-ingress] No pending approval found for ${planId}`);
      return;
    }

    const [sourceType, channelId] = sourceChannel.split(":");

    if (approved) {
      console.log(`[intent-ingress] User approved task ${planId}, emitting PlanApproved`);
      
      // Emit PlanApproved event
      this.api.events.emit("PlanApproved", {
        id: planId,
        title: approval.title,
        description: approval.description,
        tags: approval.tags,
        source: approval.source,
        sourceChannel: approval.sourceChannel,
        sourceUser: approval.sourceUser,
        approvedAt: Date.now(),
      }, "intent-ingress");

      // Send confirmation
      const message = `✅ <b>Task Approved</b>\n\n` +
        `<b>Title:</b> ${approval.title}\n` +
        `<b>Status:</b> Moving to Doing → Starting execution...`;

      try {
        if (sourceType === "telegram" && this.botId) {
          await this.api.telegram.sendMessage(
            this.botId,
            channelId,
            message,
            { parseMode: "HTML" }
          );
        }
      } catch (err) {
        console.error(`[intent-ingress] Failed to send approval confirmation:`, err);
      }
    } else {
      console.log(`[intent-ingress] User declined task ${planId}`);
      
      // Send acknowledgment that task stays in To Do
      const message = `📋 <b>Task Staying in Backlog</b>\n\n` +
        `<b>Title:</b> ${approval.title}\n` +
        `<b>Status:</b> Remaining in To Do column\n` +
        `You can manually move it to Doing later via the Kanban board.`;

      try {
        if (sourceType === "telegram" && this.botId) {
          await this.api.telegram.sendMessage(
            this.botId,
            channelId,
            message,
            { parseMode: "HTML" }
          );
        }
      } catch (err) {
        console.error(`[intent-ingress] Failed to send decline confirmation:`, err);
      }
    }

    // Remove from pending approvals
    this.pendingApprovals.delete(planId);
  }

  /**
   * Check if user is authorized for a platform
   */
  private async checkAuthorization(platform: string, userIdOrCandidates: string | string[]): Promise<boolean> {
    try {
      const candidates = Array.isArray(userIdOrCandidates) ? userIdOrCandidates : [userIdOrCandidates];
      const compactCandidates = candidates.filter(Boolean);
      if (compactCandidates.length === 0) {
        return false;
      }

      // Try to get auth service via plugin
      for (const candidate of compactCandidates) {
        const authService = await this.api.plugins.call("auth", "isAuthorized", platform, candidate);
        if (typeof authService === "boolean" && authService) {
          return true;
        }
      }
      
      // Fallback: Check auth file directly
      const authFile = join(homedir(), ".ronin", "auth.json");
      try {
        await access(authFile);
        const content = await readFile(authFile, "utf-8");
        const data = JSON.parse(content);
        const users = data[platform];
        
        if (!users || users.length === 0) {
          // No users configured - allow setup mode
          console.log(`[intent-ingress] Setup mode: No users configured for ${platform}`);
          return true;
        }

        return compactCandidates.some((candidate) => users.includes(candidate));
      } catch {
        // No auth file - allow setup mode
        return true;
      }
    } catch (error) {
      console.error(`[intent-ingress] Error checking authorization:`, error);
      // Fail secure: deny access on error
      return false;
    }
  }

  async execute(): Promise<void> {
    // This agent is event-driven
    console.log("[intent-ingress] Execute called (event-driven agent)");
  }
}
