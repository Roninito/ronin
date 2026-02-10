import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

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

/**
 * Intent Ingress Agent
 * 
 * Processes incoming messages from various sources (Telegram, Discord, etc.)
 * and creates tasks/plans based on commands or hashtags.
 * 
 * Supported formats:
 * - @ronin create-agent AgentName that does X → Creates agent with #create tag
 * - @ronin task Description here → Creates task with #plan tag  
 * - #ronin #plan Description → Legacy format, creates plan
 * 
 * No state mutation - pure event emitter
 */
export default class IntentIngressAgent extends BaseAgent {
  private botId: string | null = null;
  private sourceChannels: Map<string, { type: string; id: string | number }> = new Map();

  constructor(api: AgentAPI) {
    super(api);
    this.initializeTelegram();
    this.initializeDiscord();
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
  } {
    const lowerText = text.toLowerCase();
    
    // Check for @ronin commands
    const roninMatch = text.match(/@ronin\s+(\w+)(?:-(\w+))?\s+(.+)/is);
    if (roninMatch) {
      const action = roninMatch[1].toLowerCase();
      const subAction = roninMatch[2]?.toLowerCase();
      const args = roninMatch[3].trim();
      
      if (action === "create" && subAction === "agent") {
        return { command: "create-agent", args, tags: ["create", "agent"] };
      }
      if (action === "task") {
        return { command: "task", args, tags: ["plan"] };
      }
      if (action === "fix") {
        return { command: "fix", args, tags: ["create", "fix"] };
      }
      if (action === "update") {
        return { command: "update", args, tags: ["create", "update"] };
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
      return { command: "plan", args: cleanContent, tags };
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
      return { command: "create", args: cleanContent, tags };
    }

    return { command: null, args: text, tags: [] };
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
    if (!parsed.command) {
      return; // Not a command we handle
    }

    console.log(`[intent-ingress] Telegram ${parsed.command}:`, parsed.args.substring(0, 50));

    const sourceChannel = `telegram:${msg.chat.id}`;
    const sourceUser = msg.from?.username || msg.from?.id?.toString() || "unknown";

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
    if (!parsed.command) {
      return;
    }

    console.log(`[intent-ingress] Discord ${parsed.command}:`, parsed.args.substring(0, 50));

    const sourceChannel = `discord:${msg.channelId}`;
    const sourceUser = msg.author.username;

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

  async execute(): Promise<void> {
    // This agent is event-driven
  }
}
