/**
 * Single-instance lock for the Ronin server process.
 *
 * Before this existed, the ONLY thing stopping two `ronin start` invocations from
 * running side by side was whichever one happened to bind the webhook port first —
 * and that check only fires deep into startup (after duty/plugin/kata loading), and
 * only in the plain `start` path. `--ninja`, `--daemon`, and `interactive` each had
 * their own bespoke (or nonexistent) checks:
 *   - `--daemon` wrote a PID file in the parent immediately after spawning the child,
 *     with no confirmation the child actually started — a child that lost the port
 *     race died instantly, leaving the PID file pointing at a dead process forever.
 *   - `--ninja` had no check at all.
 *   - `interactive` had no check at all, and would crash on an unhandled rejection
 *     instead of a clean message if the port was taken.
 * Any of these could leave (or spawn) extra live processes that `ronin stop`/`kill`
 * — which only ever discover the ONE process currently answering the HTTP port —
 * would never find or clean up.
 *
 * This module is the one shared source of truth all four launch paths check FIRST,
 * before any duty/plugin work begins, closing that race window.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync, constants } from "fs";
import { join } from "path";
import { homedir } from "os";

export const INSTANCE_PID_PATH = join(homedir(), ".ronin", "ronin.pid");

/** True if a process with this PID exists (signal 0 sends nothing, just checks). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Read the lock file's PID, or null if absent/unparsable. Does not check liveness. */
function readLockPid(): number | null {
  try {
    if (!existsSync(INSTANCE_PID_PATH)) return null;
    const pid = parseInt(readFileSync(INSTANCE_PID_PATH, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Check for a live Ronin instance without acquiring the lock. Clears the lock file
 * if it points at a dead PID (stale from a crash or an unclean kill -9).
 */
export function getRunningInstancePid(): number | null {
  const pid = readLockPid();
  if (pid === null) return null;
  if (isProcessAlive(pid)) return pid;
  try { unlinkSync(INSTANCE_PID_PATH); } catch { /* already gone */ }
  return null;
}

export class AlreadyRunningError extends Error {
  constructor(public readonly pid: number) {
    super(`Ronin is already running (PID ${pid}).`);
    this.name = "AlreadyRunningError";
  }
}

/**
 * Atomically acquire the single-instance lock for the current process, or throw
 * AlreadyRunningError if a live instance already holds it.
 *
 * Uses an exclusive create (fails if the file exists) rather than check-then-write,
 * so two processes racing to start at the same instant can't both "win" the check
 * before either writes — whichever's `open(..., wx)` call lands first gets the lock.
 */
export function acquireInstanceLock(): void {
  const existing = getRunningInstancePid(); // clears a stale lock as a side effect
  if (existing !== null) {
    throw new AlreadyRunningError(existing);
  }
  try {
    const fd = openSync(INSTANCE_PID_PATH, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // Lost the race: whoever created it first wins, even if it's not alive yet.
      const pid = readLockPid();
      throw new AlreadyRunningError(pid ?? -1);
    }
    throw err;
  }
  // Best-effort cleanup on every exit path. Only removes the file if it's still
  // ours — a stale lock we already lost (e.g. cleared by a later process after we
  // died some other way) should never be blown away by a delayed exit handler.
  const release = () => releaseInstanceLock();
  process.on("exit", release);
}

/** Release the lock, but only if this process still owns it. */
export function releaseInstanceLock(): void {
  try {
    if (readLockPid() === process.pid) {
      unlinkSync(INSTANCE_PID_PATH);
    }
  } catch {
    // Already gone, or never ours — nothing to do.
  }
}
