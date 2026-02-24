/**
 * Contract Types — Phase 7
 *
 * Contracts are the "trigger binding" layer that connects events/cron to katas.
 *
 * Contract structure:
 *   trigger (cron or event) → spin up task for kata
 *
 * Example:
 *   contract monthly.finance.audit v1
 *     trigger cron 0 3 1 * *
 *     run kata finance.audit v2
 */

/**
 * Cron trigger - based on cron expression
 */
export interface CronTrigger {
  type: "cron";
  expression: string; // "0 3 1 * *" (minute hour day month weekday)
}

/**
 * Event trigger - based on event name
 */
export interface EventTrigger {
  type: "event";
  eventType: string; // "task.completed", "user.requested.audit", etc
}

/**
 * Union of all trigger types
 */
export type ContractTrigger = CronTrigger | EventTrigger;

/**
 * Kata reference with version
 */
export interface KataReference {
  name: string; // "finance.audit"
  version: string; // "v1", "v2"
}

/**
 * Contract - trigger → kata binding
 */
export interface Contract {
  id: string; // "monthly-audit-001"
  name: string; // "monthly.finance.audit"
  version: string; // "v1"
  trigger: ContractTrigger;
  kata: KataReference;
  active: boolean;
  createdAt: number;
  updatedAt: number;
  description?: string; // Optional human-readable description
}

/**
 * Contract AST (parsed from DSL)
 */
export interface ContractAST {
  type: "contract";
  name: string;
  version: string;
  trigger: ContractTrigger;
  kata: KataReference;
}

/**
 * Token for lexer
 */
export interface Token {
  type: string;
  value: string;
  line: number;
  column: number;
}

/**
 * Validation error for contract
 */
export interface ContractValidationError {
  field: string;
  message: string;
  line?: number;
  column?: number;
}

/**
 * Database row for contract
 */
export interface ContractRow {
  id: string;
  name: string;
  version: string;
  trigger_type: "cron" | "event";
  trigger_value: string; // cron expression or event type
  kata_name: string;
  kata_version: string;
  active: number; // 0 or 1
  description?: string;
  created_at: number;
  updated_at: number;
}
