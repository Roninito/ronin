import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { join } from "path";
import { homedir } from "os";
import { readFile, writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";

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
   * Get Telegram bot token from config, memory, or env (in that order)
   */
  private async getBotToken(): Promise<string | undefined> {
    // Check environment variable first (highest priority)
    if (process.env.TELEGRAM_BOT_TOKEN) {
      return process.env.TELEGRAM_BOT_TOKEN;
    }

    // Check config file
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
   * Get Telegram chat ID from config, memory, or env (in that order)
   */
  private async getChatId(): Promise<string | number | undefined> {
    // Check environment variable first (highest priority)
    if (process.env.TELEGRAM_CHAT_ID) {
      return process.env.TELEGRAM_CHAT_ID;
    }

    // Check config file
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
  }

  /**
   * Get CORS headers
   */
  private getCorsHeaders(): Record<string, string> {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

  /**
   * Get HTML UI for configuration
   */
  private getHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RSS to Telegram Configuration</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      padding: 0;
      line-height: 1.6;
    }
    
    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 4rem 2rem;
    }
    
    .header {
      margin-bottom: 4rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 3rem;
      text-align: center;
    }
    
    .header h1 {
      font-size: clamp(2.5rem, 5vw, 4rem);
      font-weight: 300;
      letter-spacing: -0.02em;
      margin-bottom: 0.5rem;
      color: #ffffff;
    }
    
    .header p {
      font-size: 1.1rem;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 300;
    }
    
    .content {
      padding: 0;
    }
    
    .status-section {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 2rem;
      margin-bottom: 3rem;
    }
    
    .status-section h2 {
      color: #ffffff;
      margin-bottom: 1.5rem;
      font-size: 1.5rem;
      font-weight: 400;
      letter-spacing: -0.01em;
    }
    
    .status-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    
    .status-item:last-child {
      border-bottom: none;
    }
    
    .status-label {
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.875rem;
      font-weight: 500;
    }
    
    .status-value {
      color: #ffffff;
      font-size: 0.875rem;
      font-family: 'JetBrains Mono', monospace;
    }
    
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    
    .status-badge.configured {
      background: rgba(40, 167, 69, 0.2);
      color: #28a745;
      border: 1px solid rgba(40, 167, 69, 0.3);
    }
    
    .status-badge.not-configured {
      background: rgba(220, 53, 69, 0.2);
      color: #dc3545;
      border: 1px solid rgba(220, 53, 69, 0.3);
    }
    
    .form-section {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 2rem;
      margin-bottom: 3rem;
    }
    
    .form-section h2 {
      color: #ffffff;
      margin-bottom: 1.5rem;
      font-size: 1.5rem;
      font-weight: 400;
      letter-spacing: -0.01em;
    }
    
    .form-group {
      margin-bottom: 1.5rem;
    }
    
    .form-group label {
      display: block;
      color: rgba(255, 255, 255, 0.7);
      margin-bottom: 0.5rem;
      font-size: 0.875rem;
      font-weight: 500;
    }
    
    .form-group .help-text {
      font-size: 0.75rem;
      color: rgba(255, 255, 255, 0.4);
      margin-top: 0.25rem;
      font-style: italic;
    }
    
    .form-group input {
      width: 100%;
      padding: 0.75rem;
      font-size: 1rem;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      color: #ffffff;
      font-family: 'Inter', sans-serif;
      transition: all 0.3s;
    }
    
    .form-group input::placeholder {
      color: rgba(255, 255, 255, 0.3);
    }
    
    .form-group input:focus {
      outline: none;
      border-color: rgba(255, 255, 255, 0.2);
      background: rgba(255, 255, 255, 0.04);
    }
    
    .form-group .required {
      color: rgba(255, 100, 100, 0.8);
    }
    
    .button {
      padding: 0.75rem 1.5rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.9);
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
      font-family: 'Inter', sans-serif;
      font-weight: 500;
      transition: all 0.3s;
    }
    
    .button:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
      color: #ffffff;
    }
    
    .button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .button-primary {
      background: rgba(100, 150, 255, 0.2);
      border-color: rgba(100, 150, 255, 0.3);
      color: #88b3ff;
    }
    
    .button-primary:hover:not(:disabled) {
      background: rgba(100, 150, 255, 0.3);
      border-color: rgba(100, 150, 255, 0.4);
      color: #a8c7ff;
    }
    
    .error {
      background: rgba(220, 53, 69, 0.1);
      border: 1px solid rgba(220, 53, 69, 0.3);
      color: #dc3545;
      padding: 1rem;
      border-radius: 4px;
      margin: 1rem 0;
    }
    
    .success {
      background: rgba(40, 167, 69, 0.1);
      border: 1px solid rgba(40, 167, 69, 0.3);
      color: #28a745;
      padding: 1rem;
      border-radius: 4px;
      margin: 1rem 0;
    }
    
    .loading {
      text-align: center;
      padding: 3rem;
      color: rgba(255, 255, 255, 0.4);
      font-weight: 300;
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 2rem 1.5rem;
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
      
      useEffect(() => {
        loadConfig();
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
      
      return React.createElement('div', { className: 'container' },
        React.createElement('div', { className: 'header' },
          React.createElement('h1', null, '📡 RSS to Telegram'),
          React.createElement('p', null, 'Configure your Telegram bot to forward RSS feed items')
        ),
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
          )
        )
      );
    }
    
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(React.createElement(App));
  </script>
</body>
</html>`;
  }
}
