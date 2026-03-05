/**
 * List channels in a guild. Outputs JSON: { channels: Array<{ id, name, type }> }
 * Run: bun run scripts/list_channels.ts --guildId={guildId}
 */
import { parseArgs, getToken, discordFetch } from "./utils.js";

async function main() {
  const args = parseArgs();
  const guildId = args.guildId;
  if (!guildId) {
    console.log(JSON.stringify({ error: "Missing --guildId" }));
    process.exit(1);
  }
  const token = getToken();
  const res = await discordFetch(token, `/guilds/${guildId}/channels`);
  if (!res.ok) {
    const text = await res.text();
    console.log(JSON.stringify({ error: `Discord API ${res.status}: ${text}` }));
    process.exit(1);
  }
  const data = (await res.json()) as Array<{ id: string; name: string; type: number }>;
  const channels = data.map((ch) => ({
    id: ch.id,
    name: ch.name ?? String(ch.id),
    type: ch.type,
  }));
  console.log(JSON.stringify({ channels }));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
