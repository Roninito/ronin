import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

interface PlanProposedPayload {
  id: string;
  title: string;
  description: string;
  tags: string[];
  source: "telegram" | "cli" | "webhook";
  proposedAt: number;
  rawContent: string;
}

/**
 * Intent Ingress Agent
 * 
 * Listens for Telegram messages with #ronin #plan tags
 * Parses the content and emits PlanProposed events
 * 
 * No state mutation - pure event emitter
 */
export default class IntentIngressAgent extends BaseAgent {
  private botId: string | null = null;
  private chatId: string | number | null = null;

  constructor(api: AgentAPI) {
    super(api);
    this.initializeBot();
  }

  /**
   * Initialize Telegram bot and start listening
   */
  private async initializeBot(): Promise<void> {
    try {
      // Get bot token from environment or memory
      const botToken = process.env.TELEGRAM_BOT_TOKEN || 
        await this.api.memory.retrieve("telegram_bot_token");
      
      if (!botToken || typeof botToken !== "string") {
        console.log("[intent-ingress] No Telegram bot token configured");
        console.log("[intent-ingress] Set TELEGRAM_BOT_TOKEN or use memory store");
        return;
      }

      // Initialize bot
      this.botId = await this.api.telegram.initBot(botToken);
      console.log("[intent-ingress] Telegram bot initialized");

      // Listen for messages
      this.api.telegram.onMessage(this.botId, (msg) => {
        this.handleTelegramMessage(msg);
      });

      console.log("[intent-ingress] Listening for #ronin #plan messages...");
    } catch (error) {
      console.error("[intent-ingress] Failed to initialize bot:", error);
    }
  }

  /**
   * Handle incoming Telegram messages
   */
  private handleTelegramMessage(msg: { 
    text?: string; 
    chat: { id: number }; 
    message_id: number;
    from?: { username?: string; first_name?: string };
  }): void {
    const text = msg.text || "";
    
    // Check for required tags
    const hasRoninTag = text.toLowerCase().includes("#ronin");
    const hasPlanTag = text.toLowerCase().includes("#plan");
    
    if (!hasRoninTag || !hasPlanTag) {
      return; // Not a plan request
    }

    console.log("[intent-ingress] Received plan request:", text.substring(0, 50));

    // Parse the content (remove tags)
    const cleanContent = text
      .replace(/#ronin/gi, "")
      .replace(/#plan/gi, "")
      .trim();

    // Extract title (first line or first sentence)
    const title = this.extractTitle(cleanContent);
    
    // Extract tags
    const tags = this.extractTags(text);

    // Generate unique ID
    const id = `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Build payload
    const payload: PlanProposedPayload = {
      id,
      title,
      description: cleanContent,
      tags,
      source: "telegram",
      proposedAt: Date.now(),
      rawContent: text,
    };

    // Emit the event
    this.api.events.emit("PlanProposed", payload, "intent-ingress");
    console.log(`[intent-ingress] Emitted PlanProposed: ${id}`);

    // Send acknowledgment
    if (this.botId) {
      this.api.telegram.sendMessage(
        this.botId,
        msg.chat.id,
        `📋 Plan received: "${title}"\nID: ${id}\nStatus: Proposed`,
        { parseMode: "HTML" }
      ).catch((err) => {
        console.error("[intent-ingress] Failed to send acknowledgment:", err);
      });
    }
  }

  /**
   * Extract title from content
   */
  private extractTitle(content: string): string {
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
    // This agent is event-driven, execute() can be empty
    // Bot is initialized in constructor
  }
}
