import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { join } from "path";
import { homedir } from "os";
import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import * as cheerio from "cheerio";
import { kiosaTheme } from "../src/utils/theme.js";
import { getKiosaTopbarHTML, getKiosaFooterHTML, getKiosaAccentForPath, getKiosaStylesheetLink } from "../src/utils/kiosa.js";

interface RSSItem {
  /** Stable id for dedup: the feed's <guid>/<id>, falling back to the item's link. */
  id: string;
  feed_url: string;
  link: string;
  title: string;
  published_at: number;
  summary: string | null;
  created_at: number;
  updated_at: number;
}

/** Max seen-item ids retained per feed (bounds memory storage growth over time). */
const MAX_SEEN_IDS_PER_FEED = 300;
/** Cap on items considered per feed per run, applied after sorting newest-first. */
const MAX_ITEMS_PER_FEED_PER_RUN = 25;

/**
 * RSS-to-Telegram agent that queries the rss-feed agent for new items
 * and sends them to a Telegram channel
 */
export default class RSSToTelegramAgent extends BaseDuty {
  // Schedule: Run every 15 minutes
  static schedule = "0 */3 * * *";

  constructor(api: DutyAPI) {
    super(api);
    this.registerRoutes();
  }

  /**
   * Get the config file path
   */
  private getConfigPath(): string {
    const configDir = join(homedir(), ".ronin");
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    return join(configDir, "config.json");
  }

  /**
   * Load configuration from file
   */
  private async loadConfig(): Promise<Record<string, any>> {
    const configPath = this.getConfigPath();
    if (existsSync(configPath)) {
      try {
        const content = await readFile(configPath, "utf-8");
        return JSON.parse(content);
      } catch (error) {
        console.error("[rss-to-telegram] Failed to load config:", error);
        return {};
      }
    }
    return {};
  }

  /**
   * Save configuration to file
   */
  private async saveConfig(config: Record<string, any>): Promise<void> {
    const configPath = this.getConfigPath();
    try {
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
    } catch (error) {
      console.error("[rss-to-telegram] Failed to save config:", error);
      throw error;
    }
  }

  /**
   * Get Telegram bot token from centralized config, env, or memory (in that order)
   */
  private async getBotToken(): Promise<string | undefined> {
    // Check centralized config service first
    const configTelegram = this.api.config.getTelegram();
    if (configTelegram.botToken) {
      return configTelegram.botToken;
    }

    // Check environment variable
    if (process.env.TELEGRAM_BOT_TOKEN) {
      return process.env.TELEGRAM_BOT_TOKEN;
    }

    // Legacy: Check old config format for backward compatibility
    try {
      const config = await this.loadConfig();
      if (config.telegramBotToken && typeof config.telegramBotToken === "string") {
        return config.telegramBotToken;
      }
    } catch (error) {
      // Continue to memory check
    }

    // Check memory (fallback)
    return (await this.api.memory.retrieve("telegram_bot_token")) as string | undefined;
  }

  /**
   * Get Telegram chat ID from centralized config, env, or memory (in that order)
   */
  private async getChatId(): Promise<string | number | undefined> {
    // Check centralized config service first
    const configTelegram = this.api.config.getTelegram();
    if (configTelegram.chatId) {
      return configTelegram.chatId;
    }

    // Check environment variable
    if (process.env.TELEGRAM_CHAT_ID) {
      return process.env.TELEGRAM_CHAT_ID;
    }

    // Legacy: Check old config format for backward compatibility
    try {
      const config = await this.loadConfig();
      if (config.telegramChatId !== undefined) {
        return config.telegramChatId;
      }
    } catch (error) {
      // Continue to memory check
    }

    // Check memory (fallback)
    return (await this.api.memory.retrieve("telegram_chat_id")) as string | number | undefined;
  }

  /**
   * Get the list of configured RSS/Atom feed URLs.
   */
  private async getFeeds(): Promise<string[]> {
    const feeds = await this.api.memory.retrieve("rss_feeds");
    return Array.isArray(feeds) ? (feeds as string[]) : [];
  }

