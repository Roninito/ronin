/**
 * Create or overwrite a text file. Path is relative to ~/.ronin/workspace or under ~/.ronin.
 * Params: --path=... --content=...
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function parseArgs(): { path: string; content: string } {
  const args = process.argv.slice(2);
  let path = "";
  let content = "";
  for (const a of args) {
    if (a.startsWith("--path=")) path = a.slice(7).trim();
    if (a.startsWith("--content=")) content = a.slice(10).trim();
  }
  return { path, content };
}

function resolvePath(relativePath: string): string {
  const ronin = join(homedir(), ".ronin");
  const workspace = join(ronin, "workspace");
  const normalized = relativePath.replace(/^\.\//, "").replace(/\/+/g, "/").trim();
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error("Path must be relative and not contain ..");
  }
  if (normalized.startsWith("skills/") || normalized.startsWith("workspace/")) {
    return join(ronin, normalized);
  }
  return join(workspace, normalized);
}

function main(): void {
  const { path: relPath, content } = parseArgs();
  if (!relPath) {
    console.log(JSON.stringify({ success: false, error: "path is required" }));
    process.exit(1);
  }
  try {
    const fullPath = resolvePath(relPath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
    console.log(JSON.stringify({ success: true, path: fullPath, created: true }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
}

main();
