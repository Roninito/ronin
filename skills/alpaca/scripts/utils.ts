/**
 * Shared helpers for Alpaca skill scripts: argv parsing and the Alpaca REST API.
 * Same endpoints/headers as plugins/alpaca.ts, but credentials come from env
 * vars (ALPACA_API_KEY / ALPACA_API_SECRET / ALPACA_MODE) since skill scripts
 * run as detached subprocesses with no access to ConfigService.
 */

const LIVE_BASE = "https://api.alpaca.markets";
const PAPER_BASE = "https://paper-api.alpaca.markets";

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

export function getCredentials(): { key: string; secret: string; base: string } {
  const key = process.env.ALPACA_API_KEY?.trim();
  const secret = process.env.ALPACA_API_SECRET?.trim();
  if (!key || !secret) {
    console.log(JSON.stringify({ success: false, error: "ALPACA_API_KEY / ALPACA_API_SECRET are not set" }));
    process.exit(1);
  }
  const mode = (process.env.ALPACA_MODE?.trim().toLowerCase() === "live") ? "live" : "paper";
  return { key, secret, base: mode === "live" ? LIVE_BASE : PAPER_BASE };
}

export async function alpacaFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { key, secret, base } = getCredentials();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Alpaca API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
