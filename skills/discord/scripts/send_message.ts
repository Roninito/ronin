/**
 * Send a message to a channel. Outputs JSON: { ok: true, messageId } or { error: "..." }
 * Run: bun run scripts/send_message.ts --channelId={channelId} --content={content}
 */
import { parseArgs, getToken, discordFetch } from "./utils.js";

async function main() {
  const args = parseArgs();
  const channelId = args.channelId;
  const content = args.content;
  if (!channelId) {
    console.log(JSON.stringify({ error: "Missing --channelId" }));
    process.exit(1);
  }
  if (content === undefined || content === null) {
    console.log(JSON.stringify({ error: "Missing --content" }));
    process.exit(1);
  }
  const token = getToken();
  const res = await discordFetch(token, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: String(content) }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.log(JSON.stringify({ error: `Discord API ${res.status}: ${text}` }));
    process.exit(1);
  }
  const data = (await res.json()) as { id: string };
  console.log(JSON.stringify({ ok: true, messageId: data.id }));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
