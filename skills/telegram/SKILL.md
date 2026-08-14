---
name: Telegram
description: Send messages via Ronin's Telegram bot.
---

# Telegram Skill

Send a message to a Telegram chat using the Telegram Bot API.

## When to Use

- Post a summary, alert, or notification to Telegram (e.g. from a scheduled contract/kata)
- Send a message to a specific chat/channel ID, or to the configured default chat when none is given

## Requirements

- `TELEGRAM_BOT_TOKEN` in environment or Ronin config (`telegram.botToken`)
- `TELEGRAM_CHAT_ID` in environment or Ronin config (`telegram.chatId`) — used as the default `chatId` when the ability isn't given one explicitly

## Abilities

### send_message
Send a message to a chat.
- Input: content (string), chatId (optional string — defaults to the configured chat), parseMode (optional: "HTML" | "Markdown" | "MarkdownV2")
- Output: { ok: true, messageId } or error
- Run: bun run scripts/send_message.ts --content={content} --chatId={chatId} --parseMode={parseMode}
