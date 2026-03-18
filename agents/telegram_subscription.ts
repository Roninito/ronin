import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

export interface SendTelegramMessagePayload {
  text: string;
  chatId?: string | number;
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  source?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
    };
    text?: string;
    caption?: string;
    photo?: Array<{ file_id: string }>;
    date: number;
  };
}

interface TelegramSubscriptionConfig {
  enabled: boolean;
  processPrivate: boolean;
  pollLimit: number;
  defaultChatId?: string;
  defaultParseMode?: "HTML" | "Markdown" | "MarkdownV2";
}

/**
 * Telegram Subscription agent that polls Telegram channels for new messages
 * and stores them for other agents to consume
 */
export default class TelegramSubscriptionAgent extends BaseAgent {
  // Schedule: Run every 5 minutes
  static schedule = "*/15 * * * *";
  private static readonly CONFIG_KEY = "telegram_subscription_config";
  private lastHomeFeedEmitAt = 0;

  constructor(api: AgentAPI) {
    super(api);
    this.setupMessageHandler();
    this.registerRoutes();
    this.api.events.on("SendTelegramMessage", (data: unknown) => {
      this.handleSendTelegramMessage(data).catch((err) =>
        console.error("[telegram-subscription] SendTelegramMessage error:", err)
      );
    });
    console.log("[telegram-subscription] Listening for SendTelegramMessage");
    
    // Try to set up real-time message handler (will succeed once bot is initialized)
    this.setupRealTimeHandler();
    this.emitHomeFeed("Ready", "Polling and realtime handlers initializing");
    setTimeout(() => this.emitHomeFeed("Ready", "Polling and realtime handlers initializing"), 3000);
  }

  private emitHomeFeed(status: string, detail: string, priority = 81): void {
    const now = Date.now();
    if (now - this.lastHomeFeedEmitAt < 15_000) return;
    this.lastHomeFeedEmitAt = now;
    this.api.events.emit(
      "home-feed",
      {
        agent: "telegram_subscription",
        title: "Telegram Subscription",
        priority,
        updatedAt: new Date(now).toISOString(),
        html: `<div><strong>Telegram Subscription</strong><div>${status}</div><small>${detail}</small></div>`,
      },
      "telegram-subscription"
    );
  }

  private getDefaultConfig(): TelegramSubscriptionConfig {
    const cfg = this.api.config.getTelegram();
    return {
      enabled: true,
      processPrivate: false,
      pollLimit: 100,
      defaultChatId: cfg.chatId ? String(cfg.chatId) : undefined,
      defaultParseMode: "HTML",
    };
  }

