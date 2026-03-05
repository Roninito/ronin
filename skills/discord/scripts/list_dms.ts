/**
 * List DM channels the bot has. Outputs JSON: { dms: Array<{ id, recipient?: { id, username } }> }
 */
import { getToken, discordFetch } from "./utils.js";

async function main() {
  const token = getToken();
  const res = await discordFetch(token, "/users/@me/channels");
  if (!res.ok) {
    const text = await res.text();
    console.log(JSON.stringify({ error: `Discord API ${res.status}: ${text}` }));
    process.exit(1);
  }
  const data = (await res.json()) as Array<{
    id: string;
    recipients?: Array<{ id: string; username: string }>;
  }>;
  const dms = data.map((ch) => ({
    id: ch.id,
    recipient: ch.recipients?.[0]
      ? { id: ch.recipients[0].id, username: ch.recipients[0].username }
      : undefined,
  }));
  console.log(JSON.stringify({ dms }));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
