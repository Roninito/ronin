import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { getRunningInstancePid, INSTANCE_PID_PATH } from "../instanceLock.js";

const DAEMON_LOG_PATH = join(homedir(), ".ronin", "daemon.log");

/**
 * Get daemon PID from the shared instance lock (getRunningInstancePid() already
 * clears it if stale) — the same lock every launch mode (start/--ninja/--daemon/
 * interactive) now checks, not a daemon-only PID file.
 */
function getDaemonPID(): number | null {
  return getRunningInstancePid();
}

/**
 * Check if process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 checks if process exists
    return true;
  } catch {
    return false;
  }
}

/**
 * Daemon start command
 */
export async function daemonStartCommand(): Promise<void> {
  const pid = getDaemonPID();
  if (pid !== null) {
    console.log(`Daemon already running with PID ${pid}`);
    console.log(`  Logs: ${DAEMON_LOG_PATH}`);
    return;
  }

  console.log("Starting Ronin daemon...");
  // Use the same executable and script path
  const scriptPath = process.argv[1];
  const execPath = process.execPath;
  execSync(`${execPath} ${scriptPath} start --daemon`, {
    stdio: "inherit",
    cwd: process.cwd(),
  });
}

/**
 * Daemon stop command
 */
export async function daemonStopCommand(): Promise<void> {
  // getDaemonPID() (getRunningInstancePid()) already verifies liveness and clears
  // a stale lock itself, so a null result here already means "not running, and
  // any stale file has been cleaned up" — no separate staleness branch needed.
  const pid = getDaemonPID();
  if (pid === null) {
    console.log("Daemon is not running (no PID file found)");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`Stopped daemon (PID ${pid})`);

    // Wait a bit and check if it's still running
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (isProcessRunning(pid)) {
      console.log("Process still running, sending SIGKILL...");
      process.kill(pid, "SIGKILL");
    }

    // Clean up the lock file — the dying process's own `exit` handler (see
    // instanceLock.ts) should already do this, but SIGKILL gives it no chance to.
    try {
      unlinkSync(INSTANCE_PID_PATH);
    } catch {}
  } catch (error) {
    console.error(`Failed to stop daemon:`, error);
    process.exit(1);
  }
}

/**
 * Daemon status command
 */
export async function daemonStatusCommand(): Promise<void> {
  const pid = getDaemonPID();
  if (pid === null) {
    console.log("Daemon status: Not running (no PID file)");
    return;
  }

  console.log(`Daemon status: Running`);
  console.log(`  PID: ${pid}`);
  console.log(`  Logs: ${DAEMON_LOG_PATH}`);
  console.log(`  PID file: ${INSTANCE_PID_PATH}`);
}

/**
 * Daemon restart command
 */
export async function daemonRestartCommand(): Promise<void> {
  console.log("Restarting daemon...");
  await daemonStopCommand();
  await new Promise(resolve => setTimeout(resolve, 1000));
  await daemonStartCommand();
}

/**
 * Daemon logs command
 */
export async function daemonLogsCommand(): Promise<void> {
  if (!existsSync(DAEMON_LOG_PATH)) {
    console.log("No log file found. Daemon may not have been started yet.");
    return;
  }

  console.log(`Tailing daemon logs from ${DAEMON_LOG_PATH}...`);
  console.log("Press Ctrl+C to stop.\n");

  try {
    execSync(`tail -f "${DAEMON_LOG_PATH}"`, {
      stdio: "inherit",
    });
  } catch {
    // User interrupted
  }
}

/**
 * Main daemon command handler
 */
export async function daemonCommand(args: string[]): Promise<void> {
  const subcommand = args[0] || "status";

  switch (subcommand) {
    case "start":
      await daemonStartCommand();
      break;
    case "stop":
      await daemonStopCommand();
      break;
    case "status":
      await daemonStatusCommand();
      break;
    case "restart":
      await daemonRestartCommand();
      break;
    case "logs":
      await daemonLogsCommand();
      break;
    default:
      console.error(`Unknown daemon command: ${subcommand}`);
      console.error("Available commands: start, stop, status, restart, logs");
      process.exit(1);
  }
}
