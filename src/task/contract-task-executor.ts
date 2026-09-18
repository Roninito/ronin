/**
 * Contract Task Executor
 *
 * Replaces src/task/executor.ts's role (2026-09-17) — runs a task's phases
 * straight off the Contract's inline phase graph via ContractTaskEngine,
 * using the same SkillAdapter every kata "run skill" phase already called
 * through (it was always kata-agnostic).
 *
 * Two deliberate behavior changes from the old executor, not just a port:
 *
 * 1. `executePhase` loops through consecutive "run" phases in one call,
 *    stopping only at "wait"/"complete"/"fail" — the old executor advanced
 *    exactly one phase per call and relied on a 30-minute poll tick to
 *    advance further, so a 3-phase contract like the live morning-briefing
 *    one could take up to 90 minutes to finish a run that should complete in
 *    seconds. Cron/event triggers call `executePhase` once immediately on
 *    spawn (see duties/task-executor.ts); the poll tick is now a safety net.
 * 2. A task left `waiting_for_event` across a process restart used to be
 *    orphaned forever — nothing re-subscribed its event listener. `pollAndExecute`
 *    now re-arms a listener for any such task this process doesn't remember
 *    arming, which matters directly for the Alpaca portfolio contract's
 *    human-approval gate.
 *
 * Also, unlike the old executor, a failed phase does not re-throw out of
 * `executePhase` — the failure is recorded on the task row either way, and
 * re-throwing would abort `pollAndExecute`'s loop over the *other* pending
 * tasks in the same tick.
 */

import type { DutyAPI } from "../types/index.js";
import { ContractTaskEngine } from "./contract-task-engine.js";
import { SkillAdapter } from "../skills/adapter.js";
import type { ContractPhase } from "../types/shared.js";

export class ContractTaskExecutor {
  private engine: ContractTaskEngine;
  private adapter: SkillAdapter;
  /** Task IDs with an armed `wait event` listener in *this* process. */
  private waitingListeners = new Set<string>();

  constructor(private api: DutyAPI) {
    this.engine = new ContractTaskEngine(api);
    this.adapter = new SkillAdapter(api);
  }

  /** Advance every pending/running task once, and re-arm any orphaned waiters. */
  async pollAndExecute(): Promise<void> {
    const [pending, running] = await Promise.all([
      this.engine.getTasksByStatus("pending"),
      this.engine.getTasksByStatus("running"),
    ]);
    for (const task of [...pending, ...running]) {
      await this.executePhase(task.task_id);
    }

    const waiting = await this.engine.getTasksByStatus("waiting_for_event");
    for (const task of waiting) {
      if (this.waitingListeners.has(task.task_id)) continue;
      if (!task.source_contract || !task.current_phase) continue;
      const graph = await this.engine.getPhaseGraph(task.source_contract);
      const phase = graph?.phases[task.current_phase];
      if (phase) this.armWaitListener(task.task_id, phase);
    }
  }

  /**
   * Run a task from its current phase, looping through consecutive `run`
   * phases until it completes, fails, or hits a `wait` phase (which suspends
   * it and returns). Does not throw — failures are recorded on the task row.
   */
  async executePhase(taskId: string): Promise<void> {
    try {
      for (;;) {
        const task = await this.engine.getTask(taskId);
        if (!task) return;
        if (task.status === "waiting_for_event" || task.status === "completed" || task.status === "failed") return;
        if (!task.source_contract) throw new Error(`Task '${taskId}' has no source contract`);
        if (!task.current_phase) throw new Error(`Task '${taskId}' has no current phase`);

        const graph = await this.engine.getPhaseGraph(task.source_contract);
        if (!graph) throw new Error(`Contract '${task.source_contract}' not found`);
        const phase = graph.phases[task.current_phase];
        if (!phase) throw new Error(`Phase '${task.current_phase}' not found in contract '${task.source_contract}'`);

        if (phase.action.type === "run") {
          await this.executeSkillPhase(taskId, phase);
        } else {
          await this.executeWaitPhase(taskId, phase);
          return; // suspended — don't process a terminal, task is now waiting
        }

        if (phase.terminal === "complete") {
          await this.engine.complete(taskId);
          return;
        } else if (phase.terminal === "fail") {
          await this.engine.fail(taskId, `Phase '${phase.name}' explicitly failed`, phase.name);
          return;
        } else if (phase.next) {
          await this.engine.advance(taskId, phase.next);
          continue; // keep looping through consecutive run phases
        }
        return; // shouldn't happen post-validation (every phase has next or terminal)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.engine.fail(taskId, `Execution failed: ${message}`);
      } catch (failError) {
        console.error(`[contract-task-executor] Failed to mark task '${taskId}' as failed:`, failError);
      }
    }
  }

  private async executeSkillPhase(taskId: string, phase: ContractPhase): Promise<void> {
    if (phase.action.type !== "run") return;
    const { skill, ability } = phase.action;

    if (!(await this.adapter.validateSkillExists(skill))) {
      throw new Error(`Skill '${skill}' not registered`);
    }

    const variables = await this.engine.getVariables(taskId);
    const result = await this.adapter.executeSkillWithTimeout(skill, variables, undefined, ability);
    await this.engine.setVariables(taskId, { ...variables, [phase.name]: result });
  }

  private async executeWaitPhase(taskId: string, phase: ContractPhase): Promise<void> {
    if (phase.action.type !== "wait") return;
    await this.engine.waitForEvent(taskId);
    this.armWaitListener(taskId, phase);
  }

  /** Idempotent — safe to call again for a task that already has a listener armed. */
  private armWaitListener(taskId: string, phase: ContractPhase): void {
    if (phase.action.type !== "wait") return;
    if (this.waitingListeners.has(taskId)) return;
    this.waitingListeners.add(taskId);
    const { eventName, timeout } = phase.action;

    const handler = async (event: unknown) => {
      try {
        const task = await this.engine.getTask(taskId);
        if (!task || task.status !== "waiting_for_event") return; // already resolved/timed out
        this.waitingListeners.delete(taskId);

        const variables = await this.engine.getVariables(taskId);
        await this.engine.setVariables(taskId, {
          ...variables,
          [phase.name]: { event_received: event, event_timestamp: Date.now(), event_name: eventName },
        });

        if (phase.terminal === "complete") {
          await this.engine.complete(taskId);
        } else if (phase.terminal === "fail") {
          await this.engine.fail(taskId, `Phase '${phase.name}' explicitly failed`, phase.name);
        } else if (phase.next) {
          await this.engine.advance(taskId, phase.next);
          await this.executePhase(taskId); // resume the run-phase loop from here
        }
      } catch (e) {
        this.waitingListeners.delete(taskId);
        await this.engine.fail(taskId, `Error handling event: ${e instanceof Error ? e.message : String(e)}`, phase.name);
      }
    };

    this.api.events?.on(eventName, handler);

    if (timeout && timeout > 0) {
      setTimeout(async () => {
        try {
          const task = await this.engine.getTask(taskId);
          if (task && task.status === "waiting_for_event") {
            this.waitingListeners.delete(taskId);
            await this.engine.fail(taskId, `Timeout waiting for event '${eventName}' after ${timeout}ms`, phase.name);
          }
        } catch {
          // Ignore cleanup errors — the task will surface as stuck via the
          // dashboard/CLI regardless.
        }
      }, timeout);
    }
  }
}
