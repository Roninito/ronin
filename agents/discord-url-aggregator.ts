import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { roninTheme, getAdobeCleanFontFaceCSS, getThemeCSS } from "../src/utils/theme.js";

interface SavedUrl {
  id: string;
  url: string;
  message_content: string;
  author_id: string;
  author_username: string;
  channel_id: string;
  guild_id: string | null;
  message_id: string;
  created_at: number;
}

interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot: boolean;
  };
  channelId: string;
  guildId: string | null;
  timestamp: number;
}

/**
 * Discord URL Aggregator Agent
 * Listens to Discord messages and saves any URLs found
 * 
 * Configuration:
 * - DISCORD_CHANNEL_IDS: Comma-separated list of channel IDs to monitor
 *   Example: DISCORD_CHANNEL_IDS=123456789,987654321,555555555
 * - If not set, monitors ALL channels the bot has access to
 */
export default class DiscordUrlAggregatorAgent extends BaseAgent {
  private clientId: string | null = null;
  private isConnected = false;

  // URL regex - matches http/https URLs
  private urlPattern = /https?:\/\/[^\s<>"\]]+/gi;

  // Channel IDs to monitor (empty = all channels)
  private monitoredChannels: Set<string> = new Set();

  constructor(api: AgentAPI) {
    super(api);
    this.initializeDatabase();
    this.loadMonitoredChannels();
    this.registerRoutes();
    this.connectToDiscord();
    console.log("🔗 Discord URL Aggregator agent initializing...");
  }

  /**
   * Load monitored channel IDs from environment or memory
   */
  private async loadMonitoredChannels(): Promise<void> {
    // Try centralized config service first
    const configDiscord = this.api.config.getDiscord();
    if (configDiscord.channelIds && configDiscord.channelIds.length > 0) {
      configDiscord.channelIds.forEach(id => this.monitoredChannels.add(id));
    }

    // Try environment variable (comma-separated list)
    const envChannels = process.env.DISCORD_CHANNEL_IDS;
    if (envChannels) {
      const channelIds = envChannels.split(",").map(id => id.trim()).filter(id => id);
      channelIds.forEach(id => this.monitoredChannels.add(id));
    }

    // Also check memory for additional channels
    try {
      const memoryChannels = await this.api.memory.retrieve("discord_monitored_channels") as string[] | undefined;
      if (memoryChannels && Array.isArray(memoryChannels)) {
        memoryChannels.forEach(id => this.monitoredChannels.add(id));
      }
    } catch {
      // Memory not available yet, that's fine
    }

    if (this.monitoredChannels.size > 0) {
      console.log(`[Discord URLs] 📺 Monitoring ${this.monitoredChannels.size} channel(s): ${[...this.monitoredChannels].join(", ")}`);
    } else {
      console.log("[Discord URLs] 📺 Monitoring ALL channels (no filter configured)");
    }
  }

  /**
   * Initialize database table for saved URLs
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await this.api.db.execute(`
        CREATE TABLE IF NOT EXISTS discord_urls (
          id TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          message_content TEXT,
          author_id TEXT NOT NULL,
          author_username TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          guild_id TEXT,
          message_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      await this.api.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_discord_urls_created_at ON discord_urls(created_at)
      `);
      await this.api.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_discord_urls_url ON discord_urls(url)
      `);

      console.log("[Discord URLs] Database initialized");
    } catch (error) {
      console.error("[Discord URLs] Failed to initialize database:", error);
    }
  }

  /**
   * Register HTTP routes
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/discord-urls", this.handleUrlsPage.bind(this));
    this.api.http.registerRoute("/api/discord-urls", this.handleUrlsAPI.bind(this));
    this.api.http.registerRoute("/api/discord-urls/channels", this.handleChannelsAPI.bind(this));
  }

  /**
   * Connect to Discord using the direct discord API
   */
  private async connectToDiscord(): Promise<void> {
    // Get token from centralized config, env, or memory
    const configDiscord = this.api.config.getDiscord();
    const token = configDiscord.botToken || 
      process.env.DISCORD_BOT_TOKEN ||
      (await this.api.memory.retrieve("discord_bot_token")) as string | undefined;

    if (!token) {
      console.warn("[Discord URLs] ⚠️ Discord bot token not configured. Set discord.botToken in config or DISCORD_BOT_TOKEN env var");
      return;
    }

    if (!this.api.discord) {
      console.error("[Discord URLs] ❌ Discord plugin not available");
      return;
    }

    try {
      console.log("[Discord URLs] 🤖 Connecting to Discord...");
      
      // Use direct API: this.api.discord.initBot()
      this.clientId = await this.api.discord.initBot(token);
      
      // Register message handler using direct API
      this.api.discord.onMessage(this.clientId, (message: DiscordMessage) => {
        this.handleMessage(message);
      });

      // Register ready handler using direct API
      this.api.discord.onReady(this.clientId, () => {
        this.isConnected = true;
        console.log("[Discord URLs] ✅ Connected and listening for URLs");
      });

    } catch (error) {
      console.error("[Discord URLs] ❌ Failed to connect:", error);
    }
  }

  /**
   * Handle incoming Discord messages - extract and save URLs
   */
  private async handleMessage(message: DiscordMessage): Promise<void> {
    // Skip bot messages
    if (message.author.bot) return;

    // Check if we should monitor this channel
    if (this.monitoredChannels.size > 0 && !this.monitoredChannels.has(message.channelId)) {
      return; // Not a monitored channel, skip
    }

    // Extract URLs from message
    const urls = message.content.match(this.urlPattern);
    if (!urls || urls.length === 0) return;

    const uniqueUrls = [...new Set(urls)];
    console.log(`[Discord URLs] 📥 Found ${uniqueUrls.length} URL(s) from ${message.author.username} in channel ${message.channelId}`);

    for (const url of uniqueUrls) {
      try {
        await this.saveUrl(url, message);
      } catch (error) {
        console.error("[Discord URLs] Failed to save URL:", error);
      }
    }
  }

  /**
   * Save a URL to the database
   */
  private async saveUrl(url: string, message: DiscordMessage): Promise<void> {
    const id = crypto.randomUUID();

    await this.api.db.execute(
      `INSERT INTO discord_urls (id, url, message_content, author_id, author_username, channel_id, guild_id, message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        url,
        message.content,
        message.author.id,
        message.author.username,
        message.channelId,
        message.guildId,
        message.id,
        Date.now(),
      ]
    );

    console.log(`[Discord URLs] 💾 Saved: ${url}`);
  }

  /**
   * Handle URLs API endpoint
   */
  private async handleUrlsAPI(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") || "100");

      try {
        const urls = await this.api.db.query<SavedUrl>(
          `SELECT * FROM discord_urls ORDER BY created_at DESC LIMIT ?`,
          [limit]
        );
        return Response.json({ count: urls.length, connected: this.isConnected, urls });
      } catch (error) {
        return Response.json({ error: "Failed to fetch URLs" }, { status: 500 });
      }
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "ID required" }, { status: 400 });

      try {
        await this.api.db.execute(`DELETE FROM discord_urls WHERE id = ?`, [id]);
        return Response.json({ success: true });
      } catch (error) {
        return Response.json({ error: "Failed to delete" }, { status: 500 });
      }
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  /**
   * Handle channels API endpoint - manage monitored channels
   * GET: List monitored channels
   * POST: Add a channel (body: { channelId: string })
   * DELETE: Remove a channel (?channelId=xxx)
   */
  private async handleChannelsAPI(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET") {
      return Response.json({
        monitoredChannels: [...this.monitoredChannels],
        count: this.monitoredChannels.size,
        mode: this.monitoredChannels.size === 0 ? "all" : "filtered",
      });
    }

    if (req.method === "POST") {
      try {
        const body = await req.json() as { channelId?: string };
        const channelId = body.channelId?.trim();
        
        if (!channelId) {
          return Response.json({ error: "channelId required" }, { status: 400 });
        }

        this.monitoredChannels.add(channelId);
        await this.saveChannelsToMemory();
        
        console.log(`[Discord URLs] ➕ Added channel to monitor: ${channelId}`);
        return Response.json({ 
          success: true, 
          channelId,
          monitoredChannels: [...this.monitoredChannels] 
        });
      } catch (error) {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }
    }

    if (req.method === "DELETE") {
      const channelId = url.searchParams.get("channelId");
      if (!channelId) {
        return Response.json({ error: "channelId required" }, { status: 400 });
      }

      const removed = this.monitoredChannels.delete(channelId);
      if (removed) {
        await this.saveChannelsToMemory();
        console.log(`[Discord URLs] ➖ Removed channel from monitor: ${channelId}`);
      }

      return Response.json({ 
        success: true, 
        removed,
        monitoredChannels: [...this.monitoredChannels] 
      });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  /**
   * Save monitored channels to memory for persistence
   */
  private async saveChannelsToMemory(): Promise<void> {
    try {
      await this.api.memory.store("discord_monitored_channels", [...this.monitoredChannels]);
    } catch (error) {
      console.error("[Discord URLs] Failed to save channels to memory:", error);
    }
  }

  /**
   * Handle URLs page
   */
  private async handleUrlsPage(_req: Request): Promise<Response> {
    try {
      const urls = await this.api.db.query<SavedUrl>(
        `SELECT * FROM discord_urls ORDER BY created_at DESC LIMIT 200`
      );

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discord URLs - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS()}
    
    body {
      min-height: 100vh;
      padding: ${roninTheme.spacing.xl};
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: ${roninTheme.spacing.xl};
      padding-bottom: ${roninTheme.spacing.lg};
      border-bottom: 1px solid ${roninTheme.colors.border};
    }
    
    .header h1 { font-size: 2rem; margin: 0; }
    
    .status {
      display: flex;
      align-items: center;
      gap: ${roninTheme.spacing.sm};
      padding: ${roninTheme.spacing.sm} ${roninTheme.spacing.md};
      background: ${roninTheme.colors.backgroundSecondary};
      border-radius: ${roninTheme.borderRadius.md};
    }
    
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: ${this.isConnected ? '#22c55e' : '#ef4444'};
    }
    
    .url-list { display: flex; flex-direction: column; gap: ${roninTheme.spacing.md}; }
    
    .url-card {
      background: ${roninTheme.colors.backgroundSecondary};
      border: 1px solid ${roninTheme.colors.border};
      border-radius: ${roninTheme.borderRadius.md};
      padding: ${roninTheme.spacing.md};
    }
    
    .url-card:hover { border-color: ${roninTheme.colors.borderHover}; }
    
    .url-link {
      color: ${roninTheme.colors.accent};
      text-decoration: none;
      word-break: break-all;
    }
    
    .url-link:hover { text-decoration: underline; }
    
    .url-meta {
      display: flex;
      gap: ${roninTheme.spacing.lg};
      margin-top: ${roninTheme.spacing.sm};
      font-size: 0.85rem;
      color: ${roninTheme.colors.textSecondary};
    }
    
    .empty { text-align: center; padding: ${roninTheme.spacing.xl}; color: ${roninTheme.colors.textSecondary}; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>🔗 Discord URLs</h1>
      <span style="color: ${roninTheme.colors.textSecondary}">${urls.length} collected</span>
    </div>
    <div class="status">
      <span class="status-dot"></span>
      ${this.isConnected ? 'Connected' : 'Disconnected'}
    </div>
  </div>
  
  <div class="url-list">
    ${urls.length === 0 ? `<div class="empty"><p>No URLs collected yet.</p></div>` : 
      urls.map(u => `
        <div class="url-card">
          <a href="${this.escapeHtml(u.url)}" target="_blank" class="url-link">${this.escapeHtml(u.url)}</a>
          <div class="url-meta">
            <span>👤 ${this.escapeHtml(u.author_username)}</span>
            <span>📅 ${new Date(u.created_at).toLocaleString()}</span>
          </div>
        </div>
      `).join('')}
  </div>
</body>
</html>`;

      return new Response(html, { headers: { "Content-Type": "text/html" } });
    } catch (error) {
      return new Response("Error loading page", { status: 500 });
    }
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  async execute(): Promise<void> {
    // Event-driven agent, no scheduled execution needed
  }
}
