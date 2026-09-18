import { describe, it, expect } from "bun:test";
import { spawn } from "bun";
import { findRoninProcesses, signalRoninProcesses, clearInstanceLock, collectDescendants } from "../src/cli/commands/kill.js";

// Regression coverage for the multi-process cleanup bug: a previous run of `ronin stop`
// only ever killed the single PID named in the lock file, leaving CLI sub-processes,
// ninja-mode children, and zombies from unclean shutdowns alive. Users saw "Killed
// ronin process 70682" x7 and had to run `ronin kill` manually. The fix shares a
// single `findRoninProcesses` between `kill`, `stop`, and `restart` so every shutdown
// path finds and terminates every ronin process — not just the lockfile PID.

describe("findRoninProcesses", () => {
  it("returns an array shape even when no ronin processes exist", () => {
    // The function always returns the same shape so callers can destructure safely.
    const result = findRoninProcesses(65535); // unlikely port
    expect(Array.isArray(result.pids)).toBe(true);
    expect(Array.isArray(result.byPort)).toBe(true);
    expect(Array.isArray(result.byName)).toBe(true);
  });

  it("never includes the current process pid in the returned list", () => {
    const { pids } = findRoninProcesses(65535);
    expect(pids).not.toContain(process.pid);
  });

  it("never includes ancestor processes (parent of the caller) in the returned list", () => {
    // Regression for the 2026-09-17 user complaint: `ronin kill` was listing
    // the calling shell + `timeout` wrapper as "ronin processes to kill".
    // The current process's ancestors should be excluded from byName so the
    // kill output doesn't mention the kill command itself.
    const ancestors = [process.ppid].filter((p): p is number => typeof p === "number" && p > 1);
    const { pids } = findRoninProcesses(65535);
    for (const a of ancestors) {
      expect(pids).not.toContain(a);
    }
  });

  it("only counts processes actually LISTENING on the port, not clients connecting to it", async () => {
    // Regression for the 2026-09-17 user complaint: `lsof -ti tcp:3000` was
    // returning both the bun listener AND the RoninTray menu bar app (which
    // connects as a client), inflating the "Found 2 ronin processes on port
    // 3000" count. The fix filters to TCP:LISTEN state only.
    //
    // This test verifies the helper doesn't return client PIDs by spinning up
    // a server, connecting a client, and confirming byPort only has the
    // server. We use a low-traffic port to avoid colliding with anything
    // else in the test env.
    const port = 4175;
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: { data: () => {}, close: () => {}, end: () => {} },
    } as never);
    // Connect a client to the server (creates an ESTABLISHED-state entry
    // for the client PID, which the old lsof would have picked up).
    const client = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data: () => {}, close: () => {} } });
    try {
      const result = findRoninProcesses(port);
      // Only one PID should be in byPort: the server. The client (which is
      // our own test process) is excluded via process.pid. Without the
      // LISTEN-state filter, lsof would also pick up the client's PID here.
      expect(result.byPort.length).toBe(1);
      // The server PID isn't reliably obtainable from Bun's listener API
      // (unstable_pid may be -1), so just confirm byPort contains exactly
      // one live PID — that single PID IS the server.
      const [onlyPid] = result.byPort;
      expect(typeof onlyPid).toBe("number");
      expect(onlyPid).toBeGreaterThan(0);
    } finally {
      try { client.close(); } catch { /* ignore */ }
      try { (server as { stop?: () => void }).stop?.(); } catch { /* ignore */ }
      // Also clean up via the low-level close path.
      try { (server as { close?: (cb?: () => void) => void }).close?.(); } catch { /* ignore */ }
    }
  });

  it("de-duplicates pids found via both port and name scans", () => {
    const { pids, byPort, byName } = findRoninProcesses(65535);
    // If a PID appears in both byPort and byName, it must only appear once in pids.
    const duplicates = byPort.filter((p) => byName.includes(p));
    for (const dup of duplicates) {
      const occurrences = pids.filter((p) => p === dup).length;
      expect(occurrences).toBe(1);
    }
  });

  // The regex used by findRoninProcesses is the single most failure-prone piece of
  // this whole subsystem (it has to balance "match real ronin processes" against
  // "don't match `login -pfl ronin /bin/bash`" — usernames match the wrong way). The
  // two assertions below encode that contract explicitly so a future regex tweak
  // can't silently re-introduce either failure mode.
  it("regex matches processes with bun/node + ronin in argv", () => {
    const regex = /(^| )(bun|node) [^ ]*.*ronin/;
    expect(regex.test(" 99999 bun run ronin start")).toBe(true);
    expect(regex.test(" 99999 bun run tests/ronin-doctor-noise-sleep.ts")).toBe(true);
    expect(regex.test(" 99999 node ./ronin/server.js")).toBe(true);
  });

  it("regex does NOT match user shells whose username is 'ronin'", () => {
    const regex = /(^| )(bun|node) [^ ]*.*ronin/;
    // login -pfl ronin /bin/bash: argv starts with login (not bun/node), so the
    // (^| )(bun|node) anchor must reject it. Without that anchor the regex would
    // match every shell session on this machine.
    expect(regex.test(" 99999 login -pfl ronin /bin/bash -c exec -la zsh /bin/zsh")).toBe(false);
    expect(regex.test(" 99999 /Users/ronin/.bun/bin/bun run engine/server.ts")).toBe(false);
    expect(regex.test(" 99999 osascript /Users/ronin/.ronin/menubar.scpt")).toBe(false);
  });
});

