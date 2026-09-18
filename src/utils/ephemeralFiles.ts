/**
 * Ephemeral file TTL — deletes a file automatically a fixed time after capture.
 *
 * Used for content that must never linger on disk (e.g. on-demand screenshots
 * sent to a model for analysis). The clock starts at registration and is never
 * reset by later reads, so "saved for a minute" means a hard minute, not a
 * minute since last access.
 */

import { readdir, readFile, unlink } from "fs/promises";
import { join } from "path";

export const DEFAULT_EPHEMERAL_TTL_MS = 60_000;

const SIDECAR_SUFFIX = ".expires";

/**
 * Schedules `path` for deletion after `ttlMs`. Also writes a `${path}.expires`
 * sidecar recording the deadline, so a crash/restart before the timer fires
 * leaves a discoverable orphan (see sweepExpiredEphemeralFiles) instead of a
 * silent leak.
 */
export function registerEphemeralFile(path: string, ttlMs: number = DEFAULT_EPHEMERAL_TTL_MS): void {
  const deadline = Date.now() + ttlMs;
  const sidecarPath = `${path}${SIDECAR_SUFFIX}`;

  void Bun.write(sidecarPath, String(deadline)).catch(() => {});

  setTimeout(() => {
    void unlink(path).catch(() => {});
    void unlink(sidecarPath).catch(() => {});
  }, ttlMs);
}

/**
 * Scans `dir` for `.expires` sidecars whose recorded deadline has already
 * passed and deletes both the sidecar and its target file. Call this once at
 * startup to clean up files orphaned by a crash or restart, since the
 * in-memory setTimeout from registerEphemeralFile never fires in that case.
 * Returns the number of expired files removed.
 */
export async function sweepExpiredEphemeralFiles(dir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }

  const now = Date.now();
  let removed = 0;

  for (const entry of entries) {
    if (!entry.endsWith(SIDECAR_SUFFIX)) continue;

    const sidecarPath = join(dir, entry);
    const targetPath = sidecarPath.slice(0, -SIDECAR_SUFFIX.length);

    try {
      const deadline = Number((await readFile(sidecarPath, "utf-8")).trim());
      if (!Number.isFinite(deadline) || deadline > now) continue;

      await unlink(targetPath).catch(() => {});
      await unlink(sidecarPath).catch(() => {});
      removed++;
    } catch {
      // Sidecar unreadable/already gone — skip it.
    }
  }

  return removed;
}
