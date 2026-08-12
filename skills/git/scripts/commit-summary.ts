/**
 * Generate a formatted AI summary of recent commits.
 * Params: --count=10 (optional) --repoPath=. (optional, defaults to cwd)
 *
 * Shells out to `git log --stat` directly (same subprocess pattern
 * plugins/git.ts uses) for the raw diff-stat data, then calls Ollama
 * directly over HTTP for the summary — skill scripts run as detached
 * subprocesses with no access to api.ai, so this follows
 * mermaid-diagram-generator's OLLAMA_HOST/OLLAMA_MODEL + raw fetch() pattern.
 */

function parseArgs(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...v] = arg.slice(2).split("=");
      out[key] = v.join("=").trim();
    }
  }
  return out;
}

async function getGitLog(repoPath: string, count: number): Promise<string> {
  const proc = Bun.spawn(["git", "-C", repoPath, "log", `-${count}`, "--stat"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`git log failed: ${stderr}`);
  }
  return stdout;
}

function countFilesChanged(gitLogStat: string): number {
  const files = new Set<string>();
  for (const line of gitLogStat.split("\n")) {
    // Stat lines look like " src/foo.ts | 12 +++++-----"
    const match = line.match(/^\s([^\s|]+)\s+\|\s+\d+/);
    if (match) files.add(match[1]);
  }
  return files.size;
}

async function summarize(gitLogStat: string): Promise<string> {
  const base = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "phi3";
  const prompt = `Summarize these git commits into a short, readable changelog. Group related changes, use bullet points, be concise. Output ONLY the summary — no preamble, no explanation.\n\n${gitLogStat}`;

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
    const summary = (data.response ?? "").trim();
    if (!summary) throw new Error("Ollama returned an empty summary");
    return summary;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main(): Promise<void> {
  try {
    const args = parseArgs();
    const count = args.count ? Math.max(1, parseInt(args.count, 10) || 10) : 10;
    const repoPath = args.repoPath || process.cwd();

    const gitLogStat = await getGitLog(repoPath, count);
    const filesChanged = countFilesChanged(gitLogStat);
    const summary = await summarize(gitLogStat);

    console.log(JSON.stringify({ success: true, summary, files_changed: filesChanged }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
}

main();
