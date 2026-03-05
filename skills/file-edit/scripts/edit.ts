/**
 * Append or replace content in a file. Path relative to ~/.ronin/workspace.
 * Params: --path=... --content=... --mode=append|replace
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function parseArgs(): { path: string; content: string; mode: string } {
  const args = process.argv.slice(2);
  let path = "";
  let content = "";
  let mode = "replace";
  for (const a of args) {
    if (a.startsWith("--path=")) path = a.slice(7).trim();
    if (a.startsWith("--content=")) content = a.slice(10).trim();
    if (a.startsWith("--mode=")) mode = a.slice(7).trim().toLowerCase();
  }
  return { path, content, mode };
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
  const { path: relPath, content, mode } = parseArgs();
  if (!relPath) {
    console.log(JSON.stringify({ success: false, error: "path is required" }));
    process.exit(1);
  }
  try {
    const fullPath = resolvePath(relPath);
    const existing = mode === "append" ? readFileSync(fullPath, "utf-8") : "";
    const newContent = mode === "append" ? existing + content : content;
    writeFileSync(fullPath, newContent, "utf-8");
    console.log(JSON.stringify({ success: true, path: fullPath, mode, updated: true }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
}

main();
