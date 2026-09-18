import { execSync } from "child_process";
import { unlinkSync } from "fs";
import { INSTANCE_PID_PATH } from "../instanceLock.js";

/**
 * Get the default webhook port
 */
function getWebhookPort(): number {
  return process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : 3000;
}

/**
 * Find every process that looks like Ronin: anything running with `ronin` in its
 * argv, plus anything bound to the webhook port. The single source of truth for
 * process discovery — `kill`, `stop`, and `restart` all go through it.
 *
 * The argv match is intentionally broad to catch every Ronin invocation pattern
 * we've seen in the wild: dev (`bun run src/cli/index.ts start`), global
 * (`/Users/ronin/.bun/bin/ronin start`), and the long-running detached
 * `bun run engine/server.ts` that lives on as a service-style process.
 * Excludes the current process and (when `excludePids` is given) any others the
 * caller wants to keep (e.g. a freshly-started ronin from `restart`).
 */
export function findRoninProcesses(port: number = getWebhookPort()): { pids: number[]; byPort: number[]; byName: number[] } {
  const byPort: number[] = [];
  try {
    // `lsof -ti tcp:PORT` returns every PID with any connection on that port —
    // including unrelated clients (e.g. the RoninTray menu bar app connecting
    // to the server). Filter to processes actually LISTENING on the port
    // (state "TCP *:PORT (LISTEN)") so we don't count random clients as
    // "ronin processes on port 3000".
    const out = execSync(
      `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`,
      { encoding: "utf-8" }
    );
    const portPids = out.trim().split("\n").filter(Boolean).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
    for (const pid of portPids) {
      try {
        process.kill(pid, 0);
        byPort.push(pid);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") byPort.push(pid);
      }
    }
  } catch { /* port not bound or lsof missing */ }

  const byName: number[] = [];
  try {
    // Match processes that are actually Ronin — NOT processes that happen to
    // contain the string "ronin" in some unrelated flag value. The reliable
    // signals that an argv is a Ronin process are:
    //   - argv starts with `ronin` (the global symlink resolves here)
    //   - argv is `bun run` / `node` against a script under a path that
    //     contains `/ronin/` AND looks like a cli entry — i.e. either the
    //     well-known entry `cli/index.ts` or the engine server entry
    //     `engine/server.ts` (the long-running daemon that survives kill).
    //
    // Reject: user-data-dirs, login shells, anything where `ronin` appears in
    // a `--flag value` rather than the executable path. Concretely, the
    // `Obsidian Helper` and `Steam` processes that survived the prior regex
    // had argv like `--user-data-dir=/Users/ronin/Library/...` — those get
    // filtered out by requiring the `/ronin/` segment to be followed by
    // `src/` or by requiring the cmd to literally start with `ronin `.
    const rawOut = execSync(
      // Match ronin processes without false-positiving on `ronin` as a
      // username or path segment in unrelated flags. Three patterns:
      //   1. argv starts with `ronin` (the global symlink /usr/local/bin/ronin)
      //   2. argv contains ` bun run ` followed by `src/cli/index.ts` (dev mode)
      //   3. argv contains a path with `/ronin/` then `src/cli/index.ts`
      //      or `engine/server.ts` (full-path bun/node invocations)
      // User shells, Steam, Obsidian helpers, etc. all fail to match because
      // their "ronin" appears in flag values, not in the executable path.
      `ps -axo pid=,command= | awk '{ cmd=$0; sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", cmd); if (cmd ~ /^ronin[ \\/]/ || cmd ~ /bun run src\\/cli\\/index\\.ts/ || cmd ~ /ronin.*src\\/cli\\/index\\.ts/ || cmd ~ /ronin.*engine\\/server\\.ts/) print $1 }' 2>/dev/null || true`,
      { encoding: "utf-8" }
    );
    // Filter out already-dead PIDs — `ps` may briefly list a parent that just
    // exited while the kill command is still spawning. `process.kill(pid, 0)`
    // throws ESRCH for a dead PID; we just want to keep the live ones.
    const rawPids = rawOut.trim().split("\n").filter(Boolean).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
    for (const pid of rawPids) {
      try {
        process.kill(pid, 0);
        byName.push(pid);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") {
          byName.push(pid); // unknown error — include rather than miss
        }
      }
    }
  } catch { /* ps missing */ }

  // De-dupe and exclude the current process plus its ancestors (e.g. the
  // shell + `timeout` wrapper that invoked `bun run src/cli/index.ts kill`).
  // Without the ancestor exclusion, the kill command would list itself in
  // the "Found N ronin processes" output even though the explicit
  // process.pid guard at signal time would refuse to kill it.
  const seen = new Set<number>([process.pid, ...getAncestorPids(process.ppid)]);
  const pids: number[] = [];
  for (const pid of [...byPort, ...byName]) {
    if (seen.has(pid)) continue;
    seen.add(pid);
    pids.push(pid);
  }
  return { pids, byPort, byName };
}

