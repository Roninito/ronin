/**
 * Kata Runner Agent — Phase 7
 *
 * Scheduled task executor
 * - Runs every 30 minutes
 * - Polls all pending tasks
 * - Executes phases via TaskExecutor
 * - Handles errors gracefully
 */

import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import { TaskExecutor } from "../src/task/executor.js";

export default class KataRunnerAgent extends BaseDuty {
  // Run every 30 minutes
  static schedule = "*/30 * * * *";

  // Named taskExecutor (not executor) — BaseDuty already declares a protected
  // `executor: Executor | null` field for its own SAR chain machinery; this is an
  // unrelated task-kata executor and must not shadow it.
  private taskExecutor: TaskExecutor;

  constructor(api: DutyAPI) {
    super(api);
    this.taskExecutor = new TaskExecutor(api);
    console.log("⚔️  Kata Runner ready. Polling every 30m for pending tasks");
  }

  async execute(): Promise<void> {
    try {
      // Poll all pending tasks and execute
      await this.taskExecutor.pollAndExecute();
    } catch (error) {
      console.error(`[kata-runner] error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
