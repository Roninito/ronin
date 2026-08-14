/**
 * Shared helpers for Telegram skill scripts: argv parsing and Telegram Bot API.
 */

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
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.log(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN is not set" }));
    process.exit(1);
  }
  return token;
}

export function getDefaultChatId(): string | undefined {
  return process.env.TELEGRAM_CHAT_ID?.trim() || undefined;
}

export async function telegramFetch(
  token: string,
  method: string,
  body: Record<string, unknown>
): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
