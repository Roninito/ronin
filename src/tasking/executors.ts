/**
 * Executor resolution + dispatch for TodoAgent's command queue.
 *
 * No Tool/Skill split (see tasking-executor-spec.md redesign notes): every
 * coding executor (claude/opencode/qwen/cursor/gemini) is the same shape —
 * a Plugin with an execute(instruction, options) -> {success, output, error}
 * method, invoked directly via api.plugins.call(). Executor selection is
 * deterministic (card label / config), not an LLM tool choice, so there's
 * no function-calling schema to design here.
 */

import type { DutyAPI } from "../types/index.js";
import type { TaskingConfig } from "../config/types.js";

export type ExecutorName = "ronin" | "claude" | "opencode" | "qwen" | "cursor" | "gemini";

export const CODING_EXECUTORS: ExecutorName[] = ["claude", "opencode", "qwen", "cursor", "gemini"];

export function isCodingExecutor(name: ExecutorName): name is Exclude<ExecutorName, "ronin"> {
  return name !== "ronin";
}

export interface CodingExecutorResult {
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface CodingExecutorOptions {
  workspace: string;
  timeout?: number;
  sessionId?: string;
}

const PLUGIN_NAME: Record<Exclude<ExecutorName, "ronin">, string> = {
  claude: "claude-cli",
  opencode: "opencode-cli",
  qwen: "qwen-cli",
  cursor: "cursor-cli",
  gemini: "gemini-cli",
};

/**
 * Builds the plugin-specific options object. Most CLI plugins use
 * `workspace`, but cursor-cli.ts uses `projectPath` — normalized here so
 * callers only ever deal with CodingExecutorOptions.
 */
function buildPluginOptions(executor: Exclude<ExecutorName, "ronin">, options: CodingExecutorOptions): Record<string, unknown> {
  const base: Record<string, unknown> = { timeout: options.timeout };
  if (executor === "cursor") {
    base.projectPath = options.workspace;
  } else {
    base.workspace = options.workspace;
  }
  if (executor === "claude" && options.sessionId) {
    base.sessionId = options.sessionId;
  }
  return base;
}

/**
 * Parses `#claude` / `#opencode` / `#qwen` / `#cursor` / `#gemini` from a
 * card's labels (JSON array or comma-separated string, matching how
 * TodoAgent already stores kanban_cards.labels).
 */
export function executorFromLabels(labels: string | string[] | null | undefined): ExecutorName | null {
  if (!labels) return null;
  const list = Array.isArray(labels) ? labels : safeParseLabels(labels);
  for (const label of list) {
    const clean = label.replace(/^#/, "").toLowerCase();
    if ((CODING_EXECUTORS as string[]).includes(clean)) {
      return clean as ExecutorName;
    }
  }
  return null;
}

function safeParseLabels(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to comma-split
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Cheap heuristic for "does this instruction imply file/repo work" — used
 * only to decide whether an untagged command should default into
 * tasking.defaultCodingExecutor instead of staying on the ronin path. Not an
 * LLM call; a fast gate, matching the spec's "Analyze detects file/repo
 * implication" step.
 */
const FILE_IMPLICATION_PATTERN =
  /\b(file|files|repo|repository|branch|commit|refactor|implement|bug|fix|codebase|function|class|module|pull request|PR|merge|diff|patch)\b/i;

// Mention of a filename with a common code/doc extension (e.g. "payment.ts").
const FILE_EXTENSION_PATTERN = /\b[\w.-]+\.(ts|tsx|js|jsx|py|go|rs|rb|java|c|cpp|h|css|html|md|json|yaml|yml|sql)\b/i;

export function hasFileImplication(instruction: string): boolean {
  return FILE_IMPLICATION_PATTERN.test(instruction) || FILE_EXTENSION_PATTERN.test(instruction);
}

/**
 * Resolution order: explicit card label -> config default (only if the
 * instruction implies file/repo work) -> ronin.
 */
export function resolveExecutor(
  labels: string | string[] | null | undefined,
  instruction: string,
  config: Pick<TaskingConfig, "defaultCodingExecutor">
): ExecutorName {
  const labeled = executorFromLabels(labels);
  if (labeled) return labeled;

  if (hasFileImplication(instruction)) {
    return config.defaultCodingExecutor;
  }

  return "ronin";
}

/**
 * Runs a coding executor plugin and normalizes its result shape.
 * Throws if the executor plugin isn't installed/registered.
 */
export async function runCodingExecutor(
  api: DutyAPI,
  executor: Exclude<ExecutorName, "ronin">,
  instruction: string,
  options: CodingExecutorOptions
): Promise<CodingExecutorResult> {
  const pluginName = PLUGIN_NAME[executor];
  if (!api.plugins.has(pluginName)) {
    return {
      success: false,
      output: "",
      error: `Executor plugin not installed: ${pluginName}`,
    };
  }

  const pluginOptions = buildPluginOptions(executor, options);
  const result = (await api.plugins.call(pluginName, "execute", instruction, pluginOptions)) as CodingExecutorResult;
  return result;
}
