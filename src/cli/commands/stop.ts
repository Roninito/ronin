import { homedir } from "os";
import { join } from "path";
import { getRunningInstancePid } from "../instanceLock.js";

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
 * Stop command: Stop a running Ronin instance
 */
export async function stopCommand(): Promise<void> {
  const port = getWebhookPort();
  
  console.log("🔍 Checking for running Ronin instance...");
  
  const pid = await getRunningPid(port);
  
  if (!pid) {
    console.log("⚠️  Ronin is not currently running");
    process.exit(0);
  }
  
  console.log(`🛑 Stopping Ronin (PID: ${pid})...`);
  
  try {
    // Send SIGTERM to gracefully shutdown
    process.kill(pid, 'SIGTERM');
    
    // Wait a moment to see if it stopped
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if it's still running
    const stillRunning = await getRunningPid(port);
    
    if (stillRunning) {
      console.log("⚠️  Graceful shutdown failed, forcing stop...");
      try {
        process.kill(pid, 'SIGKILL');
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        // Process might already be dead
      }
    }
    
    // Final check
    const finalCheck = await getRunningPid(port);
    
    if (!finalCheck) {
      console.log("✅ Ronin stopped successfully");
    } else {
      console.error("❌ Failed to stop Ronin. You may need to kill it manually:");
      console.error(`   kill -9 ${pid}`);
      process.exit(1);
    }
  } catch (error) {
    if ((error as any).code === 'ESRCH') {
      console.log("✅ Ronin was already stopped");
    } else {
      console.error("❌ Error stopping Ronin:", error);
      process.exit(1);
    }
  }
}

/**
 * Restart command: Stop and then start Ronin
 */
export async function restartCommand(startFn: () => Promise<void>): Promise<void> {
  const port = getWebhookPort();
  
  console.log("🔄 Restarting Ronin...\n");
  
  // Try to stop if running
  const pid = await getRunningPid(port);
  
  if (pid) {
    console.log(`🛑 Stopping running instance (PID: ${pid})...`);
    try {
      process.kill(pid, 'SIGTERM');
      
      // Wait for shutdown
      let attempts = 0;
      while (attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const stillRunning = await getRunningPid(port);
        if (!stillRunning) break;
        attempts++;
      }
      
      // Force kill if still running
      const stillRunning = await getRunningPid(port);
      if (stillRunning) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          // Process might already be dead
        }
      }
      
      console.log("✅ Stopped\n");
    } catch (error) {
      if ((error as any).code !== 'ESRCH') {
        console.error("⚠️  Error stopping:", error);
      }
    }
  }
  
  // Wait a moment before starting
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log("🚀 Starting Ronin...\n");
  
  // Start Ronin
  await startFn();
}
