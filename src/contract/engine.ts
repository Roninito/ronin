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

import type { DutyAPI } from "../types/index.js";
import { CronEvaluator } from "./cron.js";
import { ContractStorageV2 } from "./storage-v2.js";
import type { CronTriggerConfig } from "../types/shared.js";
import { logger } from "../utils/logger.js";

/**
 * Cron Engine - evaluates cron contracts and emits events
 */
export class CronEngine {
  private storage: ContractStorageV2;
  private intervalId: NodeJS.Timeout | null = null;
  private lastMinute = -1;

  constructor(private api: DutyAPI) {
    this.storage = new ContractStorageV2(api);
  }

  /**
   * Start cron engine (run every minute)
   */
  start(): void {
    if (this.intervalId) {
      logger.warn("CronEngine already running");
      return;
    }

    logger.info("CronEngine starting (every 60 seconds)");

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
      logger.warn("CronEngine not running");
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
    logger.info("CronEngine stopped");
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
      // Get all active, enabled cron contracts (V2 storage/schema — the only
      // schema anything actually writes contracts into)
      const cronContracts = await this.storage.list({ triggerType: "cron", enabled: true });

      for (const row of cronContracts) {
        let triggerConfig: CronTriggerConfig;
        try {
          triggerConfig = JSON.parse(row.trigger_config) as CronTriggerConfig;
        } catch (error) {
          logger.error(`Invalid trigger_config JSON for contract '${row.name}': ${error}`);
          continue;
        }
        if (triggerConfig.type !== "cron") continue;

        try {
          // Check if this minute matches the cron expression
          if (CronEvaluator.matches(triggerConfig.expression, now)) {
            // Emit event - Contract Engine will listen
            this.api.events?.emit(
              "contract.cron_triggered",
              {
                type: "contract.cron_triggered",
                contractId: String(row.id),
                contractName: row.name,
                contractVersion: row.version,
                kataName: row.target_kata,
                kataVersion: row.target_kata_version,
                expression: triggerConfig.expression,
                timestamp: now.getTime(),
              },
              "cron-engine"
            );

            logger.info(
              `Cron triggered: ${row.name} (${triggerConfig.expression})`
            );
          }
        } catch (error) {
          logger.error(
            `Error evaluating cron '${triggerConfig.expression}': ${error}`
          );
        }
      }
    } catch (error) {
      logger.error(`CronEngine tick error: ${error}`);
    }
  }
}

/**
 * Contract Engine - listens to events and spawns tasks
 */
export class ContractEngine {
  private storage: ContractStorageV2;

  constructor(private api: DutyAPI) {
    this.storage = new ContractStorageV2(api);
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

    logger.info("ContractEngine started");
  }

  /**
   * Handle cron trigger - create task
   */
  private async handleCronTrigger(payload: {
    contractId: string;
    contractName: string;
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

      // Best-effort: populate the execution_count/last_executed_at tracking
      // columns the V2 schema already has but nothing previously updated.
      this.storage.recordExecution(payload.contractName, "").catch((error) => {
        logger.error(`Failed to record execution for '${payload.contractName}': ${error}`);
      });

      logger.info(
        `Contract triggered task: ${payload.kataName} v${payload.kataVersion} (contract: ${payload.contractId})`
      );
    } catch (error) {
      logger.error(`Error handling cron trigger: ${error}`);
    }
  }

  /**
   * Handle event trigger - create task
   */
  private async handleEventTrigger(payload: {
    contractId: string;
    contractName: string;
    kataName: string;
    kataVersion: string;
    timestamp: number;
    eventPayload?: Record<string, unknown>;
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
          initialVariables: payload.eventPayload,
        },
        "contract-engine"
      );

      this.storage.recordExecution(payload.contractName, "").catch((error) => {
        logger.error(`Failed to record execution for '${payload.contractName}': ${error}`);
      });

      logger.info(
        `Contract triggered task via event: ${payload.kataName} v${payload.kataVersion}`
      );
    } catch (error) {
      logger.error(`Error handling event trigger: ${error}`);
    }
  }
}