/**
 * Walk up the process tree starting at `startPpid` and collect every ancestor
 * PID. Returns an empty array for PID 1 (init) or if the parent has already
 * exited. Used to exclude the kill command's own caller chain from the
 * "Found N ronin processes" output.
 */
function getAncestorPids(startPpid: number | undefined): number[] {
  if (!startPpid || startPpid <= 1) return [];
  const ancestors: number[] = [startPpid];
  try {
    const out = execSync(`ps -axo pid=,ppid= 2>/dev/null || true`, { encoding: "utf-8" });
    const parentOf = new Map<number, number>();
    for (const line of out.trim().split("\n").filter(Boolean)) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (!m) continue;
      parentOf.set(parseInt(m[1]!, 10), parseInt(m[2]!, 10));
    }
    let current = startPpid;
    while (true) {
      const ppid = parentOf.get(current);
      if (!ppid || ppid <= 1 || ancestors.includes(ppid)) break;
      ancestors.push(ppid);
      current = ppid;
    }
  } catch { /* ignore */ }
  return ancestors;
}

/**
 * Collect all descendant PIDs of `rootPid` (including `rootPid` itself) using
 * `ps -axo pid=,ppid=`. Iterative BFS rather than recursion so a deep tree
 * doesn't blow the stack. Returns an empty array if the root is already gone.
 *
 * Why we need this: a single `ronin` parent process often spawns detached
 * children (Telegram bots, ninja-mode workers, scheduled duty jobs) that
 * outlive their parent. Without tree-kill, `ronin kill` would report
 * "Killed ronin process N" once and leave 3-4 zombies behind, which is exactly
 * the failure mode the user hit on 2026-09-17.
 */
export function collectDescendants(rootPid: number): number[] {
  try {
    const out = execSync(`ps -axo pid=,ppid= 2>/dev/null || true`, { encoding: "utf-8" });
    const lines = out.trim().split("\n").filter(Boolean);
    const parentOf = new Map<number, number>();
    for (const line of lines) {
      const m = line.trim().match(/^(\d+)\s+(\d+)$/);
      if (!m) continue;
      // Capture groups are mandatory in this regex, so a successful match always
      // populates m[1] and m[2].
      parentOf.set(parseInt(m[1]!, 10), parseInt(m[2]!, 10));
    }
    // BFS: include root, then walk children whose parent is in the result.
    const collected = new Set<number>([rootPid]);
    const queue: number[] = [rootPid];
    while (queue.length > 0) {
      const p = queue.shift()!;
      for (const [pid, ppid] of parentOf) {
        if (ppid === p && !collected.has(pid)) {
          collected.add(pid);
          queue.push(pid);
        }
      }
    }
    return [...collected];
  } catch {
    return [rootPid]; // fallback: at least try to kill the root
  }
}

/**
 * Signal a list of PIDs (excluded handled by caller). For each PID we also
 * signal its descendants so a parent + its detached children are killed
 * atomically — no zombies. Returns the number of PIDs that were actually
 * transitioned to dead. Verifies with signal 0 after.
 */
