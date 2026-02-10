import { BaseAgent } from "/Users/ronin/Desktop/Bun Apps/ronin/src/agent/index.js";
import type { AgentAPI } from "/Users/ronin/Desktop/Bun Apps/ronin/src/types/index.js";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
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
export default class IntentIngressAgent extends BaseAgent {
  private botId: string | null = null;
  private sourceChannels: Map<string, { type: string; id: string | number }> = new Map();
  private chatSessions: Map<string, ChatSession> = new Map();
  private model: string;
  private maxChatHistory = 20; // Keep last 20 messages per session
  private sessionTimeout = 30 * 60 * 1000; // 30 minutes

  constructor(api: AgentAPI) {
    super(api);
    this.model = this.api.config.getAI().ollamaModel || "qwen3:4b";
    this.initializeTelegram();
    this.initializeDiscord();
    this.startSessionCleanup();
  }

  /**
   * Initialize Telegram bot
   */
  private async initializeTelegram(): Promise<void> {
    try {
      const configTelegram = this.api.config.getTelegram();
      const botToken = configTelegram.botToken || 
        process.env.TELEGRAM_BOT_TOKEN || 
        await this.api.memory.retrieve("telegram_bot_token");
      
      if (!botToken || typeof botToken !== "string") {
        console.log("[intent-ingress] Telegram not configured");
        return;
      }

      this.botId = await this.api.telegram.initBot(botToken);
      console.log("[intent-ingress] Telegram bot initialized");

      this.api.telegram.onMessage(this.botId, (msg) => {
        this.handleTelegramMessage(msg);
      });

      console.log("[intent-ingress] Listening for Telegram commands...");
    } catch (error) {
      console.error("[intent-ingress] Failed to initialize Telegram:", error);
    }
  }

  /**
   * Initialize Discord bot (if configured)
   */
  private async initializeDiscord(): Promise<void> {
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

      const botId = await this.api.discord.initBot(botToken);
      console.log("[intent-ingress] Discord bot initialized");

      this.api.discord.onMessage(botId, (msg) => {
        this.handleDiscordMessage(msg, botId);
      });

      console.log("[intent-ingress] Listening for Discord commands...");
    } catch (error) {
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

    // Check for legacy hashtag format
    const hasRoninTag = lowerText.includes("#ronin");
    const hasPlanTag = lowerText.includes("#plan");
    
    if (hasRoninTag && hasPlanTag) {
      const cleanContent = text
        .replace(/#ronin/gi, "")
        .replace(/#plan/gi, "")
        .trim();
      const tags = this.extractTags(text);
      return { command: "plan", args: cleanContent, tags, isChat: false };
    }

    // Check for #create or #build tags (direct execution)
    const hasCreateTag = lowerText.includes("#create");
    const hasBuildTag = lowerText.includes("#build");
    
    if (hasRoninTag && (hasCreateTag || hasBuildTag)) {
      const cleanContent = text
        .replace(/#ronin/gi, "")
        .replace(/#create/gi, "")
        .replace(/#build/gi, "")
        .trim();
      const tags = this.extractTags(text);
      return { command: "create", args: cleanContent, tags, isChat: false };
    }

    // Default to chat mode for any message that doesn't match a command
    return { command: null, args: text, tags: [], isChat: true };
  }

  /**
   * Handle Telegram messages
   */
  private handleTelegramMessage(msg: { 
    text?: string; 
    chat: { id: number }; 
    message_id: number;
    from?: { username?: string; first_name?: string; id: number };
  }): void {
    const text = msg.text || "";
    
    const parsed = this.parseCommand(text);
    
    const sourceChannel = `telegram:${msg.chat.id}`;
    const sourceUser = msg.from?.username || msg.from?.id?.toString() || "unknown";

    if (parsed.isChat || !parsed.command) {
      // Handle as conversational chat
      this.handleChatMessage({
        text: parsed.args,
        source: "telegram",
        sourceChannel,
        sourceUser,
        replyCallback: async (response: string) => {
          if (this.botId) {
            await this.api.telegram.sendMessage(this.botId, msg.chat.id, response, { parseMode: "HTML" });
          }
        },
      });
      return;
    }

    // Handle as command
    console.log(`[intent-ingress] Telegram ${parsed.command}:`, parsed.args.substring(0, 50));

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
   * Handle conversational chat message
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

      const assistantContent = response.content || "I'm not sure how to respond to that.";

      // Add assistant response to session
      session.messages.push({
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
      });

      // Send reply
      await params.replyCallback(assistantContent);

      console.log(`[intent-ingress] Replied to ${params.sourceUser}`);
    } catch (error) {
      console.error("[intent-ingress] Chat error:", error);
      await params.replyCallback("Sorry, I encountered an error processing your message.");
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
    // Generate unique ID
    const id = `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Extract title from args
    const title = this.extractTitle(params.args);

    // Build payload
    const payload: PlanProposedPayload = {
      id,
      title,
      description: params.args,
      tags: params.tags,
      source: params.source,
      sourceChannel: params.sourceChannel,
      sourceUser: params.sourceUser,
      proposedAt: Date.now(),
      rawContent: params.rawContent,
      command: params.command,
    };

    // Emit the event
    this.api.events.emit("PlanProposed", payload, "intent-ingress");
    console.log(`[intent-ingress] Emitted PlanProposed: ${id} (${params.command})`);

    // Send acknowledgment
    this.sendAcknowledgment(params.source, params.sourceChannel, params.command, title, id);
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

    const message = `${emoji} ${command.toUpperCase()} received: "${title}"\nID: <code>${id}</code>\nStatus: Proposed → To Do`;

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
        console.log(`[intent-ingress] Would send Discord ack: ${message}`);
      }
    } catch (err) {
      console.error(`[intent-ingress] Failed to send acknowledgment to ${source}:`, err);
    }
  }

  /**
   * Extract title from content
   */
  private extractTitle(content: string): string {
    // For create-agent commands, extract agent name
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

    // First sentence
    const firstSentence = content.split(/[.!?]/)[0].trim();
    if (firstSentence.length > 0 && firstSentence.length < 100) {
      return firstSentence;
    }

    // Truncated
    return content.substring(0, 100).trim() + (content.length > 100 ? "..." : "");
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

Guidelines:
- Be helpful and concise
- If users want to create agents, suggest using @ronin create-agent
- If they want to fix bugs, suggest @ronin fix
- Answer questions about Ronin's architecture and capabilities
- Be friendly and professional`;
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

  async execute(): Promise<void> {
    // This agent is event-driven
  }
}
