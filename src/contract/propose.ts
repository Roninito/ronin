/**
 * contract propose — AI-authoring for event/cron-triggered contracts ("reflexes").
 *
 * Mirrors `kata propose`'s pattern (src/cli/commands/kata.ts: intent → AI
 * completion → parse → validate → preview → confirm → register), reused by
 * both the `contract propose` CLI command and the Chatty tool
 * (contracts.proposeReflex). This module only drafts — it never writes to
 * any table. Nothing goes live until the caller explicitly registers the
 * returned proposal (CLI: after a y/n prompt; Chatty: after an approval card).
 */

import type { DutyAPI } from "../types/index.js";
import { KataParser } from "../kata/parser.js";
import { KataCompiler } from "../kata/compiler.js";
import { KataStorage } from "../task/storage.js";
import { KATA_DSL_GRAMMAR } from "../kata/dsl-grammar.js";
import { conditionToHuman } from "../kata/conditions.js";
import type { Condition, ConditionGroup } from "../kata/conditions.js";
import type { CompiledKata } from "../kata/types.js";
import { cronToHuman } from "./cron.js";
import type { ContractV2Definition, TriggerConfig } from "../types/shared.js";

export class ContractProposeError extends Error {
  /** Raw AI-drafted kata DSL, when the failure happened during kata compilation —
   *  surfaced by callers (matching kata propose's own "print raw DSL on failure"
   *  behavior) so a human can see what the model actually produced. */
  rawDsl?: string;
}

export interface ContractProposal {
  contract: ContractV2Definition;
  kataDsl?: string;
  kataCompiled?: CompiledKata;
  /** Deterministic, plain-language rendering of trigger + condition + kata — the
   *  only thing an approval UI should ever show a human (never raw JSON). */
  preview: string;
}

interface RawProposalJSON {
  name: string;
  description?: string;
  triggerType: "cron" | "event";
  triggerConfig: {
    type: "cron";
    expression: string;
  } | {
    type: "event";
    eventType: string;
    condition?: Condition | ConditionGroup;
  };
  existingKataName?: string | null;
  existingKataVersion?: string | null;
  newKataDsl?: string | null;
}

function buildSystemPrompt(intent: string, existingKatas: { name: string; version: string; requiredSkills: string[] }[]): string {
  const kataList = existingKatas.length > 0
    ? existingKatas.map((k) => `  - ${k.name} v${k.version}${k.requiredSkills.length ? ` (skills: ${k.requiredSkills.join(", ")})` : ""}`).join("\n")
    : "  (none registered)";

  return `You are a contract-authoring expert for the Ronin agent system. A "contract" binds a trigger (cron schedule or event) to a kata (a phase-graph of work) — when the trigger fires (and an optional condition holds), the kata runs.

Given a plain-English intent, respond with ONLY a single JSON object (no markdown fences, no explanation) matching this shape:

{
  "name": "kebab-case-name",
  "description": "one sentence",
  "triggerType": "cron" | "event",
  "triggerConfig":
    // if triggerType is "cron":
    { "type": "cron", "expression": "<5-field cron expression>" }
    // if triggerType is "event":
    { "type": "event", "eventType": "dot.separated.event.name", "condition": <optional, see below> },
  "existingKataName": "<name from the Existing katas list below, or null>",
  "existingKataVersion": "<version, or null>",
  "newKataDsl": "<a full Kata DSL definition, or null — set this ONLY if existingKataName is null>"
}

Exactly one of existingKataName or newKataDsl must be non-null, never both.

Condition shape (optional, only for event triggers, use when the intent has a qualifier like "when X and Y", "only if Z"):
  A single condition: { "variable": "path.to.value", "operator": "==|!=|>|>=|<|<=|in|not_in|contains|starts_with|ends_with", "value": <any> }
  A group: { "type": "AND"|"OR", "conditions": [ <condition or group>, ... ] }
  "variable" is a dot-path into whatever payload the firing event carries (e.g. "trust_level", "rival.distance") — infer plausible field names from the intent.

Existing katas you may target instead of drafting a new one:
${kataList}

If none of the existing katas fit the intent, draft a new one-phase (or few-phase) kata instead, using this grammar for newKataDsl:

${KATA_DSL_GRAMMAR}

User intent: ${intent}`;
}

