/**
 * Task Runner
 *
 * Replaces duties/kata-runner.ts (2026-09-17, Kata removal). Same 30-minute
 * cadence, but now a safety net rather than the primary way a task advances —
 * ContractTaskExecutor.executePhase loops through every consecutive `run`
 * phase in one call, so a cron/event-triggered task normally finishes in one
 * burst at trigger time (see duties/task-executor.ts). This poll tick exists
 * to pick up anything that didn't (a process restart mid-run, a transient
 * skill failure worth retrying) and to re-arm `wait event` listeners for any
 * task left `waiting_for_event` across a restart.
 */

import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import { ContractTaskExecutor } from "../src/task/contract-task-executor.js";

export default class TaskRunnerDuty extends BaseDuty {
  // Run every 30 minutes
  static schedule = "*/30 * * * *";

  private taskExecutor: ContractTaskExecutor;

  constructor(api: DutyAPI) {
    super(api);
    this.taskExecutor = new ContractTaskExecutor(api);
    console.log("⚔️  Task Runner ready. Polling every 30m as a safety net for pending/waiting tasks");
  }

  async execute(): Promise<void> {
    try {
      await this.taskExecutor.pollAndExecute();
    } catch (error) {
      console.error(`[task-runner] error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
