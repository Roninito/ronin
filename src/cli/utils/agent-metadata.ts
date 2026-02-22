import { readdir, readFile } from "fs/promises";
import { extname, basename, join } from "path";

export interface AgentFileMetadata {
  name: string;
  filePath: string;
  schedule?: string;
  watch?: string[];
  webhook?: string;
}

async function discoverRecursive(dir: string, files: string[]): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await discoverRecursive(fullPath, files);
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (ext === ".ts" || ext === ".js") {
          if (entry.name.includes(".test.") || entry.name.includes(".spec.")) {
            continue;
          }
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Directory may not exist; ignore.
  }
}

function parseWatchArray(content: string): string[] | undefined {
  const watchMatch = content.match(/static\s+watch\s*=\s*\[([\s\S]*?)\]\s*;?/);
  if (!watchMatch || !watchMatch[1]) return undefined;
  const quoted = Array.from(watchMatch[1].matchAll(/["'`]([^"'`]+)["'`]/g)).map((m) => m[1]);
  return quoted.length > 0 ? quoted : undefined;
}

async function parseMetadata(filePath: string): Promise<AgentFileMetadata> {
  const content = await readFile(filePath, "utf-8");
  const schedule = content.match(/static\s+schedule\s*=\s*["'`]([^"'`]+)["'`]\s*;?/)?.[1];
  const webhook = content.match(/static\s+webhook\s*=\s*["'`]([^"'`]+)["'`]\s*;?/)?.[1];
  const watch = parseWatchArray(content);

  return {
    name: basename(filePath).replace(/\.(ts|js)$/, ""),
    filePath,
    schedule,
    webhook,
    watch,
  };
}

export async function loadAgentFileMetadata(
  agentDir: string,
  externalAgentDir?: string | null
): Promise<AgentFileMetadata[]> {
  const files: string[] = [];
  await discoverRecursive(agentDir, files);
  if (externalAgentDir && externalAgentDir !== agentDir) {
    await discoverRecursive(externalAgentDir, files);
  }

  const metadata = await Promise.all(
    files.map(async (filePath) => {
      try {
        return await parseMetadata(filePath);
      } catch {
        return null;
      }
    })
  );

  return metadata.filter((item): item is AgentFileMetadata => item !== null);
}
