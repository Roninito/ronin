import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

interface RSSItem {
  id: number;
  feed_url: string;
  link: string;
  title: string;
  published_at: number;
  summary: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * RSS-to-Telegram agent that queries the rss-feed agent for new items
 * and sends them to a Telegram channel
 */
export default class RSSToTelegramAgent extends BaseAgent {
  // Schedule: Run every 15 minutes
  static schedule = "*/15 * * * *";

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    console.log("[rss-to-telegram] Starting RSS to Telegram sync...");

    // Check if Telegram plugin is available
    if (!this.api.telegram) {
      console.error("[rss-to-telegram] Telegram plugin not available");
      return;
    }

    // Get Telegram bot token and chat ID from memory or env
    const token = (process.env.TELEGRAM_BOT_TOKEN ||
      (await this.api.memory.retrieve("telegram_bot_token"))) as string | undefined;

    if (!token) {
      console.error("[rss-to-telegram] Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN env var or store in memory as 'telegram_bot_token'");
      return;
    }

    const chatId = (process.env.TELEGRAM_CHAT_ID ||
      (await this.api.memory.retrieve("telegram_chat_id"))) as string | number | undefined;

    if (!chatId) {
      console.error("[rss-to-telegram] Telegram chat ID not configured. Set TELEGRAM_CHAT_ID env var or store in memory as 'telegram_chat_id'");
      return;
    }

    // Initialize bot if not already initialized
    let botId = (await this.api.memory.retrieve("telegram_bot_id")) as string | undefined;
    if (!botId) {
      try {
        botId = await this.api.telegram.initBot(token);
        await this.api.memory.store("telegram_bot_id", botId);
        console.log(`[rss-to-telegram] Initialized Telegram bot: ${botId}`);
      } catch (error) {
        console.error(`[rss-to-telegram] Failed to initialize bot:`, error);
        return;
      }
    }

    // Get last checked timestamp
    const lastChecked = ((await this.api.memory.retrieve("rss_last_checked")) as number) || 0;
    const now = Date.now();

    try {
      // Query rss-feed agent for new items
      console.log(`[rss-to-telegram] Querying rss-feed agent for items since ${new Date(lastChecked).toISOString()}...`);
      
      const items = (await this.api.events.query("rss-feed", "get-new-items", {
        since: lastChecked,
      })) as RSSItem[];

      if (!Array.isArray(items)) {
        console.error("[rss-to-telegram] Invalid response from rss-feed agent");
        return;
      }

      console.log(`[rss-to-telegram] Found ${items.length} new item(s)`);

      if (items.length === 0) {
        console.log("[rss-to-telegram] No new items to send");
        return;
      }

      // Send each item to Telegram
      let sentCount = 0;
      let errorCount = 0;

      for (const item of items) {
        try {
          // Format message
          const message = this.formatMessage(item);

          // Send to Telegram (with rate limiting awareness)
          await this.api.telegram.sendMessage(botId!, chatId, message, {
            parseMode: "HTML",
          });

          sentCount++;
          console.log(`[rss-to-telegram] Sent: ${item.title.substring(0, 50)}...`);

          // Small delay to respect rate limits (~30 req/sec = ~33ms between requests)
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (error) {
          errorCount++;
          console.error(`[rss-to-telegram] Failed to send item ${item.id}:`, error);
          
          // If rate limited, wait longer before continuing
          if (error instanceof Error && error.message.includes("rate")) {
            console.log("[rss-to-telegram] Rate limited, waiting 2 seconds...");
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }

      // Update last checked timestamp to now
      if (sentCount > 0) {
        await this.api.memory.store("rss_last_checked", now);
        console.log(`[rss-to-telegram] ✅ Sent ${sentCount} item(s), ${errorCount} error(s)`);
      }
    } catch (error) {
      console.error("[rss-to-telegram] Query failed:", error);
      
      // If query timeout, don't update last checked timestamp
      if (error instanceof Error && error.message.includes("timeout")) {
        console.log("[rss-to-telegram] Query timed out, will retry on next run");
      }
    }
  }

  /**
   * Format RSS item as HTML message for Telegram
   */
  private formatMessage(item: RSSItem): string {
    const title = this.escapeHtml(item.title);
    const link = item.link;
    const summary = item.summary ? this.escapeHtml(item.summary.substring(0, 500)) : "";
    const date = new Date(item.published_at).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    let message = `<b>${title}</b>\n\n`;
    
    if (summary) {
      message += `${summary}\n\n`;
    }
    
    message += `<a href="${link}">Read more →</a>\n`;
    message += `<i>${date}</i>`;

    return message;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }
}
