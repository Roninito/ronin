/**
 * List guilds (servers) the bot is in. Outputs JSON: { guilds: Array<{ id, name }> }
 */
import { getToken, discordFetch } from "./utils.js";

async function main() {
  const token = getToken();
  const res = await discordFetch(token, "/users/@me/guilds");
  if (!res.ok) {
    const text = await res.text();
    console.log(JSON.stringify({ error: `Discord API ${res.status}: ${text}` }));
    process.exit(1);
  }
  const data = (await res.json()) as Array<{ id: string; name: string }>;
  const guilds = data.map((g) => ({ id: g.id, name: g.name }));
  console.log(JSON.stringify({ guilds }));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