  /**
   * Add a feed URL (no-op if already present).
   */
  private async addFeed(url: string): Promise<string[]> {
    const feeds = await this.getFeeds();
    if (!feeds.includes(url)) {
      feeds.push(url);
      await this.api.memory.store("rss_feeds", feeds);
    }
    return feeds;
  }

  /**
   * Remove a feed URL and its seen-items history.
   */
  private async removeFeed(url: string): Promise<string[]> {
    const feeds = (await this.getFeeds()).filter((f) => f !== url);
    await this.api.memory.store("rss_feeds", feeds);
    await this.api.memory.forget(this.seenIdsKey(url));
    return feeds;
  }

  private seenIdsKey(feedUrl: string): string {
    return `rss_seen:${feedUrl}`;
  }

  /**
   * Ids of items already sent (or, for a brand-new feed, already present at the
   * time it was added) for this feed, most-recent-first.
   */
  private async getSeenIds(feedUrl: string): Promise<string[] | null> {
    const seen = await this.api.memory.retrieve(this.seenIdsKey(feedUrl));
    return Array.isArray(seen) ? (seen as string[]) : null;
  }

  /**
   * Record ids as seen, keeping only the most recent MAX_SEEN_IDS_PER_FEED.
   */
  private async markSeen(feedUrl: string, ids: string[], existing: string[]): Promise<void> {
    const merged = [...ids, ...existing].slice(0, MAX_SEEN_IDS_PER_FEED);
    await this.api.memory.store(this.seenIdsKey(feedUrl), merged);
  }

  /**
   * Mark a single item as seen after it's actually been delivered. Read-modify-write
   * per item is fine here — real-world run volume is a handful of items, not thousands.
   */
  private async markItemSeen(item: RSSItem): Promise<void> {
    const existing = (await this.getSeenIds(item.feed_url)) ?? [];
    await this.markSeen(item.feed_url, [item.id], existing);
  }

