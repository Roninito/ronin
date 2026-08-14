/**
 * Send a message to a Telegram chat. Outputs JSON: { ok: true, messageId } or { error: "..." }
 * Run: bun run scripts/send_message.ts --content={content} --chatId={chatId} --parseMode={parseMode}
 */
import { parseArgs, getToken, getDefaultChatId, telegramFetch } from "./utils.js";

async function main() {
  const args = parseArgs();
  const content = args.content;
  if (content === undefined || content === null || content === "") {
    console.log(JSON.stringify({ error: "Missing --content" }));
    process.exit(1);
  }
  const chatId = args.chatId || getDefaultChatId();
  if (!chatId) {
    console.log(JSON.stringify({ error: "Missing --chatId and no default TELEGRAM_CHAT_ID configured" }));
    process.exit(1);
  }
  const token = getToken();
  const body: Record<string, unknown> = { chat_id: chatId, text: content };
  if (args.parseMode) body.parse_mode = args.parseMode;
  const res = await telegramFetch(token, "sendMessage", body);
  if (!res.ok) {
    const text = await res.text();
    console.log(JSON.stringify({ error: `Telegram API ${res.status}: ${text}` }));
    process.exit(1);
  }
  const data = (await res.json()) as { result: { message_id: number } };
  console.log(JSON.stringify({ ok: true, messageId: data.result.message_id }));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
