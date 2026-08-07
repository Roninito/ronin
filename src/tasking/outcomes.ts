/**
 * Executor outcome logging (spec §9.5, minus the policy). Cheap inserts at
 * every terminal state — useful for manual analysis on their own. No
 * routing policy is built on top of this: no bandit/contextual-learning
 * infrastructure exists anywhere in this codebase, and building one is a
 * separate research project, not part of this integration. If that ever
 * changes, this table is the data it would need — already being collected.
 */

import type { DutyAPI } from "../types/index.js";

export type ExecutorOutcome = "success" | "failed" | "conflict" | "rejected";

export interface RecordOutcomeParams {
  commandId: string;
  executor: string;
  outcome: ExecutorOutcome;
  taskFeatures?: Record<string, unknown>;
  rounds?: number;
  attempts?: number;
  costTokens?: number;
  wallMs?: number;
}

export async function recordExecutorOutcome(api: DutyAPI, params: RecordOutcomeParams): Promise<void> {
  await api.db.execute(
    `INSERT INTO executor_outcomes (id, command_id, executor, task_features, outcome, rounds, attempts, cost_tokens, wall_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      params.commandId,
      params.executor,
      JSON.stringify(params.taskFeatures ?? {}),
      params.outcome,
      params.rounds ?? null,
      params.attempts ?? null,
      params.costTokens ?? null,
      params.wallMs ?? null,
      Date.now(),
    ]
  );
}
