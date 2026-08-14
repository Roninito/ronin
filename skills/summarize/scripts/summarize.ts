/**
 * Summarize text with the locally-configured Ollama model. Outputs JSON:
 * { summary } or { error }
 * Run: bun run scripts/summarize.ts --input={input} --instructions={instructions}
 */
import { parseArgs, getOllamaConfig, extractContent } from "./utils.js";

async function main() {
  const args = parseArgs();
  if (!args.input) {
    console.log(JSON.stringify({ error: "Missing --input" }));
    process.exit(1);
  }
  const content = extractContent(args.input);
  if (!content.trim()) {
    console.log(JSON.stringify({ summary: "(nothing to summarize)" }));
    return;
  }
  const instructions = args.instructions || "Summarize the following concisely, in a few sentences or a short bullet list.";
  const { url, model } = getOllamaConfig();

  const res = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: `${instructions}\n\n${content}`,
      stream: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.log(JSON.stringify({ error: `Ollama API ${res.status}: ${text}` }));
    process.exit(1);
  }
  const data = (await res.json()) as { response: string };
  console.log(JSON.stringify({ summary: data.response.trim() }));
}

main().catch((err) => {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
