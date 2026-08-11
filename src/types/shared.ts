/**
 * Shared types for Katas, Contracts, and Tasks
 * Extracted from techniques/types.ts during architecture refactor
 */

import type { Condition, ConditionGroup } from "../kata/conditions.js";

// ── Schema Utilities ────────────────────────────────────────────────────────────

/** Schema field definition */
export interface SchemaField {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  items?: SchemaField;
  properties?: Record<string, SchemaField>;
}

export type SchemaDefinition = Record<string, SchemaField>;

// ── Katas v2 ─────────────────────────────────────────────────────────────────────

/** Dependency declaration for a kata */
export interface KataDependency {
  kind: "skill" | "tool";
  name: string;
}

/** Database row for katas (v2 schema) */
export interface KataRowV2 {
  id: number;
  name: string;
  version: string;
  description: string;
  category: string | null;
  tags: string | null;
  definition: string;
  input_schema: string | null;
  output_schema: string | null;
  created_at: number;
  updated_at: number;
  author: string | null;
  deprecated: number;
  replacement_kata: string | null;
  usage_count: number;
  last_used_at: number | null;
  average_duration: number | null;
}

/** Filters for listing katas */
export interface KataListFilters {
  category?: string;
  tag?: string;
  deprecated?: boolean;
  sort?: "name" | "created" | "usage";
  limit?: number;
}

// ── Contracts v2 ─────────────────────────────────────────────────────────────────

export type TriggerType = "cron" | "event" | "webhook" | "manual";
export type FailureAction = "retry" | "alert" | "ignore";
export type BackoffType = "linear" | "exponential";

export interface CronTriggerConfig {
  type: "cron";
  expression: string;
  timezone?: string;
  description?: string;
}

export interface EventTriggerConfig {
  type: "event";
  eventType: string;
  description?: string;
  /** Optional guard evaluated against the firing event's payload before the contract runs. */
  condition?: Condition | ConditionGroup;
}

export interface WebhookTriggerConfig {
  type: "webhook";
  path: string;
  method?: string;
  auth?: string;
  description?: string;
}

export interface ManualTriggerConfig {
  type: "manual";
}

export type TriggerConfig =
  | CronTriggerConfig
  | EventTriggerConfig
  | WebhookTriggerConfig
  | ManualTriggerConfig;

export interface RetryConfig {
  maxAttempts: number;
  backoff: BackoffType;
  initialDelay: number;
  maxDelay: number;
  alertEmail?: string;
}

export interface AlertConfig {
  alertEmail: string;
}

export type FailureConfig = RetryConfig | AlertConfig | Record<string, never>;

/** Full contract definition */
export interface ContractV2Definition {
  name: string;
  version: string;
  description?: string;
  targetKata: string;
  targetKataVersion: string;
  parameters: Record<string, unknown>;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  onFailureAction: FailureAction;
  onFailureConfig?: FailureConfig;
  enabled: boolean;
  author?: string;
}

/** Database row for contracts v2 */
export interface ContractV2Row {
  id: number;
  name: string;
  version: string;
  description: string | null;
  target_kata: string;
  target_kata_version: string;
  parameters: string | null;
  trigger_type: string;
  trigger_config: string;
  on_failure_action: string;
  on_failure_config: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
  author: string | null;
  last_executed_at: number | null;
  next_scheduled_at: number | null;
  execution_count: number;
}

/** Filters for listing contracts */
export interface ContractListFilters {
  enabled?: boolean;
  triggerType?: TriggerType;
  kata?: string;
  sort?: "name" | "created" | "next_run";
  limit?: number;
}

// ── Tasks v2 ─────────────────────────────────────────────────────────────────────

export type TaskV2Status = "pending" | "running" | "completed" | "failed" | "canceled";

/** Database row for tasks v2 */
export interface TaskV2Row {
  id: number;
  task_id: string;
  source_contract: string | null;
  source_kata: string;
  source_kata_version: string;
  status: TaskV2Status;
  started_at: number | null;
  completed_at: number | null;
  duration: number | null;
  output: string | null;
  error: string | null;
  error_phase: string | null;
  created_at: number;
  updated_at: number;
}

export type PhaseStatus = "pending" | "running" | "completed" | "failed";

/** Database row for task phases */
export interface TaskPhaseRow {
  id: number;
  task_id: string;
  phase_name: string;
  phase_type: string | null;
  status: PhaseStatus;
  started_at: number | null;
  completed_at: number | null;
  duration: number | null;
  skill_name: string | null;
  tool_name: string | null;
  output: string | null;
  error: string | null;
}

/** Filters for listing tasks */
export interface TaskListFilters {
  status?: TaskV2Status;
  kata?: string;
  contract?: string;
  limit?: number;
}