function stripFences(raw: string): string {
  return raw.replace(/^```[a-z]*\n?/im, "").replace(/\n?```$/im, "").trim();
}

function buildTriggerConfig(raw: RawProposalJSON["triggerConfig"]): TriggerConfig {
  if (raw.type === "cron") {
    if (!raw.expression || typeof raw.expression !== "string") {
      throw new ContractProposeError("AI proposal is missing a valid cron expression");
    }
    return { type: "cron", expression: raw.expression };
  }
  if (raw.type === "event") {
    if (!raw.eventType || typeof raw.eventType !== "string") {
      throw new ContractProposeError("AI proposal is missing a valid event type");
    }
    return { type: "event", eventType: raw.eventType, condition: raw.condition };
  }
  throw new ContractProposeError(`Unknown trigger type: ${(raw as any).type}`);
}

function buildTriggerPreview(triggerConfig: TriggerConfig): string {
  if (triggerConfig.type === "cron") {
    return `on schedule: ${cronToHuman(triggerConfig.expression)}`;
  }
  if (triggerConfig.type === "event") {
    const conditionText = triggerConfig.condition ? ` when ${conditionToHuman(triggerConfig.condition)}` : "";
    return `when ${triggerConfig.eventType} fires${conditionText}`;
  }
  return `on trigger: ${triggerConfig.type}`;
}

/**
 * Draft a contract (and, if needed, a new one-phase kata) from a plain-English
 * intent. Pure drafting — writes nothing to any table.
 */
export async function proposeContract(intent: string, api: DutyAPI): Promise<ContractProposal> {
  if (!intent.trim()) {
    throw new ContractProposeError("Intent required");
  }

  const kataStorage = new KataStorage(api);
  await kataStorage.init();
  const existingKatas = await kataStorage.list();

  const systemPrompt = buildSystemPrompt(intent, existingKatas);
  const raw = await api.ai.complete(systemPrompt);

  let parsed: RawProposalJSON;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (error) {
    throw new ContractProposeError(`AI did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed.name || !parsed.triggerType || !parsed.triggerConfig) {
    throw new ContractProposeError("AI proposal is missing required fields (name, triggerType, triggerConfig)");
  }

  const triggerConfig = buildTriggerConfig(parsed.triggerConfig);

  let targetKata: string;
  let targetKataVersion: string;
  let kataDsl: string | undefined;
  let kataCompiled: CompiledKata | undefined;
  let kataPreview: string;

  if (parsed.newKataDsl) {
    const parser = new KataParser();
    const compiler = new KataCompiler();
    try {
      const ast = parser.parse(parsed.newKataDsl);
      kataCompiled = compiler.compile(ast);
    } catch (error) {
      const proposeError = new ContractProposeError(
        `Drafted kata failed validation: ${error instanceof Error ? error.message : String(error)}`
      );
      proposeError.rawDsl = parsed.newKataDsl;
      throw proposeError;
    }
    kataDsl = parsed.newKataDsl;
    targetKata = kataCompiled.name;
    targetKataVersion = kataCompiled.version;
    const phaseCount = Object.keys(kataCompiled.phases).length;
    kataPreview = `drafts a new kata '${targetKata}' (${phaseCount} phase${phaseCount === 1 ? "" : "s"})`;
  } else if (parsed.existingKataName) {
    const exists = existingKatas.some((k) => k.name === parsed.existingKataName);
    if (!exists) {
      throw new ContractProposeError(
        `AI referenced kata '${parsed.existingKataName}' which is not registered — refusing to target an unverified kata`
      );
    }
    targetKata = parsed.existingKataName;
    targetKataVersion = parsed.existingKataVersion ?? "v1";
    kataPreview = `runs kata '${targetKata}'`;
  } else {
    throw new ContractProposeError("AI proposal named neither an existing kata nor drafted a new one");
  }

  const contract: ContractV2Definition = {
    name: parsed.name,
    version: "v1",
    description: parsed.description,
    targetKata,
    targetKataVersion,
    parameters: {},
    triggerType: parsed.triggerType,
    triggerConfig,
    onFailureAction: "ignore",
    enabled: true,
  };

  const preview = `Fires ${buildTriggerPreview(triggerConfig)} → ${kataPreview}${parsed.description ? ` — ${parsed.description}` : ""}`;

  return { contract, kataDsl, kataCompiled, preview };
}
