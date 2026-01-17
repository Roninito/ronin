import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

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
 * Discord Bridge agent demonstrating Discord bot functionality
 * Responds to commands and can bridge messages between Discord and Telegram
 */
export default class DiscordBridgeAgent extends BaseAgent {
  // No schedule - runs continuously via event handlers
  // static schedule = undefined;

  private clientId: string | null = null;

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    console.log("[discord-bridge] Initializing Discord bot...");

    // Check if Discord plugin is available
    if (!this.api.discord) {
      console.error("[discord-bridge] Discord plugin not available");
      return;
    }

    // Get Discord bot token from memory or env
    const token = (process.env.DISCORD_BOT_TOKEN ||
      (await this.api.memory.retrieve("discord_bot_token"))) as string | undefined;

    if (!token) {
      console.error("[discord-bridge] Discord bot token not configured. Set DISCORD_BOT_TOKEN env var or store in memory as 'discord_bot_token'");
      return;
    }

    // Initialize bot if not already initialized
    this.clientId = (await this.api.memory.retrieve("discord_client_id")) as string | undefined;
    if (!this.clientId) {
      try {
        this.clientId = await this.api.discord.initBot(token);
        await this.api.memory.store("discord_client_id", this.clientId);
        console.log(`[discord-bridge] Initialized Discord bot: ${this.clientId}`);
      } catch (error) {
        console.error(`[discord-bridge] Failed to initialize bot:`, error);
        return;
      }
    }

    // Set up event handlers
    this.setupHandlers();

    console.log("[discord-bridge] ✅ Bot initialized and ready");
  }

  /**
   * Set up Discord event handlers
   */
  private setupHandlers(): void {
    if (!this.api.discord || !this.clientId) {
      return;
    }

    // Handle ready event
    this.api.discord.onReady(this.clientId, () => {
      console.log("[discord-bridge] Bot is ready!");
    });

    // Handle messages
    this.api.discord.onMessage(this.clientId, async (message: DiscordMessage) => {
      await this.handleMessage(message);
    });
  }

  /**
   * Handle incoming Discord messages
   */
  private async handleMessage(message: DiscordMessage): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) {
      return;
    }

    // Handle commands
    if (message.content.startsWith("!ping")) {
      await this.handlePingCommand(message);
    } else if (message.content.startsWith("!help")) {
      await this.handleHelpCommand(message);
    } else if (message.content.startsWith("!bridge")) {
      await this.handleBridgeCommand(message);
    }

    // Emit event for other agents
    this.api.events.beam(["rss-feed", "telegram-subscription"], "discord-message", {
      message_id: message.id,
      channel_id: message.channelId,
      author: message.author.username,
      content: message.content,
      timestamp: message.timestamp,
    });
  }

  /**
   * Handle !ping command
   */
  private async handlePingCommand(message: DiscordMessage): Promise<void> {
    if (!this.api.discord || !this.clientId) {
      return;
    }

    try {
      await this.api.discord.sendMessage(
        this.clientId,
        message.channelId,
        "Pong! 🏓"
      );
      console.log(`[discord-bridge] Responded to ping from ${message.author.username}`);
    } catch (error) {
      console.error(`[discord-bridge] Failed to send ping response:`, error);
    }
  }

  /**
   * Handle !help command
   */
  private async handleHelpCommand(message: DiscordMessage): Promise<void> {
    if (!this.api.discord || !this.clientId) {
      return;
    }

    const helpText = `
**Discord Bridge Bot Commands:**

\`!ping\` - Test bot responsiveness
\`!help\` - Show this help message
\`!bridge <message>\` - Bridge message to Telegram (if configured)

This bot is part of the Ronin agent system.
    `.trim();

    try {
      await this.api.discord.sendMessage(
        this.clientId,
        message.channelId,
        helpText
      );
    } catch (error) {
      console.error(`[discord-bridge] Failed to send help:`, error);
    }
  }

  /**
   * Handle !bridge command - bridge message to Telegram
   */
  private async handleBridgeCommand(message: DiscordMessage): Promise<void> {
    if (!this.api.discord || !this.clientId) {
      return;
    }

    // Extract message to bridge
    const bridgeText = message.content.replace(/^!bridge\s+/, "").trim();
    if (!bridgeText) {
      try {
        await this.api.discord.sendMessage(
          this.clientId,
          message.channelId,
          "Usage: `!bridge <message>`"
        );
      } catch (error) {
        // Ignore errors
      }
      return;
    }

    // Check if Telegram is available
    if (!this.api.telegram) {
      try {
        await this.api.discord.sendMessage(
          this.clientId,
          message.channelId,
          "Telegram plugin not available"
        );
      } catch (error) {
        // Ignore errors
      }
      return;
    }

    // Get Telegram chat ID
    const telegramChatId = (process.env.TELEGRAM_CHAT_ID ||
      (await this.api.memory.retrieve("telegram_chat_id"))) as string | number | undefined;

    if (!telegramChatId) {
      try {
        await this.api.discord.sendMessage(
          this.clientId,
          message.channelId,
          "Telegram chat ID not configured"
        );
      } catch (error) {
        // Ignore errors
      }
      return;
    }

    // Get Telegram bot ID
    const telegramBotId = (await this.api.memory.retrieve("telegram_bot_id")) as string | undefined;
    if (!telegramBotId) {
      try {
        await this.api.discord.sendMessage(
          this.clientId,
          message.channelId,
          "Telegram bot not initialized"
        );
      } catch (error) {
        // Ignore errors
      }
      return;
    }

    // Send to Telegram
    try {
      const telegramMessage = `📨 From Discord (${message.author.username}):\n\n${bridgeText}`;
      await this.api.telegram.sendMessage(telegramBotId, telegramChatId, telegramMessage);

      // Confirm in Discord
      await this.api.discord.sendMessage(
        this.clientId,
        message.channelId,
        `✅ Bridged to Telegram: "${bridgeText.substring(0, 50)}${bridgeText.length > 50 ? "..." : ""}"`
      );

      console.log(`[discord-bridge] Bridged message from ${message.author.username} to Telegram`);
    } catch (error) {
      console.error(`[discord-bridge] Failed to bridge message:`, error);
      try {
        await this.api.discord.sendMessage(
          this.clientId,
          message.channelId,
          "❌ Failed to bridge message to Telegram"
        );
      } catch (err) {
        // Ignore errors
      }
    }
  }
}
