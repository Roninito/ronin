import { readFileSync } from "fs";
import { resolve } from "path";

const packageJsonPath = resolve(import.meta.dir, "../../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

export const RONIN_VERSION = packageJson.version as string;

export async function getLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/roninito/ronin/releases/latest",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { tag_name: string };
    return data.tag_name.replace(/^v/, "");
  } catch {
    return null;
  }
}

export function compareVersions(current: string, latest: string): number {
  const parseVersion = (v: string) => v.split(".").map(Number);
  const [currMajor = 0, currMinor = 0, currPatch = 0] = parseVersion(current);
  const [latestMajor = 0, latestMinor = 0, latestPatch = 0] = parseVersion(latest);

  if (latestMajor > currMajor) return 1;
  if (latestMajor < currMajor) return -1;
  if (latestMinor > currMinor) return 1;
  if (latestMinor < currMinor) return -1;
  if (latestPatch > currPatch) return 1;
  if (latestPatch < currPatch) return -1;
  return 0;
}

export function isUpdateAvailable(current: string, latest: string): boolean {
  return compareVersions(current, latest) > 0;
}
