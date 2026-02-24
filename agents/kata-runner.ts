/**
 * Kata Runner Agent — Phase 7
 *
 * Scheduled task executor
 * - Runs every 30 seconds
 * - Polls all pending tasks
 * - Executes phases via TaskExecutor
 * - Handles errors gracefully
 */

import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import { TaskExecutor } from "../src/task/executor.js";

export default class KataRunnerAgent extends BaseAgent {
  // Run every 30 seconds
  static schedule = "*/30 * * * * *";

  private executor: TaskExecutor;

  constructor(api: AgentAPI) {
    super(api);
    this.executor = new TaskExecutor(api);
  }

  async execute(): Promise<void> {
    try {
      // Poll all pending tasks and execute
      await this.executor.pollAndExecute();
    } catch (error) {
      this.logger.error(
        `Kata runner error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
