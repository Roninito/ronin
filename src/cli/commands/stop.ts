import { getRunningInstancePid } from "../instanceLock.js";
import { findRoninProcesses, signalRoninProcesses, clearInstanceLock } from "./kill.js";

/**
 * Get the default webhook port
 */
function getWebhookPort(): number {
  return process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : 3000;
}

/**
 * Check if Ronin is running and get its PID.
 *
 * The instance lock (shared by every launch mode) is checked first — it's accurate
 * the instant a process starts, before its HTTP server even binds. The HTTP probe
 * is a fallback for the (now much narrower) case where the lock file is somehow
 * missing but the server is actually up and answering.
 */
async function getRunningPid(port: number = 3000): Promise<number | null> {
  const lockPid = getRunningInstancePid();
  if (lockPid !== null) return lockPid;

  try {
    const response = await fetch(`http://localhost:${port}/api/status`, {
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.running && data.pid) {
        return data.pid;
      }
    }
  } catch (error) {
    // Server not running
  }
  return null;
}

/**
 * Stop command: Stop a running Ronin instance.
 *
 * Cleans up EVERY ronin process — not just the lockfile PID. Before this, leftover
 * `ronin doctor`, ninja-mode children, and orphaned CLI sub-processes would
 * survive `ronin stop` (which only ever discovered the one process answering the
 * HTTP port). Users would then see multiple stale processes and need `ronin kill`
 * to fully reset. We now share the process-discovery logic with `ronin kill` so
 * both commands agree on what "stop" means.
 */
export async function stopCommand(): Promise<void> {
  const port = getWebhookPort();

  console.log("🔍 Checking for running Ronin instance...");

  const pid = await getRunningPid(port);
  const { pids: discovered } = findRoninProcesses(port);
  // Union: lockfile PID (if any) + every other ronin process we found.
  const targets = Array.from(new Set([pid, ...discovered].filter((p): p is number => typeof p === "number" && Number.isFinite(p))));

  if (targets.length === 0) {
    console.log("⚠️  Ronin is not currently running");
    clearInstanceLock();
    return;
  }

  console.log(`🛑 Stopping Ronin (${targets.length} process${targets.length === 1 ? "" : "es"}: ${targets.join(", ")})...`);

  try {
    // Graceful first — send SIGTERM to every PID and wait briefly. Anything
    // still alive after the timeout gets escalated to SIGKILL. Doing it this
    // way (SIGTERM the whole set, then SIGKILL the survivors) means a normal
    // `ronin stop` from a healthy instance still gets a graceful shutdown,
    // while stuck/zombie siblings get cleaned up too.
    signalRoninProcesses(targets, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const survivors = targets.filter((p) => {
      try {
        process.kill(p, 0);
        return true;
      } catch (e) {
        return (e as NodeJS.ErrnoException).code !== "ESRCH";
      }
    });
    if (survivors.length > 0) {
      console.log(`⚠️  Graceful shutdown failed for ${survivors.length} process(es), forcing...`);
      try {
        signalRoninProcesses(survivors, "SIGKILL");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch {
        // Process might already be dead
      }
    }

    // Final check — also verify nothing answers the port, since that would mean
    // a process we didn't enumerate is bound (rare but possible: a child whose
    // argv got replaced after fork).
    const finalCheck = await getRunningPid(port);
    if (!finalCheck) {
      console.log(`✅ Ronin stopped successfully (${targets.length} process${targets.length === 1 ? "" : "es"} terminated)`);
    } else {
      console.error("❌ Failed to stop Ronin. You may need to kill it manually:");
      console.error(`   ronin kill     # force-kill everything, including untracked processes`);
      console.error(`   kill -9 ${finalCheck}`);
      process.exit(1);
    }
  } catch (error) {
    if ((error as any).code === 'ESRCH') {
      console.log("✅ Ronin was already stopped");
      clearInstanceLock();
    } else {
      console.error("❌ Error stopping Ronin:", error);
      process.exit(1);
    }
  }
}

/**
 * Restart command: Stop and then start Ronin.
 *
 * Stop uses the full process-discovery sweep now (same as `ronin stop`) so a
 * previous run's zombies never get a chance to conflict with the new server
 * grabbing the same port.
 */
export async function restartCommand(startFn: () => Promise<void>): Promise<void> {
  console.log("🔄 Restarting Ronin...\n");

  await stopCommand();

  // Wait a moment before starting
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log("\n🚀 Starting Ronin...\n");

  await startFn();
}
