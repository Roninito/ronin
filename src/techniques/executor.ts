/**
 * Technique Executor
 *
 * Executes a technique given its definition and input parameters.
 * - composite: executes steps sequentially, interpolating variables
 * - custom: dynamically imports and calls the handler module
 */

import type { AgentAPI } from "../types/index.js";
import type { TechniqueDefinition, TechniqueStep, ReturnMapping } from "./types.js";
import { TechniqueRegistry } from "./storage.js";
import { TechniqueParser } from "./parser.js";

export interface ExecutionContext {
  api: AgentAPI;
  taskId?: string;
  contractName?: string;
}

export interface TechniqueExecutionResult {
  output: unknown;
  durationMs: number;
  steps: Array<{
    name: string;
    durationMs: number;
    output: unknown;
    error?: string;
  }>;
}

export class TechniqueExecutor {
  private registry: TechniqueRegistry;
  private parser: TechniqueParser;

  constructor(private api: AgentAPI) {
    this.registry = new TechniqueRegistry(api);
    this.parser = new TechniqueParser();
  }

  /**
   * Execute a technique by name with given params.
   */
  async execute(
    techniqueName: string,
    params: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<TechniqueExecutionResult> {
    const row = await this.registry.get(techniqueName);
    if (!row) throw new Error(`Technique not found: ${techniqueName}`);
    if (row.deprecated) {
      const repl = row.replacement_technique ? ` Use "${row.replacement_technique}" instead.` : "";
      throw new Error(`Technique "${techniqueName}" is deprecated.${repl}`);
    }

    const def = this.parser.parse(row.definition);
    const startTime = Date.now();

    let result: TechniqueExecutionResult;
    if (def.type === "composite") {
      result = await this.executeComposite(def, params, ctx);
    } else {
      result = await this.executeCustom(def, params, ctx);
    }

    const totalDuration = Date.now() - startTime;
    await this.registry.recordExecution(techniqueName, totalDuration);
    return { ...result, durationMs: totalDuration };
  }

  /**
   * Execute a composite technique step-by-step.
   */
  private async executeComposite(
    def: TechniqueDefinition,
    params: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<TechniqueExecutionResult> {
    if (def.ast.type !== "composite") throw new Error("Expected composite AST");

    const variables: Record<string, unknown> = { input: params };
    const stepResults: TechniqueExecutionResult["steps"] = [];

    for (const step of def.ast.steps) {
      const stepStart = Date.now();
      try {
        const stepParams = interpolateObject(step.params, variables);
        const output = await this.runSkillOrTool(step, stepParams, ctx);
        const stepDuration = Date.now() - stepStart;

        if (step.output) variables[step.output] = output;
        stepResults.push({ name: step.name, durationMs: stepDuration, output });
      } catch (err: any) {
        const stepDuration = Date.now() - stepStart;
        stepResults.push({ name: step.name, durationMs: stepDuration, output: null, error: err.message });
        throw new Error(`Step "${step.name}" failed: ${err.message}`);
      }
    }

    const output = interpolateObject(def.ast.returnMapping, variables);
    return { output, durationMs: 0, steps: stepResults };
  }

  /**
   * Execute a custom technique via its handler file.
   */
  private async executeCustom(
    def: TechniqueDefinition,
    params: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<TechniqueExecutionResult> {
    if (def.ast.type !== "custom") throw new Error("Expected custom AST");

    const start = Date.now();
    const handler = await import(def.ast.handlerPath);
    const fn = handler.default ?? handler.execute;
    if (typeof fn !== "function") {
      throw new Error(`Handler at "${def.ast.handlerPath}" does not export a default function`);
    }

    const output = await fn(params, ctx);
    return { output, durationMs: Date.now() - start, steps: [] };
  }

  private async runSkillOrTool(
    step: TechniqueStep,
    params: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<unknown> {
    if (step.runType === "skill") {
      // Delegate to skills plugin if available
      if (ctx.api.plugins?.has("skills")) {
        // Auto-detect ability: use step.ability if set, otherwise use the first available ability
        let ability = step.ability;
        if (!ability) {
          try {
            const detail = await ctx.api.plugins.call("skills", "explore_skill", step.runName, false) as { abilities?: Array<{ name: string }> };
            ability = detail?.abilities?.[0]?.name;
          } catch { /* ignore — will fail below if no ability */ }
        }
        const result = await ctx.api.plugins.call("skills", "use_skill", step.runName, { ability, params }) as { success: boolean; output?: unknown; error?: string };
        if (!result.success) throw new Error(result.error ?? "Skill returned failure");
        return result.output;
      }
      throw new Error(`Skills plugin not available to run skill "${step.runName}"`);
    } else {
      // Tool execution
      if (ctx.api.tools) {
        return (ctx.api.tools as any).execute(step.runName, params);
      }
      throw new Error(`Tools API not available to run tool "${step.runName}"`);
    }
  }
}

// ── Variable interpolation ────────────────────────────────────────────────────

/**
 * Recursively interpolate variable references in an object/value.
 * String values that look like a variable path (e.g. "input.channelId", "messages.count")
 * are resolved against the variables map.
 */
export function interpolateObject(
  obj: unknown,
  variables: Record<string, unknown>,
): unknown {
  if (typeof obj === "string") return resolveRef(obj, variables);
  if (Array.isArray(obj)) return obj.map((v) => interpolateObject(v, variables));
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = interpolateObject(v, variables);
    }
    return result;
  }
  return obj;
}

/**
 * Resolve a variable reference string (e.g. "input.channelId") against variables.
 * If the string doesn't look like a path, returns it as-is.
 */
function resolveRef(ref: string, variables: Record<string, unknown>): unknown {
  // If it's a dot-path without spaces, try resolving as variable reference
  if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(ref)) {
    const parts = ref.split(".");
    let val: unknown = variables;
    for (const part of parts) {
      if (val === null || val === undefined || typeof val !== "object") return ref;
      val = (val as Record<string, unknown>)[part];
    }
    if (val !== undefined) return val;
  }
  return ref;
}
