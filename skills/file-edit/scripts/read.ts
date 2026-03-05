/**
 * Read a text file. Path is relative to ~/.ronin/workspace or under ~/.ronin.
 * Params: --path=...
 */
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function parseArgs(): { path: string } {
  const args = process.argv.slice(2);
  let path = "";
  for (const a of args) {
    if (a.startsWith("--path=")) path = a.slice(7).trim();
  }
  return { path };
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
  const { path: relPath } = parseArgs();
  if (!relPath) {
    console.log(JSON.stringify({ success: false, error: "path is required" }));
    process.exit(1);
  }
  try {
    const fullPath = resolvePath(relPath);
    const content = readFileSync(fullPath, "utf-8");
    console.log(JSON.stringify({ success: true, path: fullPath, content }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
}

main();
