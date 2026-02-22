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

/**
 * Telegram Subscription agent that polls Telegram channels for new messages
 * and stores them for other agents to consume
 */
export default class TelegramSubscriptionAgent extends BaseAgent {
  // Schedule: Run every 5 minutes
  static schedule = "*/15 * * * *";

  constructor(api: AgentAPI) {
    super(api);
    this.setupMessageHandler();
    this.api.events.on("SendTelegramMessage", (data: unknown) => {
      this.handleSendTelegramMessage(data).catch((err) =>
        console.error("[telegram-subscription] SendTelegramMessage error:", err)
      );
    });
    console.log("[telegram-subscription] Listening for SendTelegramMessage");
    
    // Try to set up real-time message handler (will succeed once bot is initialized)
    this.setupRealTimeHandler();
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

    // Check if Telegram plugin is available
    if (!this.api.telegram) {
      console.error("[telegram-subscription] Telegram plugin not available");
      return;
    }

    // Get Telegram bot token from centralized config, env, or memory
    const configTelegram = this.api.config.getTelegram();
    const token = configTelegram.botToken ||
      process.env.TELEGRAM_BOT_TOKEN ||
      (await this.api.memory.retrieve("telegram_bot_token")) as string | undefined;

    if (!token) {
      console.error("[telegram-subscription] Telegram bot token not configured");
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
          limit: 100,
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
              limit: 100,
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
      }
    } catch (error) {
      console.error("[telegram-subscription] Failed to get updates:", error);
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
    if (chatId == null) {
      chatId = (await this.api.memory.retrieve("telegram_chat_id")) as string | number | undefined;
      if (chatId == null) chatId = configTelegram.chatId;
    }
    if (chatId == null) {
      console.warn("[telegram-subscription] No chatId in payload or default, skipping send");
      return;
    }
    const doSend = async (): Promise<void> => {
      await this.api.telegram!.sendMessage(botId!, chatId!, payload.text, {
        parseMode: payload.parseMode,
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
      // Skip private messages unless explicitly configured
      const processPrivate = await this.api.memory.retrieve("telegram_process_private");
      if (!processPrivate) {
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
  } catch (error) {
    console.error(`[telegram-subscription] Failed to store message:`, error);
  }
}
