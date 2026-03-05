import { homedir } from "os";
import { join } from "path";

type ResultRow = { file: string; line: number; text: string };

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function parseContentLines(content: string): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) continue;
    rows.push({
      file: match[1],
      line: Number(match[2]),
      text: match[3].trim(),
    });
  }
  return rows;
}

async function runRg(query: string, target: string): Promise<ResultRow[]> {
  const proc = Bun.spawn(
    ["rg", "--no-messages", "-n", "--hidden", "-S", query, target],
    { stdout: "pipe", stderr: "pipe" }
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return parseContentLines(stdout);
}

async function main(): Promise<void> {
  const query = (getArg("query") || "").trim();
  const limit = Number(getArg("limit") || "40");

  if (!query) {
    console.log(JSON.stringify({ error: "Missing --query" }));
    process.exit(1);
  }

  const roninDir = join(homedir(), ".ronin");
  const projectDir = process.cwd();
  const merged = [...await runRg(query, roninDir), ...await runRg(query, projectDir)];

  const unique = new Map<string, ResultRow>();
  for (const row of merged) {
    unique.set(`${row.file}:${row.line}:${row.text}`, row);
  }

  console.log(JSON.stringify({
    query,
    limit,
    results: Array.from(unique.values()).slice(0, Math.max(1, limit)),
  }));
}

void main();
