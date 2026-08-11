/**
 * Event Trigger Engine
 *
 * The event-trigger counterpart to CronEngine (src/contract/engine.ts). Cron
 * contracts are evaluated on a 60s tick against the clock; event contracts
 * instead subscribe directly to whatever event name their trigger_config
 * names, and refire on it.
 *
 * Architecture:
 *   startup + 60s refresh
 *     ↓
 *   diff active event contracts vs. current subscriptions
 *     ↓
 *   api.events.on(eventType, handler) / .off(...) as contracts are added/removed
 *     ↓
 *   handler fires → optional condition evaluated against the event payload
 *     ↓
 *   emit("contract.event_triggered", { ..., eventPayload })
 *   ContractEngine listens and creates tasks (already implemented)
 */

import type { DutyAPI } from "../types/index.js";
import { ContractStorageV2 } from "./storage-v2.js";
import type { EventTriggerConfig, ContractV2Row } from "../types/shared.js";
import { evaluateCondition, evaluateConditionGroup } from "../kata/conditions.js";
import type { Condition, ConditionGroup } from "../kata/conditions.js";

interface Subscription {
  eventType: string;
  handler: (data: unknown) => void;
}

/**
 * Event Trigger Engine - subscribes to event-type contracts' event names and
 * emits contract.event_triggered when they fire (and any condition passes).
 */
export class EventTriggerEngine {
  private storage: ContractStorageV2;
  private intervalId: NodeJS.Timeout | null = null;
  private subscriptions = new Map<string, Subscription>(); // keyed by contract name

  constructor(private api: DutyAPI) {
    this.storage = new ContractStorageV2(api);
  }

  /**
   * Start the engine (refresh subscriptions every 60s, same cadence as CronEngine,
   * so newly-registered event contracts go live without a duty restart).
   */
  start(): void {
    if (this.intervalId) {
      this.api.logger?.warn("EventTriggerEngine already running");
      return;
    }

    this.api.logger?.info("EventTriggerEngine starting (refreshing subscriptions every 60 seconds)");

    this.intervalId = setInterval(() => {
      this.refresh();
    }, 60000);

    // Subscribe immediately on start.
    this.refresh();
  }

  /**
   * Stop the engine and unsubscribe from every event it's currently listening to.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    for (const sub of this.subscriptions.values()) {
      this.api.events?.off(sub.eventType, sub.handler);
    }
    this.subscriptions.clear();
    this.api.logger?.info("EventTriggerEngine stopped");
  }

  /**
   * Reconcile subscriptions against the current set of active, enabled
   * event-type contracts.
   */
  private async refresh(): Promise<void> {
    try {
      const rows = await this.storage.list({ triggerType: "event", enabled: true });
      const active = new Set<string>();

      for (const row of rows) {
        let triggerConfig: EventTriggerConfig;
        try {
          triggerConfig = JSON.parse(row.trigger_config) as EventTriggerConfig;
        } catch (error) {
          this.api.logger?.error(`Invalid trigger_config JSON for contract '${row.name}': ${error}`);
          continue;
        }
        if (triggerConfig.type !== "event") continue;

        active.add(row.name);
        const existing = this.subscriptions.get(row.name);

        // Already subscribed to the right event — nothing to do.
        if (existing && existing.eventType === triggerConfig.eventType) continue;

        // Event name changed (or newly seen) — drop any stale subscription, then subscribe fresh.
        if (existing) this.api.events?.off(existing.eventType, existing.handler);

        const handler = (eventPayload: unknown) => {
          this.handleFire(row.name, triggerConfig, eventPayload);
        };
        this.api.events?.on(triggerConfig.eventType, handler);
        this.subscriptions.set(row.name, { eventType: triggerConfig.eventType, handler });
      }

      // Unsubscribe from contracts that were disabled/deleted since the last refresh.
      for (const [name, sub] of this.subscriptions) {
        if (!active.has(name)) {
          this.api.events?.off(sub.eventType, sub.handler);
          this.subscriptions.delete(name);
        }
      }
    } catch (error) {
      this.api.logger?.error(`EventTriggerEngine refresh error: ${error}`);
    }
  }

  /**
   * A subscribed event fired — evaluate the optional condition, then emit
   * contract.event_triggered if it passes (or there is none).
   */
  private async handleFire(
    contractName: string,
    triggerConfig: EventTriggerConfig,
    eventPayload: unknown
  ): Promise<void> {
    try {
      if (triggerConfig.condition && !this.conditionMatches(triggerConfig.condition, eventPayload)) {
        return;
      }

      const row = await this.storage.getByName(contractName);
      if (!row || !row.enabled) return; // contract disabled/deleted between fire and lookup

      this.api.events?.emit(
        "contract.event_triggered",
        {
          type: "contract.event_triggered",
          contractId: String(row.id),
          contractName: row.name,
          contractVersion: row.version,
          kataName: row.target_kata,
          kataVersion: row.target_kata_version,
          eventType: triggerConfig.eventType,
          eventPayload: eventPayload && typeof eventPayload === "object" ? eventPayload : undefined,
          timestamp: Date.now(),
        },
        "event-trigger-engine"
      );

      this.api.logger?.info(
        `Event triggered: ${row.name} (${triggerConfig.eventType})`
      );
    } catch (error) {
      this.api.logger?.error(`Error handling event fire for '${contractName}': ${error}`);
    }
  }

  private conditionMatches(condition: Condition | ConditionGroup, eventPayload: unknown): boolean {
    const variables = eventPayload && typeof eventPayload === "object"
      ? (eventPayload as Record<string, unknown>)
      : {};
    return "type" in condition
      ? evaluateConditionGroup(condition, variables)
      : evaluateCondition(condition, variables);
  }
}
