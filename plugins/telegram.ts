import type { Plugin } from "../src/plugins/base.js";
import { Bot, Context } from "grammy";

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

interface BotInstance {
  bot: Bot;
  isPolling: boolean;
  messageHandlers: Set<(update: TelegramUpdate) => void>;
  token: string;
}

const bots: Map<string, BotInstance> = new Map();
// Track tokens to prevent duplicate bot instances
const tokenToBotId: Map<string, string> = new Map();

/**
 * Telegram plugin for interacting with Telegram Bot API
 */
const telegramPlugin: Plugin = {
  name: "telegram",
  description: "Telegram Bot API integration for sending messages, polling updates, and managing bots",
  methods: {
    /**
     * Initialize a Telegram bot with a token
     * @param token Telegram Bot Token from @BotFather
     * @param options Optional configuration (webhookUrl for webhook mode)
     * @returns Bot ID for reference in other calls
     */
    initBot: async (
      token: string,
      options?: { webhookUrl?: string }
    ): Promise<string> => {
      if (!token || typeof token !== "string") {
        throw new Error("Telegram bot token is required");
      }

      // Check if a bot with this token already exists
      const existingBotId = tokenToBotId.get(token);
      if (existingBotId) {
        const existingInstance = bots.get(existingBotId);
        if (existingInstance) {
          console.log(`[telegram] Bot with this token already initialized: ${existingBotId}`);
          return existingBotId;
        } else {
          // Clean up stale entry
          tokenToBotId.delete(token);
        }
      }

      const botId = `telegram_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const bot = new Bot(token);

      // Add error handler for 409 conflicts
      bot.catch((err) => {
        if (err.error_code === 409) {
          console.error(
            `[telegram] Error 409: Another bot instance is already polling with this token. ` +
            `This usually means multiple instances are running. ` +
            `Consider stopping other instances or using webhook mode instead.`
          );
          // Don't crash, but log the error
          return;
        }
        console.error(`[telegram] Unhandled bot error:`, err);
      });

      // Validate token by getting bot info
      try {
        const me = await bot.api.getMe();
        console.log(`[telegram] Bot initialized: @${me.username} (${me.first_name})`);
      } catch (error) {
        throw new Error(
          `Failed to initialize Telegram bot: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const instance: BotInstance = {
        bot,
        isPolling: false,
        messageHandlers: new Set(),
        token,
      };

      // Configure webhook if provided
      if (options?.webhookUrl) {
        try {
          await bot.api.setWebhook(options.webhookUrl);
          console.log(`[telegram] Webhook set for bot ${botId}: ${options.webhookUrl}`);
        } catch (error) {
          throw new Error(
            `Failed to set webhook: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      } else {
        // Start polling if no webhook
        try {
          bot.start();
          instance.isPolling = true;
          console.log(`[telegram] Started polling for bot ${botId}`);
        } catch (error: any) {
          // Handle 409 error specifically
          if (error?.error_code === 409) {
            console.error(
              `[telegram] Failed to start polling: Another instance is already running with this token. ` +
              `Please stop other instances or use webhook mode.`
            );
            // Clean up the bot instance
            bots.delete(botId);
            throw new Error(
              `Bot is already running in another instance. ` +
              `Error 409: ${error?.description || "Conflict: terminated by other getUpdates request"}`
            );
          }
          throw error;
        }
      }

      bots.set(botId, instance);
      tokenToBotId.set(token, botId);
      return botId;
    },

    /**
     * Send a text message to a chat or channel
     * @param botId ID from initBot
     * @param chatId Chat/channel ID (e.g., '@channelusername' or numeric ID)
     * @param text Message text
     * @param options Optional message options (parseMode)
     */
    sendMessage: async (
      botId: string,
      chatId: string | number,
      text: string,
      options?: { parseMode?: "HTML" | "Markdown" | "MarkdownV2" }
    ): Promise<void> => {
      const instance = bots.get(botId);
      if (!instance) {
        throw new Error(`Bot not initialized: ${botId}`);
      }

      if (!text || typeof text !== "string") {
        throw new Error("Message text is required");
      }

      try {
        await instance.bot.api.sendMessage(chatId, text, {
          parse_mode: options?.parseMode,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        // Provide helpful error messages for common issues
        if (errorMsg.includes("chat not found")) {
          throw new Error(
            `Failed to send message: Chat not found (${chatId}). ` +
            `Make sure the bot is added to the chat/channel and the chat ID is correct. ` +
            `For channels, add the bot as an administrator.`
          );
        } else if (errorMsg.includes("bot was kicked")) {
          throw new Error(
            `Failed to send message: Bot was kicked from the chat (${chatId}).`
          );
        } else if (errorMsg.includes("bot was blocked")) {
          throw new Error(
            `Failed to send message: Bot was blocked by the user (${chatId}).`
          );
        }
        
        throw new Error(`Failed to send message: ${errorMsg}`);
      }
    },

    /**
     * Send a photo to a chat or channel
     * @param botId ID from initBot
     * @param chatId Chat/channel ID
     * @param photo Photo URL, file path, or Buffer
     * @param caption Optional caption text
     */
    sendPhoto: async (
      botId: string,
      chatId: string | number,
      photo: string | Buffer,
      caption?: string
    ): Promise<void> => {
      const instance = bots.get(botId);
      if (!instance) {
        throw new Error(`Bot not initialized: ${botId}`);
      }

      try {
        await instance.bot.api.sendPhoto(chatId, photo, {
          caption,
        });
      } catch (error) {
        throw new Error(
          `Failed to send photo: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Get recent updates (messages) from subscribed chats/channels
     * @param botId ID from initBot
     * @param options Optional parameters (limit, offset)
     * @returns Array of update objects
     */
    getUpdates: async (
      botId: string,
      options?: { limit?: number; offset?: number }
    ): Promise<TelegramUpdate[]> => {
      const instance = bots.get(botId);
      if (!instance) {
        throw new Error(`Bot not initialized: ${botId}`);
      }

      try {
        const updates = await instance.bot.api.getUpdates({
          limit: options?.limit || 10,
          offset: options?.offset,
        });
        return updates as TelegramUpdate[];
      } catch (error: any) {
        // Handle 409 error specifically
        if (error?.error_code === 409) {
          console.error(
            `[telegram] Error 409: Another bot instance is polling with this token. ` +
            `Make sure only one instance is running.`
          );
          throw new Error(
            `Conflict: Another bot instance is already polling. ` +
            `Error 409: ${error?.description || "terminated by other getUpdates request"}`
          );
        }
        throw new Error(
          `Failed to get updates: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Join a channel or group (bot must be invited or be admin)
     * @param botId ID from initBot
     * @param channelId Channel ID (e.g., '@channelusername')
     */
    joinChannel: async (botId: string, channelId: string): Promise<void> => {
      const instance = bots.get(botId);
      if (!instance) {
        throw new Error(`Bot not initialized: ${botId}`);
      }

      try {
        await instance.bot.api.joinChat(channelId);
        console.log(`[telegram] Joined channel: ${channelId}`);
      } catch (error) {
        throw new Error(
          `Failed to join channel: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Set webhook URL for receiving updates
     * @param botId ID from initBot
     * @param url Webhook URL
     */
    setWebhook: async (botId: string, url: string): Promise<void> => {
      const instance = bots.get(botId);
      if (!instance) {
        throw new Error(`Bot not initialized: ${botId}`);
      }

      try {
        await instance.bot.api.setWebhook(url);
        if (instance.isPolling) {
          await instance.bot.stop();
          instance.isPolling = false;
        }
        console.log(`[telegram] Webhook set for bot ${botId}: ${url}`);
      } catch (error) {
        throw new Error(
          `Failed to set webhook: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Register a message handler callback
     * @param botId ID from initBot
     * @param callback Callback function to handle messages
     */
    onMessage: (botId: string, callback: (update: TelegramUpdate) => void): void => {
      const instance = bots.get(botId);
      if (!instance) {
        throw new Error(`Bot not initialized: ${botId}`);
      }

      instance.messageHandlers.add(callback);

      // Set up Grammy handler if not already set up
      instance.bot.on("message", (ctx: Context) => {
        const update: TelegramUpdate = {
          update_id: ctx.update.update_id,
          message: ctx.message
            ? {
                message_id: ctx.message.message_id,
                chat: {
                  id: ctx.message.chat.id,
                  type: ctx.message.chat.type,
                  title: "title" in ctx.message.chat ? ctx.message.chat.title : undefined,
                  username:
                    "username" in ctx.message.chat ? ctx.message.chat.username : undefined,
                },
                text: ctx.message.text,
                caption: ctx.message.caption,
                photo: ctx.message.photo?.map((p) => ({ file_id: p.file_id })),
                date: ctx.message.date,
              }
            : undefined,
        };

        instance.messageHandlers.forEach((handler) => {
          try {
            handler(update);
          } catch (error) {
            console.error(`[telegram] Error in message handler:`, error);
          }
        });
      });
    },

    /**
     * Get bot information
     * @param botId ID from initBot
     * @returns Bot information object
     */
    getBotInfo: async (botId: string): Promise<{
      id: number;
      username: string;
      first_name: string;
      can_join_groups: boolean;
      can_read_all_group_messages: boolean;
    }> => {
      const instance = bots.get(botId);
      if (!instance) {
        throw new Error(`Bot not initialized: ${botId}`);
      }

      try {
        const me = await instance.bot.api.getMe();
        return {
          id: me.id,
          username: me.username || "",
          first_name: me.first_name,
          can_join_groups: me.can_join_groups || false,
          can_read_all_group_messages: me.can_read_all_group_messages || false,
        };
      } catch (error) {
        throw new Error(
          `Failed to get bot info: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Get channel information
     * @param botId ID from initBot
     * @param channelId Channel ID (e.g., '@channelusername' or numeric ID)
     * @returns Channel information object
     */
    getChannelInfo: async (
      botId: string,
      channelId: string | number
    ): Promise<{
      id: number;
      title: string;
      username?: string;
      type: string;
      description?: string;
    }> => {
      const instance = bots.get(botId);
      if (!instance) {
        throw new Error(`Bot not initialized: ${botId}`);
      }

      try {
        const chat = await instance.bot.api.getChat(channelId);
        return {
          id: chat.id,
          title: "title" in chat ? chat.title : "Unknown",
          username: "username" in chat ? chat.username : undefined,
          type: chat.type,
          description: "description" in chat ? chat.description : undefined,
        };
      } catch (error) {
        throw new Error(
          `Failed to get channel info: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Get channel post history
     * Note: Telegram Bot API doesn't have a direct method to get channel history.
     * This method relies on the bot receiving updates through polling or webhooks.
     * For best results, ensure the bot has been added to the channel and is receiving updates.
     * @param botId ID from initBot
     * @param channelId Channel ID
     * @param options Optional parameters (limit)
     * @returns Array of recent messages from the channel (from received updates)
     */
    getChannelHistory: async (
      botId: string,
      channelId: string | number,
      options?: { limit?: number }
    ): Promise<Array<{
      message_id: number;
      text?: string;
      caption?: string;
      date: number;
      chat: {
        id: number;
        title?: string;
        username?: string;
        type: string;
      };
    }>> => {
      const instance = bots.get(botId);
      if (!instance) {
        throw new Error(`Bot not initialized: ${botId}`);
      }

      try {
        // Note: The Telegram Bot API doesn't provide a direct way to fetch historical messages.
        // This is a limitation of the Bot API. Bots can only receive messages sent after they join.
        // To get historical data, you would need to use the Telegram Client API (MTProto).
        
        // For now, we return an empty array and document this limitation
        console.warn(
          "[telegram] getChannelHistory: Bot API cannot fetch historical messages. " +
          "Only messages received after bot joined will be available via onMessage handler."
        );
        return [];
      } catch (error) {
        throw new Error(
          `Failed to get channel history: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Stop a bot instance and clean up resources
     * @param botId ID from initBot
     */
    stopBot: async (botId: string): Promise<void> => {
      const instance = bots.get(botId);
      if (!instance) {
        throw new Error(`Bot not initialized: ${botId}`);
      }

      try {
        if (instance.isPolling) {
          await instance.bot.stop();
          instance.isPolling = false;
          console.log(`[telegram] Stopped polling for bot ${botId}`);
        }
        
        // Clean up token mapping
        tokenToBotId.delete(instance.token);
        bots.delete(botId);
        console.log(`[telegram] Bot ${botId} cleaned up`);
      } catch (error) {
        console.error(`[telegram] Error stopping bot ${botId}:`, error);
        throw new Error(
          `Failed to stop bot: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  },
};

// Cleanup on process exit
process.on("SIGINT", async () => {
  console.log("[telegram] Cleaning up bots on SIGINT...");
  for (const [botId, instance] of bots.entries()) {
    try {
      if (instance.isPolling) {
        await instance.bot.stop();
      }
    } catch (error) {
      console.error(`[telegram] Error stopping bot ${botId}:`, error);
    }
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("[telegram] Cleaning up bots on SIGTERM...");
  for (const [botId, instance] of bots.entries()) {
    try {
      if (instance.isPolling) {
        await instance.bot.stop();
      }
    } catch (error) {
      console.error(`[telegram] Error stopping bot ${botId}:`, error);
    }
  }
  process.exit(0);
});

export default telegramPlugin;
