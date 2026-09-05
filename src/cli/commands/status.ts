import { loadConfig, ensureDefaultDutyDir, ensureDefaultExternalDutyDir } from "./config.js";
import { getRunningInstancePid } from "../instanceLock.js";

export interface StatusOptions {
  dutyDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
}

/**
 * Check if Ronin is running and get status from running instance
 */
async function checkRunningInstance(port: number = 3000): Promise<any | null> {
  try {
    const response = await fetch(`http://localhost:${port}/api/status`, {
      signal: AbortSignal.timeout(2000), // 2 second timeout
    });
    
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    // Server not running or not accessible
    return null;
  }
  return null;
}

/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

/**
 * Status command: Show runtime info and active schedules
 */
export async function statusCommand(options: StatusOptions = {}): Promise<void> {
  try {
    const webhookPort = process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : 3000;
    
    // First, try to get status from running instance
    const runningStatus = await checkRunningInstance(webhookPort);
    
    if (runningStatus && runningStatus.running) {
    // Show status from running instance
    console.log("\n📊 Ronin Duty Engine Status (Running Instance)\n");
    console.log(`🟢 Status: Running`);
    console.log(`   Port: ${runningStatus.port}`);
    console.log(`   PID: ${runningStatus.pid}`);
    console.log(`   Uptime: ${formatUptime(runningStatus.uptime)}`);
    console.log(`\n   Total Duties: ${runningStatus.totalDuties}`);
    console.log(`   Scheduled: ${runningStatus.scheduledDuties}`);
    console.log(`   File Watchers: ${runningStatus.watchedDuties}`);
    console.log(`   Webhooks: ${runningStatus.webhookDuties}`);

    if (runningStatus.dutys && runningStatus.dutys.length > 0) {
      console.log("\n🤖 Duties:\n");
      for (const duty of runningStatus.dutys) {
        console.log(`   ${duty.name}`);
        if (duty.schedule) {
          console.log(`      ⏰ ${duty.schedule}`);
        }
        if (duty.watch && duty.watch.length > 0) {
          console.log(`      👁️  ${duty.watch.join(", ")}`);
        }
        if (duty.webhook) console.log(`      🔗 ${duty.webhook}`);
      }
    }
    console.log();
    return;
  }

  // The instance lock is written the moment a process starts, before its HTTP
  // server binds — a live PID here with no HTTP response means something is
  // actually stuck/crashed mid-startup, not simply "not running".
  const lockPid = getRunningInstancePid();
  if (lockPid !== null) {
    console.log(`\n🟡 Ronin process is running (PID ${lockPid}) but not responding on port ${webhookPort}\n`);
    console.log("   It may still be starting up, or may be stuck. Check its logs, or run 'ronin stop' if it seems wedged.\n");
    return;
  }

  // If not running, show minimal info without loading plugins or duties (avoids init side effects)
  console.log("🔴 Ronin is not currently running\n");
  const config = await loadConfig();
  const dutyDir = options.dutyDir || config.dutyDir || ensureDefaultDutyDir();
  const externalDutyDir =
    process.env.RONIN_EXTERNAL_DUTY_DIR || config.externalDutyDir || ensureDefaultExternalDutyDir();
  console.log("   Duty directory: " + dutyDir);
  console.log("   External duty directory: " + externalDutyDir);
  console.log("\n💡 To start Ronin, run: ronin start");
  console.log();
  } catch (error) {
    console.error("❌ Error getting status:", error);
    process.exit(1);
  }
}