  /**
   * Fetch and parse one feed (RSS 2.0 or Atom), newest first. Does not touch
   * seen-item state — pure fetch+parse so it can be tested/reused independently.
   */
  private async fetchFeedItems(feedUrl: string): Promise<RSSItem[]> {
    const res = await fetch(feedUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      throw new Error(`Feed returned HTTP ${res.status}`);
    }
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });
    const now = Date.now();
    const isAtom = $("feed").length > 0;
    const entrySelector = isAtom ? "entry" : "item";

    const items: RSSItem[] = [];
    $(entrySelector).each((_, el) => {
      const $el = $(el);
      const title = $el.find("title").first().text().trim() || "(untitled)";
      const link = isAtom
        ? ($el.find("link").first().attr("href") || $el.find("link").first().text()).trim()
        : $el.find("link").first().text().trim();
      const guid = (isAtom ? $el.find("id").first().text() : $el.find("guid").first().text()).trim();
      const dateStr = isAtom
        ? ($el.find("published").first().text() || $el.find("updated").first().text()).trim()
        : $el.find("pubDate").first().text().trim();
      const summary = (isAtom
        ? $el.find("summary").first().text() || $el.find("content").first().text()
        : $el.find("description").first().text()
      ).trim();

      const parsedDate = dateStr ? new Date(dateStr) : null;
      const published_at = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate.getTime() : now;
      const id = guid || link || `${feedUrl}#${title}`;
      if (!link && !guid) return; // no stable identity at all — skip rather than risk resending forever

      items.push({
        id,
        feed_url: feedUrl,
        link,
        title,
        published_at,
        summary: summary || null,
        created_at: now,
        updated_at: now,
      });
    });

    items.sort((a, b) => b.published_at - a.published_at);
    return items;
  }

  /**
   * Fetch every configured feed and return only items not seen before, newest
   * first. Does NOT mark returned items as seen — that only happens once an item
   * is actually delivered (see markItemSeen), so a Telegram-side failure gets
   * retried next run instead of being silently dropped. A feed seen for the
   * first time is the one exception: its current items are marked seen
   * immediately and none are returned — adding a feed shouldn't blast its
   * entire back-catalog to Telegram. One feed's failure is logged and skipped;
   * it never aborts the others.
   */
  private async collectNewItems(feeds: string[]): Promise<RSSItem[]> {
    const newItems: RSSItem[] = [];
    for (const feedUrl of feeds) {
      try {
        const items = await this.fetchFeedItems(feedUrl);
        const existingSeen = await this.getSeenIds(feedUrl);
        if (existingSeen === null) {
          // First time we've ever fetched this feed: baseline only, send nothing.
          await this.markSeen(feedUrl, items.map((i) => i.id), []);
          console.log(`[rss-to-telegram] New feed ${feedUrl}: recorded ${items.length} existing item(s) as baseline`);
          continue;
        }
        const seenSet = new Set(existingSeen);
        const fresh = items.filter((i) => !seenSet.has(i.id)).slice(0, MAX_ITEMS_PER_FEED_PER_RUN);
        newItems.push(...fresh);
      } catch (error) {
        console.error(`[rss-to-telegram] Failed to fetch feed ${feedUrl}:`, error instanceof Error ? error.message : error);
      }
    }
    newItems.sort((a, b) => a.published_at - b.published_at); // send oldest-first within the batch
    return newItems;
  }

  /**
   * Register HTTP routes for configuration UI
   */
  private registerRoutes(): void {
    const corsHeaders = this.getCorsHeaders();

    // GET /rss-to-telegram/ - HTML UI
    this.api.http.registerRoute("/rss-to-telegram/", async (req: Request) => {
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }
      return new Response(this.getHTML(), {
        headers: {
          "Content-Type": "text/html",
          ...corsHeaders,
        },
      });
    });

    // GET /rss-to-telegram/config - Get configuration status
    this.api.http.registerRoute("/rss-to-telegram/config", async (req: Request) => {
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      if (req.method === "GET") {
        try {
          const token = await this.getBotToken();
          const chatId = await this.getChatId();

          const botId = (await this.api.memory.retrieve("telegram_bot_id")) as string | undefined;

          let botInfo = null;
          if (botId && this.api.telegram) {
            try {
              botInfo = await this.api.telegram.getBotInfo(botId);
            } catch (error) {
              // Bot info not available or bot not initialized
            }
          }

          return Response.json({
            tokenConfigured: !!token,
            chatIdConfigured: !!chatId,
            botId: botId || null,
            botInfo: botInfo || null,
          }, { headers: corsHeaders });
        } catch (error) {
          return Response.json({
            error: error instanceof Error ? error.message : String(error),
          }, { status: 500, headers: corsHeaders });
        }
      }

      if (req.method === "POST") {
        try {
          const body = await req.json().catch(() => ({}));
          const { token, chatId } = body;

          if (!token || typeof token !== "string") {
            return Response.json({ error: "Missing or invalid token" }, { status: 400, headers: corsHeaders });
          }

          if (!chatId || (typeof chatId !== "string" && typeof chatId !== "number")) {
            return Response.json({ error: "Missing or invalid chatId" }, { status: 400, headers: corsHeaders });
          }

          // Check if Telegram plugin is available
          if (!this.api.telegram) {
            return Response.json({ error: "Telegram plugin not available" }, { status: 500, headers: corsHeaders });
          }

          // Get existing token and bot ID
          const oldToken = await this.getBotToken();
          const existingBotId = (await this.api.memory.retrieve("telegram_bot_id")) as string | undefined;

          let botId: string;
          let botInfo = null;

          // Check if token has changed
          const tokenChanged = !oldToken || oldToken !== token;

          if (!tokenChanged && existingBotId) {
            // Token hasn't changed and we have an existing bot ID - reuse it
            botId = existingBotId;
            try {
              // Validate that the existing bot is still valid
              botInfo = await this.api.telegram.getBotInfo(botId);
            } catch (error) {
              // Existing bot is invalid, need to reinitialize
              console.log("[rss-to-telegram] Existing bot invalid, reinitializing...");
              try {
                botId = await this.api.telegram.initBot(token);
                botInfo = await this.api.telegram.getBotInfo(botId).catch(() => null);
                await this.api.memory.store("telegram_bot_id", botId);
              } catch (initError) {
                return Response.json({
                  error: `Invalid bot token: ${initError instanceof Error ? initError.message : String(initError)}`,
                }, { status: 400, headers: corsHeaders });
              }
            }
          } else {
            // Token changed or no existing bot - initialize new bot
            try {
              botId = await this.api.telegram.initBot(token);
              try {
                botInfo = await this.api.telegram.getBotInfo(botId);
              } catch (error) {
                // Bot info not available, but bot is initialized
              }
              await this.api.memory.store("telegram_bot_id", botId);
            } catch (error) {
              return Response.json({
                error: `Invalid bot token: ${error instanceof Error ? error.message : String(error)}`,
              }, { status: 400, headers: corsHeaders });
            }
          }

          // Store configuration in config file (persistent)
          try {
            const config = await this.loadConfig();
            config.telegramBotToken = token;
            config.telegramChatId = chatId;
            await this.saveConfig(config);
          } catch (error) {
            console.error("[rss-to-telegram] Failed to save to config file, falling back to memory:", error);
            // Fallback to memory if config file write fails
            await this.api.memory.store("telegram_bot_token", token);
            await this.api.memory.store("telegram_chat_id", chatId);
          }

          // Also store in memory for immediate access
          await this.api.memory.store("telegram_bot_token", token);
          await this.api.memory.store("telegram_chat_id", chatId);

          console.log(`[rss-to-telegram] Configuration updated and saved to config file. Bot: ${botInfo?.username || botId}`);

          return Response.json({
            ok: true,
            botId,
            botInfo: botInfo || null,
          }, { headers: corsHeaders });
        } catch (error) {
          return Response.json({
            error: error instanceof Error ? error.message : String(error),
          }, { status: 500, headers: corsHeaders });
        }
      }

      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    });

    // GET/POST/DELETE /rss-to-telegram/feeds - manage the list of RSS/Atom feed URLs
    this.api.http.registerRoute("/rss-to-telegram/feeds", async (req: Request) => {
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      if (req.method === "GET") {
        return Response.json({ feeds: await this.getFeeds() }, { headers: corsHeaders });
      }

      if (req.method === "POST") {
        try {
          const body = await req.json().catch(() => ({}));
          const url = typeof body?.url === "string" ? body.url.trim() : "";
          if (!url) {
            return Response.json({ error: "Missing url" }, { status: 400, headers: corsHeaders });
          }
          try {
            new URL(url);
          } catch {
            return Response.json({ error: "Invalid url" }, { status: 400, headers: corsHeaders });
          }
          const feeds = await this.addFeed(url);
          return Response.json({ ok: true, feeds }, { headers: corsHeaders });
        } catch (error) {
          return Response.json({
            error: error instanceof Error ? error.message : String(error),
          }, { status: 500, headers: corsHeaders });
        }
      }

      if (req.method === "DELETE") {
        try {
          const body = await req.json().catch(() => ({}));
          const url = typeof body?.url === "string" ? body.url.trim() : "";
          if (!url) {
            return Response.json({ error: "Missing url" }, { status: 400, headers: corsHeaders });
          }
          const feeds = await this.removeFeed(url);
          return Response.json({ ok: true, feeds }, { headers: corsHeaders });
        } catch (error) {
          return Response.json({
            error: error instanceof Error ? error.message : String(error),
          }, { status: 500, headers: corsHeaders });
        }
      }

      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    });
  }

  /**
   * Get CORS headers
   */
  private getCorsHeaders(): Record<string, string> {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }

  async execute(): Promise<void> {
    console.log("[rss-to-telegram] Starting RSS to Telegram sync...");

    // Check if Telegram plugin is available
    if (!this.api.telegram) {
      console.error("[rss-to-telegram] Telegram plugin not available");
      return;
    }

    // Get Telegram bot token and chat ID from config, memory, or env
    const token = await this.getBotToken();

    if (!token) {
      console.error("[rss-to-telegram] Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN env var, configure via /rss-to-telegram/ UI, or store in ~/.ronin/config.json");
      return;
    }

    const chatId = await this.getChatId();

    if (!chatId) {
      console.error("[rss-to-telegram] Telegram chat ID not configured. Set TELEGRAM_CHAT_ID env var or store in memory as 'telegram_chat_id'");
      return;
    }

    // Initialize bot if not already initialized, or validate existing bot
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
    } else {
      // Validate that the existing bot instance still exists
      try {
        await this.api.telegram.getBotInfo(botId);
      } catch (error) {
        // Bot instance doesn't exist or is invalid, reinitialize
        console.log(`[rss-to-telegram] Existing bot ${botId} is invalid, reinitializing...`);
        try {
          botId = await this.api.telegram.initBot(token);
          await this.api.memory.store("telegram_bot_id", botId);
          console.log(`[rss-to-telegram] Reinitialized Telegram bot: ${botId}`);
        } catch (initError) {
          console.error(`[rss-to-telegram] Failed to reinitialize bot:`, initError);
          return;
        }
      }
    }

    const feeds = await this.getFeeds();
    if (feeds.length === 0) {
      console.log("[rss-to-telegram] No feeds configured. Add one via the /rss-to-telegram/ UI.");
      return;
    }

    try {
      console.log(`[rss-to-telegram] Checking ${feeds.length} feed(s) for new items...`);
      const items = await this.collectNewItems(feeds);

      console.log(`[rss-to-telegram] Found ${items.length} new item(s)`);

      if (items.length === 0) {
        console.log("[rss-to-telegram] No new items to send");
        return;
      }

      // Send each item to Telegram
      let sentCount = 0;
      let errorCount = 0;

      let chatNotFound = false;

      for (const item of items) {
        // Skip remaining items if chat not found
        if (chatNotFound) {
          console.log(`[rss-to-telegram] Skipping item ${item.id}: chat not configured`);
          continue;
        }

        try {
          // Format message
          const message = this.formatMessage(item);

          // Send to Telegram (with rate limiting awareness)
          await this.api.telegram.sendMessage(botId!, chatId, message, {
            parseMode: "HTML",
          });

          sentCount++;
          await this.markItemSeen(item);
          console.log(`[rss-to-telegram] Sent: ${item.title.substring(0, 50)}...`);

          // Small delay to respect rate limits (~30 req/sec = ~33ms between requests)
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (error) {
          errorCount++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[rss-to-telegram] Failed to send item ${item.id}:`, error);
          
          // Handle specific error cases
          if (errorMsg.includes("chat not found")) {
            chatNotFound = true;
            console.error("[rss-to-telegram] ❌ Chat not found! Please check:");
            console.error("   1. TELEGRAM_CHAT_ID is set correctly");
            console.error("   2. The bot has been added to the chat/channel");
            console.error("   3. For channels, add bot as administrator");
            console.error(`   Current chat ID: ${chatId}`);
          }
          
          // If rate limited, wait longer before continuing
          if (errorMsg.includes("rate")) {
            console.log("[rss-to-telegram] Rate limited, waiting 2 seconds...");
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }

      if (sentCount > 0) {
        console.log(`[rss-to-telegram] ✅ Sent ${sentCount} item(s), ${errorCount} error(s)`);
      } else if (errorCount > 0) {
        console.log(`[rss-to-telegram] ${errorCount} item(s) failed to send — will retry next run`);
      }
    } catch (error) {
      console.error("[rss-to-telegram] Sync failed:", error);
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
    return text.replace(/[&<>"']/g, (m) => map[m]!); // m is always one of map's keys, per the regex
  }

  /**
   * Get HTML UI for configuration
   */
  private getHTML(): string {
    const accent = getKiosaAccentForPath("/rss-to-telegram/");
    const accentHex = kiosaTheme.colors.accent;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RSS to Telegram Configuration</title>
  ${getKiosaStylesheetLink(accent)}
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <style>

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: ${kiosaTheme.fonts.primary};
      background: ${kiosaTheme.colors.background};
      color: ${kiosaTheme.colors.textPrimary};
      min-height: 100vh;
      padding: 0;
      line-height: 1.6;
      font-size: 13px;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: ${kiosaTheme.spacing.lg};
    }

    .content {
      padding: 0;
    }

    .status-section,
    .form-section {
      background: ${kiosaTheme.colors.backgroundSecondary};
      border: 1px solid ${kiosaTheme.colors.border};
      border-radius: 3px;
      padding: ${kiosaTheme.spacing.lg};
      margin-bottom: ${kiosaTheme.spacing.xl};
    }

    .status-section h2,
    .form-section h2 {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: ${kiosaTheme.spacing.md};
      padding-bottom: ${kiosaTheme.spacing.sm};
      border-bottom: 1px solid ${kiosaTheme.colors.border};
      color: ${kiosaTheme.colors.textSecondary};
      font-family: ${kiosaTheme.fonts.primary};
    }

    .status-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid ${kiosaTheme.colors.border};
      font-family: ${kiosaTheme.fonts.mono};
      font-size: 11px;
    }

    .status-item:last-child {
      border-bottom: none;
    }

    .status-label {
      color: ${kiosaTheme.colors.textSecondary};
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .status-value {
      color: ${kiosaTheme.colors.textPrimary};
      font-size: 11px;
      font-family: ${kiosaTheme.fonts.mono};
    }

    .status-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 2px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-family: ${kiosaTheme.fonts.mono};
    }

    .status-badge.configured {
      background: color-mix(in srgb, ${kiosaTheme.colors.success} 15%, transparent);
      color: ${kiosaTheme.colors.success};
      border: 1px solid color-mix(in srgb, ${kiosaTheme.colors.success} 40%, transparent);
    }

    .status-badge.not-configured {
      background: color-mix(in srgb, ${kiosaTheme.colors.error} 15%, transparent);
      color: ${kiosaTheme.colors.error};
      border: 1px solid color-mix(in srgb, ${kiosaTheme.colors.error} 40%, transparent);
    }

    .form-group {
      margin-bottom: ${kiosaTheme.spacing.md};
    }

    .form-group label {
      display: block;
      color: ${kiosaTheme.colors.textSecondary};
      margin-bottom: ${kiosaTheme.spacing.xs};
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      font-family: ${kiosaTheme.fonts.mono};
    }

    .form-group .help-text {
      font-size: 11px;
      color: ${kiosaTheme.colors.textTertiary};
      margin-top: 0.25rem;
      font-family: ${kiosaTheme.fonts.mono};
    }

    .form-group input {
      width: 100%;
      padding: 6px 8px;
      font-size: 12px;
      background: ${kiosaTheme.colors.background};
      border: 1px solid ${kiosaTheme.colors.border};
      border-radius: 2px;
      color: ${kiosaTheme.colors.textPrimary};
      font-family: ${kiosaTheme.fonts.mono};
      transition: border-color 150ms ease, background 150ms ease;
    }

    .form-group input::placeholder {
      color: ${kiosaTheme.colors.textTertiary};
    }

    .form-group input:focus {
      outline: none;
      border-color: ${kiosaTheme.colors.borderHover};
      background: ${kiosaTheme.colors.backgroundTertiary};
    }

    .form-group .required {
      color: ${kiosaTheme.colors.error};
    }

    .button {
      padding: 4px 8px;
      background: ${kiosaTheme.colors.backgroundSecondary};
      border: 1px solid ${kiosaTheme.colors.border};
      color: ${kiosaTheme.colors.textSecondary};
      border-radius: 2px;
      cursor: pointer;
      font-size: 10px;
      font-family: ${kiosaTheme.fonts.mono};
      text-transform: uppercase;
      letter-spacing: 0.1em;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
    }

    .button:hover:not(:disabled) {
      background: ${kiosaTheme.colors.accent};
      border-color: ${kiosaTheme.colors.borderHover};
      color: ${kiosaTheme.colors.background};
    }

    .button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .button-primary {
      background: color-mix(in srgb, ${accentHex} 12%, transparent);
      border-color: color-mix(in srgb, ${accentHex} 45%, transparent);
      color: ${accentHex};
    }

    .button-primary:hover:not(:disabled) {
      background: ${kiosaTheme.colors.accentHover};
      color: ${kiosaTheme.colors.background};
    }

    .error {
      background: color-mix(in srgb, ${kiosaTheme.colors.error} 12%, transparent);
      border: 1px solid color-mix(in srgb, ${kiosaTheme.colors.error} 40%, transparent);
      color: ${kiosaTheme.colors.error};
      padding: ${kiosaTheme.spacing.md};
      border-radius: 2px;
      margin: ${kiosaTheme.spacing.md} 0;
      font-family: ${kiosaTheme.fonts.mono};
      font-size: 11px;
    }

    .success {
      background: color-mix(in srgb, ${kiosaTheme.colors.success} 12%, transparent);
      border: 1px solid color-mix(in srgb, ${kiosaTheme.colors.success} 40%, transparent);
      color: ${kiosaTheme.colors.success};
      padding: ${kiosaTheme.spacing.md};
      border-radius: 2px;
      margin: ${kiosaTheme.spacing.md} 0;
      font-family: ${kiosaTheme.fonts.mono};
      font-size: 11px;
    }

    .loading {
      text-align: center;
      padding: ${kiosaTheme.spacing.xl};
      color: ${kiosaTheme.colors.textTertiary};
      font-family: ${kiosaTheme.fonts.mono};
      font-size: 12px;
    }

    @media (max-width: 768px) {
      .container {
        padding: ${kiosaTheme.spacing.md};
      }
    }
  </style>
</head>
<body>
  <div id="root"></div>

  <script>
    const { useState, useEffect } = React;

    function App() {
      const [config, setConfig] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [success, setSuccess] = useState(null);
      const [formData, setFormData] = useState({
        token: '',
        chatId: ''
      });
      const [submitting, setSubmitting] = useState(false);
      const [feeds, setFeeds] = useState([]);
      const [newFeedUrl, setNewFeedUrl] = useState('');
      const [feedError, setFeedError] = useState(null);
      const [feedSubmitting, setFeedSubmitting] = useState(false);

      useEffect(() => {
        loadConfig();
        loadFeeds();
      }, []);

      const loadConfig = async () => {
        try {
          setLoading(true);
          setError(null);
          const res = await fetch('/rss-to-telegram/config');
          if (!res.ok) throw new Error('Failed to load configuration');
          const data = await res.json();
          setConfig(data);
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      };

      const loadFeeds = async () => {
        try {
          const res = await fetch('/rss-to-telegram/feeds');
          if (!res.ok) throw new Error('Failed to load feeds');
          const data = await res.json();
          setFeeds(data.feeds || []);
        } catch (err) {
          setFeedError(err.message);
        }
      };

      const handleAddFeed = async (e) => {
        e.preventDefault();
        const url = newFeedUrl.trim();
        if (!url) return;
        try {
          setFeedSubmitting(true);
          setFeedError(null);
          const res = await fetch('/rss-to-telegram/feeds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to add feed');
          setFeeds(data.feeds);
          setNewFeedUrl('');
        } catch (err) {
          setFeedError(err.message);
        } finally {
          setFeedSubmitting(false);
        }
      };

      const handleRemoveFeed = async (url) => {
        try {
          setFeedError(null);
          const res = await fetch('/rss-to-telegram/feeds', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to remove feed');
          setFeeds(data.feeds);
        } catch (err) {
          setFeedError(err.message);
        }
      };
      
      const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.token.trim() || !formData.chatId.trim()) {
          setError('Bot token and chat ID are required');
          return;
        }
        
        try {
          setSubmitting(true);
          setError(null);
          setSuccess(null);
          
          const res = await fetch('/rss-to-telegram/config', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              token: formData.token.trim(),
              chatId: formData.chatId.trim(),
            }),
          });
          
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to save configuration');
          }
          
          await loadConfig();
          setFormData({ token: '', chatId: '' });
          setSuccess('Configuration saved successfully!');
          setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
          setError(err.message);
        } finally {
          setSubmitting(false);
        }
      };
      
      if (loading) {
        return React.createElement('div', { className: 'container' },
          React.createElement('div', { className: 'loading' }, 'Loading configuration...')
        );
      }

      return React.createElement('div', null,
        ${getKiosaTopbarHTML({ title: "RONIN", subtitle: "RSS TO TELEGRAM", chips: [], tabs: [] })},

        React.createElement('div', { className: 'container' },
        React.createElement('div', { className: 'content' },
          React.createElement('div', { className: 'status-section' },
            React.createElement('h2', null, 'Current Status'),
            React.createElement('div', { className: 'status-item' },
              React.createElement('span', { className: 'status-label' }, 'Bot Token'),
              React.createElement('span', { className: 'status-value' },
                config?.tokenConfigured
                  ? React.createElement('span', { className: 'status-badge configured' }, 'Configured')
                  : React.createElement('span', { className: 'status-badge not-configured' }, 'Not Configured')
              )
            ),
            React.createElement('div', { className: 'status-item' },
              React.createElement('span', { className: 'status-label' }, 'Chat ID'),
              React.createElement('span', { className: 'status-value' },
                config?.chatIdConfigured
                  ? React.createElement('span', { className: 'status-badge configured' }, 'Configured')
                  : React.createElement('span', { className: 'status-badge not-configured' }, 'Not Configured')
              )
            ),
            config?.botInfo && React.createElement('div', { className: 'status-item' },
              React.createElement('span', { className: 'status-label' }, 'Bot Username'),
              React.createElement('span', { className: 'status-value' }, '@' + config.botInfo.username)
            )
          ),
          React.createElement('div', { className: 'form-section' },
            React.createElement('h2', null, 'Configuration'),
            error && React.createElement('div', { className: 'error' }, error),
            success && React.createElement('div', { className: 'success' }, success),
            React.createElement('form', { onSubmit: handleSubmit },
              React.createElement('div', { className: 'form-group' },
                React.createElement('label', null,
                  'Bot Token ',
                  React.createElement('span', { className: 'required' }, '*')
                ),
                React.createElement('input', {
                  type: 'password',
                  placeholder: '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz',
                  value: formData.token,
                  onChange: (e) => setFormData({ ...formData, token: e.target.value }),
                  required: true
                }),
                React.createElement('div', { className: 'help-text' },
                  'Get your bot token from @BotFather on Telegram'
                )
              ),
              React.createElement('div', { className: 'form-group' },
                React.createElement('label', null,
                  'Chat ID ',
                  React.createElement('span', { className: 'required' }, '*')
                ),
                React.createElement('input', {
                  type: 'text',
                  placeholder: '-1001234567890 or @channelname',
                  value: formData.chatId,
                  onChange: (e) => setFormData({ ...formData, chatId: e.target.value }),
                  required: true
                }),
                React.createElement('div', { className: 'help-text' },
                  'Channel ID (numeric) or username (e.g., @channelname)'
                )
              ),
              React.createElement('button', {
                type: 'submit',
                className: 'button button-primary',
                disabled: submitting
              }, submitting ? 'Saving...' : (config?.tokenConfigured && config?.chatIdConfigured ? 'Update Configuration' : 'Save Configuration'))
            )
          ),
          React.createElement('div', { className: 'form-section' },
            React.createElement('h2', null, 'RSS/Atom Feeds'),
            feedError && React.createElement('div', { className: 'error' }, feedError),
            feeds.length === 0
              ? React.createElement('div', { className: 'status-label' }, 'No feeds configured yet.')
              : feeds.map((url) =>
                  React.createElement('div', { className: 'status-item', key: url },
                    React.createElement('span', { className: 'status-value' }, url),
                    React.createElement('button', {
                      type: 'button',
                      className: 'button',
                      onClick: () => handleRemoveFeed(url)
                    }, 'Remove')
                  )
                ),
            React.createElement('form', { onSubmit: handleAddFeed, style: { marginTop: '1rem' } },
              React.createElement('div', { className: 'form-group' },
                React.createElement('label', null, 'Add Feed URL'),
                React.createElement('input', {
                  type: 'url',
                  placeholder: 'https://example.com/feed.xml',
                  value: newFeedUrl,
                  onChange: (e) => setNewFeedUrl(e.target.value)
                }),
                React.createElement('div', { className: 'help-text' },
                  'RSS 2.0 or Atom. New feeds are baselined on first check — only items published after that are sent.'
                )
              ),
              React.createElement('button', {
                type: 'submit',
                className: 'button button-primary',
                disabled: feedSubmitting
              }, feedSubmitting ? 'Adding...' : 'Add Feed')
            )
          )
        )
        )
      );
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(React.createElement(App));
  </script>
  ${getKiosaFooterHTML("RONIN · RSS TO TELEGRAM", "ONLINE · V0.1")}
</body>
</html>`;
  }
}
