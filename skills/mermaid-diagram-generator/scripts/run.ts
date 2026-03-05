import { readFileSync, existsSync } from "fs";

function getInput(): string {
  const args = process.argv.slice(2);
  for (const a of args) {
    if (a.startsWith("--input=")) return a.slice(8).trim();
  }
  if (process.env.INPUT) return process.env.INPUT.trim();
  if (existsSync("input.txt")) return readFileSync("input.txt", "utf-8").trim();
  return "";
}

function isMermaidCode(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  const hasArrows = /-->|->>|--x|-.->|\|/.test(t);
  const hasNodes = /\[[^\]]+\]|\([^\)]+\)|\{[^\}]+\}/.test(t);
  const hasConnections = /[A-Za-z0-9]+\s*-->/.test(t);
  const firstLine = t.split('\n')[0] || '';
  const startsWithKeyword = /^(flowchart|sequenceDiagram|graph|classDiagram|erDiagram|journey|gantt|pie|stateDiagram)\s*(TD|LR|TB|BT|RL|CD)?/.test(firstLine);
  return (startsWithKeyword && (hasArrows || hasNodes || hasConnections)) || 
         (/^(sequenceDiagram|classDiagram|erDiagram|journey|gantt|pie|stateDiagram)/.test(t) && t.includes('\n'));
}

function extractMermaidDiagram(raw: string): string {
  let t = raw.trim();
  const fenced = t.match(/```(?:mermaid)?\s*\n?([\s\S]*?)\n?```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const lines = t.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^(flowchart|sequenceDiagram|graph\s)/i.test(line)) {
      start = i;
      break;
    }
  }
  if (start >= 0) return lines.slice(start).join("\n").trim();
  return t;
}

async function generateMermaidDiagram(description: string): Promise<string> {
  const base = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "phi3";
  const prompt = `Write a simple mermaid flowchart. Use basic syntax with clear steps. Output ONLY mermaid code - no markdown code fences, no backticks, no explanation. Just the diagram.

Topic: ${description}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  
  try {
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { response?: string };
    const raw = data.response ?? "";
    const diagram = extractMermaidDiagram(raw);
    if (!diagram) throw new Error("Ollama returned empty diagram");
    return diagram.trim();
  } finally {
    clearTimeout(timeoutId);
  }
}

function mermaidLiveUrl(diagram: string): string {
  const code = diagram.trim();
  const payload = JSON.stringify({ code, mermaid: {} });
  const base64 = Buffer.from(payload, "utf-8").toString("base64");
  const base64url = base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `https://mermaid.live/edit#base64:${base64url}`;
}

function decodeMermaidLiveUrl(url: string): string | null {
  const prefix = "https://mermaid.live/edit#base64:";
  if (!url.startsWith(prefix)) return null;
  const base64url = url.slice(prefix.length);
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    const json = Buffer.from(padded, "base64").toString("utf-8");
    return (JSON.parse(json) as { code?: string }).code ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  try {
    const input = getInput() || "simple flowchart";
    let diagram: string;
    let success = true;
    let error: string | undefined;

    if (isMermaidCode(input)) {
      diagram = input.trim();
    } else {
      try {
        diagram = await generateMermaidDiagram(input);
      } catch (e) {
        success = false;
        error = e instanceof Error ? e.message : String(e);
        diagram = "";
      }
    }

    const diagramOut = diagram?.trim() ?? "";
    const url = diagramOut ? mermaidLiveUrl(diagramOut) : "";
    const urlOk = !url || (decodeMermaidLiveUrl(url) === diagramOut);
    console.log(
      JSON.stringify({
        success,
        diagram: diagramOut || undefined,
        input: input ? (isMermaidCode(input) ? "(provided)" : input) : "(default)",
        ...(url && urlOk && { url }),
        ...(error && { error }),
      })
    );
  } catch (err) {
    console.log(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    process.exit(1);
  }
}

main();
