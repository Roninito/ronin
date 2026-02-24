/**
 * Cron Engine — Phase 7
 *
 * Evaluates cron expressions and emits events
 *
 * Architecture:
 *   setInterval (every 60 seconds)
 *     ↓
 *   Get all active cron contracts
 *     ↓
 *   For each: if cronMatches(expression, now)
 *     ↓
 *   emit("contract.triggered", { contractId, timestamp })
 *
 * Note: Cron engine is DUMB - it only emits events
 * Contract engine listens and creates tasks
 */

import type { AgentAPI } from "../types/index.js";
import { CronEvaluator } from "./cron.js";
import { ContractStorage } from "./storage.js";

/**
 * Cron Engine - evaluates cron contracts and emits events
 */
export class CronEngine {
  private storage: ContractStorage;
  private intervalId: NodeJS.Timeout | null = null;
  private lastMinute = -1;

  constructor(private api: AgentAPI) {
    this.storage = new ContractStorage(api);
  }

  /**
   * Start cron engine (run every minute)
   */
  start(): void {
    if (this.intervalId) {
      this.api.logger?.warn("CronEngine already running");
      return;
    }

    this.api.logger?.info("CronEngine starting (every 60 seconds)");

    // Run every 60 seconds
    this.intervalId = setInterval(() => {
      this.tick();
    }, 60000);

    // Run immediately on start
    this.tick();
  }

  /**
   * Stop cron engine
   */
  stop(): void {
    if (!this.intervalId) {
      this.api.logger?.warn("CronEngine not running");
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
    this.api.logger?.info("CronEngine stopped");
  }

  /**
   * Engine tick - evaluate all cron contracts
   */
  private async tick(): Promise<void> {
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();

    // Prevent multiple fires in same minute
    if (this.lastMinute === currentMinute) {
      return;
    }
    this.lastMinute = currentMinute;

    try {
      // Get all active cron contracts
      const cronContracts = await this.storage.getByTrigger("cron");

      for (const contract of cronContracts) {
        if (contract.trigger.type !== "cron") continue;

        try {
          // Check if this minute matches the cron expression
          if (CronEvaluator.matches(contract.trigger.expression, now)) {
            // Emit event - Contract Engine will listen
            this.api.events?.emit(
              "contract.cron_triggered",
              {
                type: "contract.cron_triggered",
                contractId: contract.id,
                contractName: contract.name,
                contractVersion: contract.version,
                kataName: contract.kata.name,
                kataVersion: contract.kata.version,
                expression: contract.trigger.expression,
                timestamp: now.getTime(),
              },
              "cron-engine"
            );

            this.api.logger?.info(
              `Cron triggered: ${contract.name} (${contract.trigger.expression})`
            );
          }
        } catch (error) {
          this.api.logger?.error(
            `Error evaluating cron '${contract.trigger.expression}': ${error}`
          );
        }
      }
    } catch (error) {
      this.api.logger?.error(`CronEngine tick error: ${error}`);
    }
  }
}

/**
 * Contract Engine - listens to events and spawns tasks
 */
export class ContractEngine {
  private storage: ContractStorage;

  constructor(private api: AgentAPI) {
    this.storage = new ContractStorage(api);
  }

  /**
   * Start listening for contract triggers
   */
  start(): void {
    // Listen for cron triggers
    this.api.events?.on("contract.cron_triggered", (payload: any) => {
      this.handleCronTrigger(payload);
    });

    // Listen for event triggers (future)
    this.api.events?.on("contract.event_triggered", (payload: any) => {
      this.handleEventTrigger(payload);
    });

    this.api.logger?.info("ContractEngine started");
  }

  /**
   * Handle cron trigger - create task
   */
  private async handleCronTrigger(payload: {
    contractId: string;
    kataName: string;
    kataVersion: string;
    timestamp: number;
  }): Promise<void> {
    try {
      // Emit task spawn request
      // TaskEngine will pick this up and create a task
      this.api.events?.emit(
        "task.spawn_requested",
        {
          type: "task.spawn_requested",
          kataName: payload.kataName,
          kataVersion: payload.kataVersion,
          contractId: payload.contractId,
          timestamp: payload.timestamp,
        },
        "contract-engine"
      );

      this.api.logger?.info(
        `Contract triggered task: ${payload.kataName} v${payload.kataVersion} (contract: ${payload.contractId})`
      );
    } catch (error) {
      this.api.logger?.error(`Error handling cron trigger: ${error}`);
    }
  }

  /**
   * Handle event trigger - create task
   */
  private async handleEventTrigger(payload: {
    contractId: string;
    kataName: string;
    kataVersion: string;
    timestamp: number;
  }): Promise<void> {
    try {
      this.api.events?.emit(
        "task.spawn_requested",
        {
          type: "task.spawn_requested",
          kataName: payload.kataName,
          kataVersion: payload.kataVersion,
          contractId: payload.contractId,
          timestamp: payload.timestamp,
        },
        "contract-engine"
      );

      this.api.logger?.info(
        `Contract triggered task via event: ${payload.kataName} v${payload.kataVersion}`
      );
    } catch (error) {
      this.api.logger?.error(`Error handling event trigger: ${error}`);
    }
  }
}
