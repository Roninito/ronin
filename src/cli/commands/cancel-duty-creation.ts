/**
 * Cancel duty creation command
 * Emits cancel_creation event to stop active duty creation workflows
 */
export interface CancelDutyCreationOptions {
  taskId?: string;
  port?: number;
}

/**
 * Try to emit cancel event via HTTP to running Ronin instance
 */
async function emitCancelEventViaHTTP(taskId?: string, port?: number): Promise<boolean> {
  const serverPort = port || (process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : 3000);
  try {
    const response = await fetch(`http://localhost:${serverPort}/api/events/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "cancel_creation", data: { taskId } }),
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Cancel duty creation command
 */
export async function cancelDutyCreationCommand(
  options: CancelDutyCreationOptions = {}
): Promise<void> {
  const { taskId, port } = options;

  console.log("⏹️  Canceling duty creation...\n");

  const eventEmitted = await emitCancelEventViaHTTP(taskId, port);

  if (eventEmitted) {
    if (taskId) {
      console.log(`✅ Cancel request sent for task: ${taskId}`);
    } else {
      console.log("✅ Cancel request sent for all active creations");
    }
    console.log("   Check the Ronin logs for confirmation");
  } else {
    console.error("❌ Could not connect to Ronin. Is it running?");
    console.log("💡 Start it with: ronin start");
    process.exit(1);
  }
}
