import type { Plugin } from "../src/plugins/base.js";
import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  EmbedBuilder,
  ChannelType,
} from "discord.js";

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

interface ClientInstance {
  client: Client;
  messageHandlers: Set<(message: DiscordMessage) => void>;
  readyHandlers: Set<() => void>;
}

const clients: Map<string, ClientInstance> = new Map();

/**
 * Discord plugin for interacting with Discord Bot API
 */
const discordPlugin: Plugin = {
  name: "discord",
  description: "Discord Bot API integration for sending messages, handling events, and managing bots",
  methods: {
    /**
     * Initialize a Discord bot client
     * @param token Discord Bot Token from Discord Developer Portal
     * @param options Optional configuration (intents array)
     * @returns Client ID for reference in other calls
     */
    initBot: async (
      token: string,
      options?: { intents?: number[] }
    ): Promise<string> => {
      if (!token || typeof token !== "string") {
        throw new Error("Discord bot token is required");
      }

      const clientId = `discord_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Default intents for basic bot functionality
      const defaultIntents = [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ];

      const intents = options?.intents || defaultIntents;
      const client = new Client({ intents });

      const instance: ClientInstance = {
        client,
        messageHandlers: new Set(),
        readyHandlers: new Set(),
      };

      // Set up ready handler
      client.once("ready", () => {
        console.log(`[discord] Bot logged in as ${client.user?.tag}`);
        instance.readyHandlers.forEach((handler) => {
          try {
            handler();
          } catch (error) {
            console.error(`[discord] Error in ready handler:`, error);
          }
        });
      });

      // Set up message handler wrapper
      client.on("messageCreate", (message: Message) => {
        const discordMessage: DiscordMessage = {
          id: message.id,
          content: message.content,
          author: {
            id: message.author.id,
            username: message.author.username,
            bot: message.author.bot,
          },
          channelId: message.channelId,
          guildId: message.guildId,
          timestamp: message.createdTimestamp,
        };

        instance.messageHandlers.forEach((handler) => {
          try {
            handler(discordMessage);
          } catch (error) {
            console.error(`[discord] Error in message handler:`, error);
          }
        });
      });

      try {
        await client.login(token);
        clients.set(clientId, instance);
        console.log(`[discord] Bot initialized: ${clientId}`);
        return clientId;
      } catch (error) {
        throw new Error(
          `Failed to initialize Discord bot: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Send a message to a channel
     * @param clientId ID from initBot
     * @param channelId Channel ID (numeric string)
     * @param content Message text
     * @param options Optional message options (embed object)
     */
    sendMessage: async (
      clientId: string,
      channelId: string,
      content: string,
      options?: { embed?: {
        title?: string;
        description?: string;
        color?: number;
        fields?: Array<{ name: string; value: string; inline?: boolean }>;
        footer?: string;
      } }
    ): Promise<void> => {
      const instance = clients.get(clientId);
      if (!instance) {
        throw new Error(`Client not initialized: ${clientId}`);
      }

      if (!content || typeof content !== "string") {
        throw new Error("Message content is required");
      }

      try {
        const channel = await instance.client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          throw new Error(`Invalid channel: ${channelId}`);
        }

        const messageOptions: { content: string; embeds?: any[] } = {
          content,
        };

        if (options?.embed) {
          const embed = new EmbedBuilder();
          if (options.embed.title) embed.setTitle(options.embed.title);
          if (options.embed.description) embed.setDescription(options.embed.description);
          if (options.embed.color) embed.setColor(options.embed.color);
          if (options.embed.fields) {
            embed.addFields(
              options.embed.fields.map((f) => ({
                name: f.name,
                value: f.value,
                inline: f.inline || false,
              }))
            );
          }
          if (options.embed.footer) embed.setFooter({ text: options.embed.footer });
          messageOptions.embeds = [embed];
        }

        await channel.send(messageOptions);
      } catch (error) {
        throw new Error(
          `Failed to send message: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Get recent messages from a channel
     * @param clientId ID from initBot
     * @param channelId Channel ID
     * @param options Optional parameters (limit, before message ID)
     * @returns Array of message contents
     */
    getMessages: async (
      clientId: string,
      channelId: string,
      options?: { limit?: number; before?: string }
    ): Promise<DiscordMessage[]> => {
      const instance = clients.get(clientId);
      if (!instance) {
        throw new Error(`Client not initialized: ${clientId}`);
      }

      try {
        const channel = await instance.client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          throw new Error(`Invalid channel: ${channelId}`);
        }

        const fetchOptions: { limit: number; before?: string } = {
          limit: options?.limit || 10,
        };
        if (options?.before) {
          fetchOptions.before = options.before;
        }

        const messages = await channel.messages.fetch(fetchOptions);
        return Array.from(messages.values()).map((msg) => ({
          id: msg.id,
          content: msg.content,
          author: {
            id: msg.author.id,
            username: msg.author.username,
            bot: msg.author.bot,
          },
          channelId: msg.channelId,
          guildId: msg.guildId,
          timestamp: msg.createdTimestamp,
        }));
      } catch (error) {
        throw new Error(
          `Failed to get messages: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Register a message event handler
     * @param clientId ID from initBot
     * @param callback Callback function to handle messages
     */
    onMessage: (clientId: string, callback: (message: DiscordMessage) => void): void => {
      const instance = clients.get(clientId);
      if (!instance) {
        throw new Error(`Client not initialized: ${clientId}`);
      }

      instance.messageHandlers.add(callback);
    },

    /**
     * Register a ready event handler
     * @param clientId ID from initBot
     * @param callback Callback function called when bot is ready
     */
    onReady: (clientId: string, callback: () => void): void => {
      const instance = clients.get(clientId);
      if (!instance) {
        throw new Error(`Client not initialized: ${clientId}`);
      }

      instance.readyHandlers.add(callback);

      // If already ready, call immediately
      if (instance.client.isReady()) {
        try {
          callback();
        } catch (error) {
          console.error(`[discord] Error in ready handler:`, error);
        }
      }
    },

    /**
     * Get invite information (bots are added via OAuth2, not by accepting invites)
     * @param clientId ID from initBot
     * @param inviteCode Discord invite code (without discord.gg/)
     * @returns Invite information
     */
    joinGuild: async (clientId: string, inviteCode: string): Promise<{
      code: string;
      guild?: { id: string; name: string };
      channel?: { id: string; name: string };
    }> => {
      const instance = clients.get(clientId);
      if (!instance) {
        throw new Error(`Client not initialized: ${clientId}`);
      }

      try {
        const invite = await instance.client.fetchInvite(inviteCode);
        console.log(`[discord] Fetched invite info: ${inviteCode}`);
        return {
          code: invite.code,
          guild: invite.guild ? { id: invite.guild.id, name: invite.guild.name } : undefined,
          channel: invite.channel ? { id: invite.channel.id, name: invite.channel.name } : undefined,
        };
      } catch (error) {
        throw new Error(
          `Failed to fetch invite: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Get channel information
     * @param clientId ID from initBot
     * @param channelId Channel ID
     * @returns Channel information object
     */
    getChannel: async (
      clientId: string,
      channelId: string
    ): Promise<{
      id: string;
      name: string;
      type: string;
      guildId: string | null;
    }> => {
      const instance = clients.get(clientId);
      if (!instance) {
        throw new Error(`Client not initialized: ${clientId}`);
      }

      try {
        const channel = await instance.client.channels.fetch(channelId);
        if (!channel) {
          throw new Error(`Channel not found: ${channelId}`);
        }

        return {
          id: channel.id,
          name: channel.isTextBased() ? (channel as TextChannel).name : "Unknown",
          type: ChannelType[channel.type] || "Unknown",
          guildId: channel.guildId,
        };
      } catch (error) {
        throw new Error(
          `Failed to get channel: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
  },
};

export default discordPlugin;
