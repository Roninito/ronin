import { execSync } from "child_process";

/**
 * Get the default webhook port
 */
function getWebhookPort(): number {
  return process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : 3000;
}

/**
 * Kill command: Forcefully kill all Ronin instances
 */
export async function killCommand(): Promise<void> {
  const port = getWebhookPort();
  
  console.log("💀 Forcefully killing all Ronin instances...\n");
  
  let killedCount = 0;
  
  // Method 1: Kill processes listening on the webhook port
  try {
    // Find PIDs listening on the port (macOS and Linux)
    let pids: number[] = [];
    
    try {
      // macOS: lsof
      const output = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`, { encoding: "utf-8" });
      pids = output.trim().split("\n").filter(Boolean).map(pid => parseInt(pid.trim())).filter(p => !isNaN(p));
    } catch {
      // Linux: ss or netstat
      try {
        const output = execSync(`ss -tlnp | grep ':${port}' | awk '{print $7}' | cut -d',' -f2 | cut -d'=' -f2 2>/dev/null || true`, { encoding: "utf-8" });
        pids = output.trim().split("\n").filter(Boolean).map(pid => parseInt(pid.trim())).filter(p => !isNaN(p));
      } catch {
        // Try netstat as fallback
        try {
          const output = execSync(`netstat -tlnp 2>/dev/null | grep ':${port}' | awk '{print $7}' | cut -d'/' -f1 || true`, { encoding: "utf-8" });
          pids = output.trim().split("\n").filter(Boolean).map(pid => parseInt(pid.trim())).filter(p => !isNaN(p));
        } catch {
          // Ignore
        }
      }
    }
    
    // Kill each PID found
    for (const pid of pids) {
      if (pid === process.pid) continue; // Don't kill ourselves
      
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`   ✅ Killed process ${pid} (port ${port})`);
        killedCount++;
      } catch (error) {
        if ((error as any).code !== 'ESRCH') {
          console.log(`   ⚠️  Could not kill process ${pid}: ${(error as Error).message}`);
        }
      }
    }
  } catch (error) {
    console.log("   ℹ️  Could not find processes by port");
  }
  
  // Method 2: Kill all bun/node processes with "ronin" in the command line
  try {
    // macOS: ps
    let roninPids: number[] = [];
    
    try {
      const output = execSync(`ps aux | grep -E 'bun.*ronin|node.*ronin' | grep -v grep | awk '{print $2}' 2>/dev/null || true`, { encoding: "utf-8" });
      roninPids = output.trim().split("\n").filter(Boolean).map(pid => parseInt(pid.trim())).filter(p => !isNaN(p));
    } catch {
      // Ignore
    }
    
    // Kill each ronin process
    for (const pid of roninPids) {
      if (pid === process.pid) continue; // Don't kill ourselves
      
      try {
        process.kill(pid, 'SIGKILL');
        console.log(`   ✅ Killed ronin process ${pid}`);
        killedCount++;
      } catch (error) {
        if ((error as any).code !== 'ESRCH') {
          console.log(`   ⚠️  Could not kill process ${pid}: ${(error as Error).message}`);
        }
      }
    }
  } catch (error) {
    console.log("   ℹ️  Could not find ronin processes by name");
  }
  
  // Method 3: Use pkill as a final resort
  try {
    execSync(`pkill -9 -f "bun.*ronin" 2>/dev/null || true`);
    execSync(`pkill -9 -f "node.*ronin" 2>/dev/null || true`);
    console.log("   ✅ Sent pkill signals");
  } catch {
    // Ignore
  }
  
  // Wait a moment
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Check if anything is still listening on the port
  try {
    const response = await fetch(`http://localhost:${port}/api/status`, {
      signal: AbortSignal.timeout(1000),
    });
    
    if (response.ok) {
      console.log("\n⚠️  Warning: Something is still responding on port ${port}");
      console.log("   You may need to manually kill the process:");
      console.log(`   sudo lsof -ti tcp:${port} | xargs kill -9`);
    }
  } catch {
    // Good - nothing responding
  }
  
  if (killedCount > 0) {
    console.log(`\n✅ Killed ${killedCount} process(es)`);
  } else {
    console.log("\nℹ️  No ronin processes found");
  }
  
  console.log("\n💡 To start fresh:");
  console.log("   ronin start");
}
