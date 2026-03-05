/**
 * Shared helpers for Discord skill scripts: argv parsing and Discord REST API.
 */

const DISCORD_API = "https://discord.com/api/v10";

export function parseArgs(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...v] = arg.slice(2).split("=");
      out[key] = v.join("=").trim();
    }
  }
  return out;
}

export function getToken(): string {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    console.log(JSON.stringify({ error: "DISCORD_BOT_TOKEN is not set" }));
    process.exit(1);
  }
  return token;
}

export async function discordFetch(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${DISCORD_API}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });
}