export function signalRoninProcesses(pids: number[], signal: NodeJS.Signals = "SIGKILL"): number {
  let killed = 0;
  // Expand each root PID to its full subtree so the caller doesn't have to
  // chase orphaned children manually. Dedup across roots so two roots that
  // share a child (rare but possible) only signal it once.
  const allTargets = new Set<number>();
  for (const pid of pids) {
    if (pid === process.pid) continue;
    for (const descendant of collectDescendants(pid)) {
      if (descendant !== process.pid) allTargets.add(descendant);
    }
  }
  // Kill deepest-first so children don't survive the parent's death and
  // become reparented to init.
  const sortedTargets = [...allTargets].sort((a, b) => b - a);
  for (const pid of sortedTargets) {
    try {
      process.kill(pid, signal);
      // Synchronous-ish confirmation: signal 0 throws ESRCH if the PID is gone.
      for (let i = 0; i < 10; i++) {
        try {
          process.kill(pid, 0);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ESRCH") {
            killed++;
            break;
          }
          throw e;
        }
        // Tiny busy-wait rather than async sleep — we want this synchronous
        // so callers can chain on the result without race-prone state.
        const start = Date.now();
        while (Date.now() - start < 50) { /* spin */ }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") {
        // re-throw so callers can decide what to log
        throw e;
      }
    }
  }
  return killed;
}

/**
 * Clear the instance lock file regardless of which PID it names — after
 * deliberately killing everything above, a leftover lock file can only be stale.
 */
export function clearInstanceLock(): void {
  try { unlinkSync(INSTANCE_PID_PATH); } catch { /* already gone */ }
}

/**
 * Kill command: Forcefully kill all Ronin instances
 */
export async function killCommand(options: { dryRun?: boolean } = {}): Promise<void> {
  const port = getWebhookPort();

  console.log("💀 Forcefully killing all Ronin instances...\n");

  const { pids, byPort, byName } = findRoninProcesses(port);
  if (pids.length === 0) {
    console.log("ℹ️  No ronin processes found");
    clearInstanceLock();
    return;
  }

  // byName count is the raw pre-dedup match — useful as a diagnostic, but the
  // actual kill set is pids.length (deduped, liveness-filtered, with ancestors
  // and process.pid excluded). When byName > pids.length, it's usually
  // because `ps` listed the same PID twice via two regex branches, or
  // captured a parent that's about to exit anyway.
  console.log(`Found ${pids.length} ronin process(es) to kill: ${byPort.length} on port ${port}, ${byName.length} by name (pre-dedup)`);
  if (options.dryRun) {
    for (const pid of pids) console.log(`   would SIGKILL: ${pid}`);
    console.log("\n(dry run — nothing was killed)");
    return;
  }

  const killed = signalRoninProcesses(pids, "SIGKILL");
  for (const pid of pids) {
    console.log(`   ✅ Killed ronin process ${pid}`);
  }

  // Final pkill sweep — covers anything ps/lsof missed (rare, but happens with
  // detached children whose argv got replaced after fork).
  try {
    execSync(`pkill -9 -f "bun.*ronin" 2>/dev/null || true`);
    execSync(`pkill -9 -f "node.*ronin" 2>/dev/null || true`);
  } catch { /* ignore */ }

  clearInstanceLock();

  // Brief settle so port-release races don't trigger a false "still running"
  // warning below.
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    const response = await fetch(`http://localhost:${port}/api/status`, {
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      console.log(`\n⚠️  Warning: Something is still responding on port ${port}`);
      console.log("   You may need to manually kill the process:");
      console.log(`   sudo lsof -ti tcp:${port} | xargs kill -9`);
    }
  } catch {
    // Good - nothing responding
  }

  console.log(`\n✅ Killed ${killed} process(es)`);
  console.log("\n💡 To start fresh:");
  console.log("   ronin start");
}
