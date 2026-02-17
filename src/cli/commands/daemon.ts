import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

const DAEMON_PID_PATH = join(homedir(), ".ronin", "ronin.pid");
const DAEMON_LOG_PATH = join(homedir(), ".ronin", "daemon.log");

/**
 * Get daemon PID from file
 */
function getDaemonPID(): number | null {
  try {
    if (!existsSync(DAEMON_PID_PATH)) {
      return null;
    }
    const pidStr = Bun.file(DAEMON_PID_PATH).text().toString().trim();
    if (!pidStr) {
      return null;
    }
    return parseInt(pidStr, 10);
  } catch {
    return null;
  }
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
  if (pid !== null && isProcessRunning(pid)) {
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
  const pid = getDaemonPID();
  if (pid === null) {
    console.log("Daemon is not running (no PID file found)");
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log(`Daemon PID ${pid} is not running (stale PID file)`);
    // Clean up stale PID file
    try {
      Bun.write(DAEMON_PID_PATH, "");
    } catch {}
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
    
    // Clean up PID file
    try {
      Bun.write(DAEMON_PID_PATH, "");
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

  if (!isProcessRunning(pid)) {
    console.log(`Daemon status: Not running (stale PID file: ${pid})`);
    return;
  }

  console.log(`Daemon status: Running`);
  console.log(`  PID: ${pid}`);
  console.log(`  Logs: ${DAEMON_LOG_PATH}`);
  console.log(`  PID file: ${DAEMON_PID_PATH}`);
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
