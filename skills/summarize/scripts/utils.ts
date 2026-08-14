/**
 * Shared helpers for the summarize skill: argv parsing and content extraction.
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

export function getOllamaConfig(): { url: string; model: string } {
  return {
    url: (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, ""),
    model: process.env.OLLAMA_MODEL || "qwen3:1.7b",
  };
}

type DiscordMessage = { content?: string; author?: { username?: string } };

/**
 * `--input` may be plain text, or the JSON-stringified result of a prior kata
 * phase's skill (e.g. discord's read_messages UseSkillResult wrapper:
 * { success, output: { messages: [...] }, logs }). Extract readable text
 * from either shape rather than summarizing raw JSON.
 */
export function extractContent(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (typeof parsed === "string") return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const output = (obj.output ?? obj) as Record<string, unknown> | undefined;
    const messages = output?.messages;
    if (Array.isArray(messages)) {
      return (messages as DiscordMessage[])
        .map((m) => `${m.author?.username ?? "unknown"}: ${m.content ?? ""}`)
        .join("\n");
    }
    if (typeof output?.text === "string") return output.text;
  }
  return raw;
}
