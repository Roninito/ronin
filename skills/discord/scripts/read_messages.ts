/**
 * Get recent messages in a channel. Outputs JSON: { messages: Array<{ id, content, author, timestamp }> }
 * Run: bun run scripts/read_messages.ts --channelId={channelId} --limit={limit} --before={messageId}
 */
import { parseArgs, getToken, discordFetch } from "./utils.js";

async function main() {
  const args = parseArgs();
  const channelId = args.channelId;
  if (!channelId) {
    console.log(JSON.stringify({ error: "Missing --channelId" }));
    process.exit(1);
  }
  const limit = args.limit ? Math.min(100, Math.max(1, parseInt(args.limit, 10))) : 10;
  const before = args.before ?? "";
  const token = getToken();
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set("before", before);
  const res = await discordFetch(
    token,
    `/channels/${channelId}/messages?${params.toString()}`
  );
  if (!res.ok) {
    const text = await res.text();
    console.log(JSON.stringify({ error: `Discord API ${res.status}: ${text}` }));
    process.exit(1);
  }
  const data = (await res.json()) as Array<{
    id: string;
    content: string;
    author: { id: string; username: string; bot?: boolean };
    timestamp: string;
  }>;
  const messages = data.map((m) => ({
    id: m.id,
    content: m.content,
    author: { id: m.author.id, username: m.author.username, bot: m.author.bot ?? false },
    timestamp: m.timestamp,
  }));
  console.log(JSON.stringify({ messages }));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
