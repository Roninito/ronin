---
name: Discord
description: Traverse Discord (guilds, channels, DMs), read and send messages; use with Ronin's Discord bot.
---

# Discord Skill

List guilds (servers), channels, and DMs the bot can see; read and send messages in any channel. Uses the Discord REST API with the bot token.

## When to Use

- List servers (guilds) the bot is in
- List channels in a server
- List DM channels with the bot
- Read recent messages in a channel (guild or DM)
- Send a message to a channel (guild or DM)

## Requirements

- `DISCORD_BOT_TOKEN` in environment or Ronin config (`discord.botToken`)
- Bot must be in the guilds you list; for DMs, enable **Direct Messages** in Discord Developer Portal (Bot → Privileged Gateway Intents)

**Private chat participation:** When a user DMs the bot, the running Ronin agent (intent-ingress) replies in that DM. Enable Discord in config and ensure the bot has the Direct Messages intent. No extra skill ability is needed for conversation.

## Abilities

### list_guilds
List guilds (servers) the bot is in.
- Input: none
- Output: { guilds: Array<{ id, name }> }
- Run: bun run scripts/list_guilds.ts

### list_channels
List channels in a guild.
- Input: guildId (string)
- Output: { channels: Array<{ id, name, type }> }
- Run: bun run scripts/list_channels.ts --guildId={guildId}

### list_dms
List DM channels the bot has.
- Input: none
- Output: { dms: Array<{ id, recipient?: { id, username } }> }
- Run: bun run scripts/list_dms.ts

### read_messages
Get recent messages in a channel.
- Input: channelId (string), limit (optional number), before (optional message id)
- Output: { messages: Array<{ id, content, author, timestamp }> }
- Run: bun run scripts/read_messages.ts --channelId={channelId} --limit={limit}

### send_message
Send a message to a channel.
- Input: channelId (string), content (string)
- Output: { ok: true, messageId } or error
- Run: bun run scripts/send_message.ts --channelId={channelId} --content={content}