  private async getConfig(): Promise<TelegramSubscriptionConfig> {
    const raw = await this.api.memory.retrieve(TelegramSubscriptionAgent.CONFIG_KEY);
    const defaults = this.getDefaultConfig();
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(String(raw)) as Partial<TelegramSubscriptionConfig>;
      const pollLimit = Number(parsed.pollLimit);
      return {
        ...defaults,
        ...parsed,
        pollLimit: Number.isFinite(pollLimit) ? Math.max(1, Math.min(100, Math.floor(pollLimit))) : defaults.pollLimit,
      };
    } catch {
      return defaults;
    }
  }

  private async saveConfig(next: TelegramSubscriptionConfig): Promise<void> {
    await this.api.memory.store(TelegramSubscriptionAgent.CONFIG_KEY, JSON.stringify(next));
  }

  private registerRoutes(): void {
    this.api.http.registerRoute("/telegram-subscription", this.handleConfigPage.bind(this));
    this.api.http.registerRoute("/api/telegram-subscription/config", this.handleConfigAPI.bind(this));
  }

  private async handleConfigPage(req: Request): Promise<Response> {
    if (req.method === "POST") {
      const form = await req.formData();
      const current = await this.getConfig();
      const parsedLimit = Number(form.get("pollLimit") || current.pollLimit);
      const cfg: TelegramSubscriptionConfig = {
        enabled: form.get("enabled") === "on",
        processPrivate: form.get("processPrivate") === "on",
        pollLimit: Number.isFinite(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : current.pollLimit,
        defaultChatId: String(form.get("defaultChatId") || "").trim() || undefined,
        defaultParseMode: (String(form.get("defaultParseMode") || "HTML") as "HTML" | "Markdown" | "MarkdownV2"),
      };
      await this.saveConfig(cfg);
      if (form.get("resetOffset") === "on") {
        await this.api.memory.store("telegram_last_update_id", 0);
      }
      this.emitHomeFeed("Config updated", `Private: ${cfg.processPrivate ? "on" : "off"} · limit: ${cfg.pollLimit}`);
      return Response.redirect("/telegram-subscription?saved=1", 303);
    }

    const cfg = await this.getConfig();
    const saved = new URL(req.url).searchParams.get("saved") === "1";
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Telegram Subscription Config</title>
      <style>
        body{font-family:Arial,sans-serif;background:#111;color:#eee;margin:0;padding:20px}
        .card{max-width:720px;margin:0 auto;background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:16px}
        h1{font-size:20px;margin:0 0 12px}
        label{display:block;font-size:12px;color:#aaa;margin:12px 0 6px}
        input,select{width:100%;background:#111;border:1px solid #333;color:#eee;border-radius:6px;padding:8px}
        .row{display:flex;gap:12px}.row>div{flex:1}
        .check{display:flex;align-items:center;gap:8px;margin:8px 0}
        .check input{width:auto}
        button{margin-top:14px;background:#84cc16;border:none;color:#111;padding:10px 14px;border-radius:6px;font-weight:700;cursor:pointer}
        .ok{background:#16320d;border:1px solid #2d6a1f;color:#9be67a;padding:8px;border-radius:6px;margin-bottom:10px}
        a{color:#84cc16}
      </style></head><body>
      <div class="card">
        <h1>Telegram Subscription Configuration</h1>
        ${saved ? '<div class="ok">Saved.</div>' : ""}
        <form method="POST" action="/telegram-subscription">
          <div class="check"><input id="enabled" name="enabled" type="checkbox" ${cfg.enabled ? "checked" : ""}/><label for="enabled" style="margin:0">Enabled</label></div>
          <div class="check"><input id="processPrivate" name="processPrivate" type="checkbox" ${cfg.processPrivate ? "checked" : ""}/><label for="processPrivate" style="margin:0">Process private chats</label></div>
          <div class="row">
            <div><label for="pollLimit">Poll limit (1-100)</label><input id="pollLimit" name="pollLimit" type="number" min="1" max="100" value="${cfg.pollLimit}"/></div>
            <div><label for="defaultParseMode">Default parse mode</label>
              <select id="defaultParseMode" name="defaultParseMode">
                <option value="HTML" ${cfg.defaultParseMode === "HTML" ? "selected" : ""}>HTML</option>
                <option value="Markdown" ${cfg.defaultParseMode === "Markdown" ? "selected" : ""}>Markdown</option>
                <option value="MarkdownV2" ${cfg.defaultParseMode === "MarkdownV2" ? "selected" : ""}>MarkdownV2</option>
              </select>
            </div>
          </div>
          <label for="defaultChatId">Default outbound chat ID (optional override)</label>
          <input id="defaultChatId" name="defaultChatId" value="${cfg.defaultChatId ?? ""}" placeholder="e.g. -1001234567890"/>
          <div class="check"><input id="resetOffset" name="resetOffset" type="checkbox"/><label for="resetOffset" style="margin:0">Reset update offset on save</label></div>
          <button type="submit">Save</button>
        </form>
        <p style="color:#888;font-size:12px;margin-top:14px">Schedule is managed via <a href="/schedule">/schedule</a>.</p>
      </div></body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  private async handleConfigAPI(req: Request): Promise<Response> {
    if (req.method === "GET") return Response.json(await this.getConfig());
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({})) as Partial<TelegramSubscriptionConfig> & { resetOffset?: boolean };
      const current = await this.getConfig();
      const next: TelegramSubscriptionConfig = {
        enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
        processPrivate: typeof body.processPrivate === "boolean" ? body.processPrivate : current.processPrivate,
        pollLimit: Number.isFinite(Number(body.pollLimit)) ? Math.max(1, Math.min(100, Number(body.pollLimit))) : current.pollLimit,
        defaultChatId: typeof body.defaultChatId === "string" && body.defaultChatId.trim() ? body.defaultChatId.trim() : current.defaultChatId,
        defaultParseMode: body.defaultParseMode || current.defaultParseMode,
      };
      await this.saveConfig(next);
      if (body.resetOffset) await this.api.memory.store("telegram_last_update_id", 0);
      return Response.json({ ok: true, config: next });
    }
    return new Response("Method not allowed", { status: 405 });
  }

  private setupRealTimeHandler(): void {
    const token = this.api.config.getTelegram().botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    
    // Note: Can't use async retrieve() here (constructor context)
    // The real-time handler will be registered in execute() after bot initialization
  }

  private realTimeHandlerRegistered = false;

  async execute(): Promise<void> {
    console.log("[telegram-subscription] Polling for updates...");
    const runtimeConfig = await this.getConfig();
    if (!runtimeConfig.enabled) {
      this.emitHomeFeed("Disabled", "Polling disabled in config");
      return;
    }

    // Check if Telegram plugin is available
    if (!this.api.telegram) {
      console.error("[telegram-subscription] Telegram plugin not available");
      this.emitHomeFeed("Error", "Telegram plugin not available", 87);
      return;
    }

    // Get Telegram bot token from centralized config, env, or memory
    const configTelegram = this.api.config.getTelegram();
    const token = configTelegram.botToken ||
      process.env.TELEGRAM_BOT_TOKEN ||
      (await this.api.memory.retrieve("telegram_bot_token")) as string | undefined;

    if (!token) {
      console.error("[telegram-subscription] Telegram bot token not configured");
      this.emitHomeFeed("Blocked", "Missing Telegram bot token", 86);
      return;
    }

    // Initialize bot if not already initialized
    let botId = (await this.api.memory.retrieve("telegram_bot_id")) as string | undefined;
    if (!botId) {
      try {
        botId = await this.api.telegram.initBot(token);
        await this.api.memory.store("telegram_bot_id", botId);
        console.log(`[telegram-subscription] Initialized Telegram bot: ${botId}`);
      } catch (error) {
        console.error(`[telegram-subscription] Failed to initialize bot:`, error);
        return;
      }
    }

    // Register real-time message handler once (after bot is initialized)
    if (!this.realTimeHandlerRegistered) {
      this.api.telegram.onMessage(botId, (update: any) => {
        this.processMessage(update).catch((err) => {
          console.error("[telegram-subscription] Error in real-time message handler:", err);
        });
      });
      console.log(`[telegram-subscription] Real-time message handler registered for bot ${botId}`);
      this.realTimeHandlerRegistered = true;
    }

    // Also call setupRealTimeHandler for any other agents that might need it
    this.setupRealTimeHandler();

    // Get last processed update ID
    const lastUpdateId = ((await this.api.memory.retrieve("telegram_last_update_id")) as number) || 0;

    try {
      // Get updates - if bot ID is invalid, reinitialize
      let updates;
      try {
        updates = await this.api.telegram.getUpdates(botId, {
          limit: runtimeConfig.pollLimit,
          offset: lastUpdateId + 1,
        });
      } catch (error: any) {
        // If bot not initialized, try to reinitialize
        if (error?.message?.includes("Bot not initialized")) {
          console.log("[telegram-subscription] Bot not initialized, reinitializing...");
          try {
            botId = await this.api.telegram.initBot(token);
            await this.api.memory.store("telegram_bot_id", botId);
            console.log(`[telegram-subscription] Reinitialized Telegram bot: ${botId}`);
            
            // Retry getting updates
            updates = await this.api.telegram.getUpdates(botId, {
              limit: runtimeConfig.pollLimit,
              offset: lastUpdateId + 1,
            });
          } catch (initError) {
            console.error(`[telegram-subscription] Failed to reinitialize bot:`, initError);
            return;
          }
        } else {
          throw error;
        }
      }

      if (updates.length === 0) {
        console.log("[telegram-subscription] No new updates");
        this.emitHomeFeed("Idle", "No new updates");
        return;
      }

      console.log(`[telegram-subscription] Processing ${updates.length} update(s)`);

      let processedCount = 0;
      let maxUpdateId = lastUpdateId;

      for (const update of updates) {
        try {
          // Process message if present
          if (update.message) {
            await this.processMessage(update);
            processedCount++;
          }

          // Track highest update ID
          if (update.update_id > maxUpdateId) {
            maxUpdateId = update.update_id;
          }
        } catch (error) {
          console.error(`[telegram-subscription] Error processing update ${update.update_id}:`, error);
        }
      }

      // Update last processed update ID
      if (maxUpdateId > lastUpdateId) {
        await this.api.memory.store("telegram_last_update_id", maxUpdateId);
        console.log(`[telegram-subscription] ✅ Processed ${processedCount} message(s), last update ID: ${maxUpdateId}`);
        this.emitHomeFeed("Processed", `${processedCount} message(s)`);
      }
    } catch (error) {
      console.error("[telegram-subscription] Failed to get updates:", error);
      this.emitHomeFeed("Error", error instanceof Error ? error.message.slice(0, 120) : "Polling failed", 88);
    }
  }

  /**
   * Set up message handler for real-time message processing
   */
  private setupMessageHandler(): void {
    // This will be called when messages arrive via polling or webhook
    // The handler is registered when bot is initialized
  }

  /**
   * Handle outbound SendTelegramMessage event: resolve botId/chatId and send.
   */
  private async handleSendTelegramMessage(data: unknown): Promise<void> {
    if (!this.api.telegram) {
      console.warn("[telegram-subscription] Telegram plugin not available, skipping SendTelegramMessage");
      return;
    }
    const payload = data as SendTelegramMessagePayload;
    if (!payload?.text || typeof payload.text !== "string") {
      console.warn("[telegram-subscription] SendTelegramMessage missing text");
      return;
    }
    const configTelegram = this.api.config.getTelegram();
    const token =
      configTelegram.botToken ||
      process.env.TELEGRAM_BOT_TOKEN ||
      ((await this.api.memory.retrieve("telegram_bot_token")) as string | undefined);
    if (!token) {
      console.warn("[telegram-subscription] No Telegram token, skipping send");
      return;
    }
    let botId = (await this.api.memory.retrieve("telegram_bot_id")) as string | undefined;
    if (!botId) {
      try {
        botId = await this.api.telegram.initBot(token);
        await this.api.memory.store("telegram_bot_id", botId);
      } catch (err) {
        console.error("[telegram-subscription] Failed to init bot for send:", err);
        return;
      }
    }
    let chatId: string | number | undefined = payload.chatId;
    const subConfig = await this.getConfig();
    if (chatId == null) {
      chatId = (await this.api.memory.retrieve("telegram_chat_id")) as string | number | undefined;
      if (chatId == null) chatId = subConfig.defaultChatId ?? configTelegram.chatId;
    }
    if (chatId == null) {
      console.warn("[telegram-subscription] No chatId in payload or default, skipping send");
      return;
    }
    const doSend = async (): Promise<void> => {
      await this.api.telegram!.sendMessage(botId!, chatId!, payload.text, {
        parseMode: payload.parseMode ?? subConfig.defaultParseMode,
      });
    };
    try {
      await doSend();
      if (payload.source) {
        console.log(`[telegram-subscription] Sent message (source: ${payload.source})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Bot not initialized")) {
        console.log("[telegram-subscription] Bot not in plugin map (e.g. after restart), re-initializing…");
        try {
          botId = await this.api.telegram!.initBot(token);
          await this.api.memory.store("telegram_bot_id", botId);
          await doSend();
          if (payload.source) {
            console.log(`[telegram-subscription] Sent message (source: ${payload.source})`);
          }
        } catch (retryErr) {
          console.error("[telegram-subscription] Failed to send message after re-init:", retryErr);
        }
      } else {
        console.error("[telegram-subscription] Failed to send message:", err);
      }
    }
  }

  /**
   * Process a Telegram message
   */
  private async processMessage(update: TelegramUpdate): Promise<void> {
    if (!update.message) {
      return;
    }

    const message = update.message;
    const chatId = message.chat.id;
    const chatType = message.chat.type;
    const chatName = message.chat.title || message.chat.username || `Chat ${chatId}`;
    const text = message.text || message.caption || "";

    // Only process messages from channels/groups (not private chats unless configured)
    if (chatType === "private") {
      const cfg = await this.getConfig();
      if (!cfg.processPrivate) {
        return;
      }
    }

    // Store message in database for other agents
    try {
      await this.api.db.execute(
        `CREATE TABLE IF NOT EXISTS telegram_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          update_id INTEGER UNIQUE NOT NULL,
          message_id INTEGER NOT NULL,
          chat_id INTEGER NOT NULL,
          chat_type TEXT NOT NULL,
          chat_name TEXT,
          text TEXT,
          timestamp INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`
      );

      await this.api.db.execute(
        `INSERT OR IGNORE INTO telegram_messages
         (update_id, message_id, chat_id, chat_type, chat_name, text, timestamp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          update.update_id,
          message.message_id,
          chatId,
          chatType,
          chatName,
          text,
          message.date * 1000, // Convert to milliseconds
          Date.now(),
        ]
      );
    } catch (err) {
      console.error("[telegram-subscription] Failed to store message:", err);
    }

    // Emit event for other agents (e.g., intent-ingress) to handle
    this.api.events.emit(
      "telegram.message",
      {
        botId: this.botId,
        message: {
          message_id: message.message_id,
          chat: { id: chatId, type: chatType, title: chatName },
          from: message.from,
          text: text,
          caption: message.caption,
          date: message.date,
        },
        update_id: update.update_id,
      },
      "telegram-subscription"
    );

    // Legacy compatibility: also emit telegram-message for rss-feed/gvec
    this.api.events.beam(["rss-feed", "gvec"], "telegram-message", {
      update_id: update.update_id,
      chat_id: chatId,
      chat_name: chatName,
      text,
      timestamp: message.date * 1000,
    });

    console.log(`[telegram-subscription] Stored message from ${chatName}: ${text.substring(0, 50)}...`);
    this.emitHomeFeed("Inbound", `${chatName}: ${text.substring(0, 60)}`);
  }
}
