/**
 * Contract Executor Agent — Phase 7
 *
 * Orchestrates contract and cron execution:
 * 1. Starts CronEngine (evaluates cron expressions)
 * 2. Starts ContractEngine (listens to triggers, spawns tasks)
 *
 * Flow:
 *   CronEngine (every 60s)
 *     ↓ emits contract.cron_triggered
 *   ContractEngine
 *     ↓ emits task.spawn_requested
 *   TaskExecutor
 *     ↓ creates and runs task
 */

import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import { CronEngine, ContractEngine } from "../src/contract/index.js";

export default class ContractExecutorAgent extends BaseAgent {
  private cronEngine: CronEngine;
  private contractEngine: ContractEngine;

  constructor(api: AgentAPI) {
    super(api);
    this.cronEngine = new CronEngine(api);
    this.contractEngine = new ContractEngine(api);
  }

  async execute(): Promise<void> {
    try {
      // Start contract engines
      this.cronEngine.start();
      this.contractEngine.start();

      this.logger.info("Contract and Cron engines started");
    } catch (error) {
      this.logger.error(
        `Failed to start contract engines: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