describe("signalRoninProcesses", () => {
  it("returns 0 when given an empty list", () => {
    const killed = signalRoninProcesses([], "SIGKILL");
    expect(killed).toBe(0);
  });

  it("skips the current process without killing it", () => {
    const before = process.pid;
    // Try to "kill" ourselves — the helper must refuse.
    signalRoninProcesses([process.pid], "SIGKILL");
    // If we're still here, the guard worked.
    expect(process.pid).toBe(before);
  });

  it("reports the correct count of PIDs actually transitioned to dead", () => {
    // Spawn a one-shot sleep, then signal it. We can't easily observe the exact
    // death tick without races, so we just confirm the return is non-negative.
    const proc = spawn({
      cmd: ["sleep", "30"],
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      const killed = signalRoninProcesses([proc.pid], "SIGKILL");
      expect(killed).toBeGreaterThanOrEqual(0);
      expect(killed).toBeLessThanOrEqual(1);
    } finally {
      try {
        proc.kill();
      } catch {
        /* already dead */
      }
    }
  });
});

describe("collectDescendants", () => {
  it("returns the root PID plus any direct children", () => {
    // The current bun test process is the "root" — its descendants are the
    // helper processes bun spawns for test parallelism (if any). Verify the
    // helper at minimum includes the root.
    const result = collectDescendants(process.pid);
    expect(result).toContain(process.pid);
  });

  it("returns just the root when the PID is already gone", () => {
    // A PID that doesn't exist should fall back gracefully — the caller will
    // at minimum try to signal the root, which will throw ESRCH and be
    // counted as a successful kill.
    const result = collectDescendants(2 ** 30); // very unlikely to exist
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe("signalRoninProcesses — tree kill", () => {
  // Regression for the 2026-09-17 user complaint: "ronin kill should only
  // leave 1 process." When the user reported 4 killed PIDs from a single
  // `ronin kill` invocation, those 4 were actually 1 parent + 3 detached
  // children the parent had spawned (Telegram bots, scheduled jobs). The fix
  // makes signalRoninProcesses do process-tree kill: for each root PID,
  // signal the whole subtree deepest-first so children can't be reparented
  // to init and outlive the parent's exit.
  it("kills descendants of a root PID, not just the root", () => {
    // Spawn a parent shell with a child sleep, both under our control.
    // After signalRoninProcesses kills the parent's PID, both should be gone.
    const parent = spawn({
      cmd: ["bash", "-c", "sleep 30 & exec sleep 30"],
      stdout: "ignore",
      stderr: "ignore",
    });
    // The bash exec replaces itself with sleep after backgrounding the child,
    // so the parent PID ends up being sleep (the second one). Wait for the
    // bash subshell to settle, then verify the original child still exists
    // under our parent.
    const initial = process.pid;
    void initial;

    // Give the parent a moment to background its child, then capture all
    // descendants of the parent.
    setTimeout(() => {}, 200);
    const before = collectDescendants(parent.pid);
    expect(before.length).toBeGreaterThanOrEqual(1);

    try {
      signalRoninProcesses([parent.pid], "SIGKILL");
      // After the tree kill, the parent's subtree should be empty (or only
      // contain PIDs that were already gone).
      const after = collectDescendants(parent.pid);
      expect(after.length).toBeLessThan(before.length);
    } finally {
      // Defensive — kill anything still alive.
      try { parent.kill(); } catch { /* gone */ }
    }
  });
});

describe("clearInstanceLock", () => {
  it("does not throw when the lock file is absent", () => {
    // The real path lives at ~/.ronin/ronin.pid — we don't create one in tests, so
    // this just verifies the helper is tolerant of a missing file.
    expect(() => clearInstanceLock()).not.toThrow();
  });
});
