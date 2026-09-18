/**
 * contract propose — AI-authoring for event/cron-triggered contracts ("reflexes").
 *
 * Intent → AI completion → parse → validate → preview → confirm → register,
 * reused by both the `contract propose` CLI command and the Chatty tool
 * (contracts.proposeReflex). This module only drafts — it never writes to
 * any table. Nothing goes live until the caller explicitly registers the
 * returned proposal (CLI: after a y/n prompt; Chatty: after an approval card).
 *
 * As of 2026-09-17 a contract drafts its own inline phase graph directly
 * (there is no more Kata registry to point an "existing" proposal at) —
 * every proposal now carries `phasesDsl`. Accepted tradeoff: two contracts
 * wanting the same phase sequence each carry their own DSL text now; there's
 * no shared, versioned artifact left to reuse across contracts.
 */

import type { DutyAPI } from "../types/index.js";
import { parsePhaseBlocks } from "./parser-v2.js";
import { validateContractPhases } from "./phase-compiler.js";
import { CONTRACT_PHASE_GRAMMAR } from "./phase-grammar.js";
import { describePhaseChain } from "./phase-format.js";
import { conditionToHuman } from "./conditions.js";
import type { Condition, ConditionGroup } from "./conditions.js";
import { cronToHuman } from "./cron.js";
import type { ContractV2Definition, TriggerConfig, ContractPhase } from "../types/shared.js";

export class ContractProposeError extends Error {
  /** Raw AI-drafted phases DSL, when the failure happened during phase
   *  parsing/validation — surfaced by callers so a human can see what the
   *  model actually produced. */
  rawDsl?: string;
}

export interface ContractProposal {
  contract: ContractV2Definition;
  phasesDsl: string;
  /** Deterministic, plain-language rendering of trigger + condition + phases — the
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
  phasesDsl: string;
}

function buildSystemPrompt(
  intent: string,
  availableSkills: { name: string; description: string; abilities: { name: string; description?: string; input: string[] }[] }[],
): string {
  const skillsList = availableSkills.length > 0
    ? availableSkills.map((s) => {
        const abilities = s.abilities.length > 0
          ? s.abilities.map((a) => `${a.name}${a.input.length ? `(${a.input.join(", ")})` : "()"}`).join(", ")
          : "(no abilities listed)";
        return `  - ${s.name}: ${s.description} — abilities: ${abilities}`;
      }).join("\n")
    : "  (none discovered)";

  return `You are a contract-authoring expert for the Ronin agent system. A "contract" binds a trigger (cron schedule or event) to a phase graph of work — when the trigger fires (and an optional condition holds), the phases run in order.

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
  "phasesDsl": "<the phases-block DSL text — see grammar below>"
}

IMPORTANT — choosing triggerType:
- Use "cron" whenever the intent is periodic/recurring on its own (words like "daily",
  "every morning", "each day", "the previous day's X", "weekly", "every N minutes") — do
  NOT invent a triggerType "event" eventType to represent a schedule; there is no such
  thing as an event that fires "once a day" or "for the previous day" in this system.
  A daily digest of yesterday's messages is ALWAYS a cron trigger (e.g. "0 9 * * *" for
  9am daily), never an event trigger.
- Use "event" only when the intent explicitly reacts to something happening in THIS app
  right now (e.g. "when a duty fails", "when trust drops below 40") — never invent an
  eventType name just to represent "new data is available" or "a day has passed";
  fetching/checking for new data belongs in the phases (via "run skill"), not in the
  trigger.
- CRITICAL: the trigger only decides WHEN the phases run — it never supplies data. If the
  intent needs data from somewhere (e.g. "discord messages"), the phases MUST have an
  explicit phase that fetches it (e.g. "run skill discord ability read_messages") before
  any phase that processes or forwards that data. Never skip the fetch phase and assume
  the trigger already provided the data.

Condition shape (optional, only for event triggers, use when the intent has a qualifier like "when X and Y", "only if Z"):
  A single condition: { "variable": "path.to.value", "operator": "==|!=|>|>=|<|<=|in|not_in|contains|starts_with|ends_with", "value": <any> }
  A group: { "type": "AND"|"OR", "conditions": [ <condition or group>, ... ] }
  "variable" is a dot-path into whatever payload the firing event carries (e.g. "trust_level", "rival.distance") — infer plausible field names from the intent.

Draft the phases for "phasesDsl" using this grammar. Each "run skill" phase action can only call a skill+ability listed below — never invent a skill or ability name that isn't in this list. If the intent needs a capability no listed skill provides, say so in the description rather than inventing one:

Available skills (name: description — abilities: ability(input params), ...):
${skillsList}

${CONTRACT_PHASE_GRAMMAR}

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

/** Real skill/ability existence check the phase compiler doesn't do itself (it only
 *  checks the phase graph's own shape — reachability/cycles/terminals — not whether a
 *  named skill/ability actually exists). */
function validateSkillReferences(
  phases: Record<string, ContractPhase>,
  availableSkills: { name: string; abilities: { name: string }[] }[],
): string[] {
  const errors: string[] = [];
  for (const phase of Object.values(phases)) {
    const action = phase.action;
    if (action.type !== "run") continue;
    const skill = availableSkills.find((s) => s.name.toLowerCase() === action.skill.toLowerCase());
    if (!skill) {
      const closest = availableSkills.find((s) => s.name.toLowerCase().includes(action.skill.toLowerCase()) || action.skill.toLowerCase().includes(s.name.toLowerCase()));
      const suggestion = closest ? ` Did you mean '${closest.name}' (use that exact spelling)?` : "";
      errors.push(`Skill '${action.skill}' (phase '${phase.name}') does not exist — it is not in the Available skills list.${suggestion}`);
      continue;
    }
    if (action.ability && !skill.abilities.some((a) => a.name.toLowerCase() === action.ability!.toLowerCase())) {
      const closestAbility = skill.abilities.find((a) => a.name.toLowerCase().includes(action.ability!.toLowerCase()) || action.ability!.toLowerCase().includes(a.name.toLowerCase()));
      const suggestion = closestAbility ? ` Did you mean '${closestAbility.name}' (use that exact spelling)?` : ` Valid abilities on '${action.skill}': ${skill.abilities.map((a) => a.name).join(", ")}.`;
      errors.push(`Ability '${action.ability}' (phase '${phase.name}') does not exist on skill '${action.skill}'.${suggestion}`);
    }
  }
  return errors;
}

async function attemptProposal(
  promptText: string,
  api: DutyAPI,
  availableSkills: { name: string; description: string; abilities: { name: string; description?: string; input: string[] }[] }[],
): Promise<ContractProposal> {
  const raw = await api.ai.complete(promptText);

  let parsed: RawProposalJSON;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (error) {
    throw new ContractProposeError(`AI did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed.name || !parsed.triggerType || !parsed.triggerConfig || !parsed.phasesDsl) {
    throw new ContractProposeError("AI proposal is missing required fields (name, triggerType, triggerConfig, phasesDsl)");
  }

  const triggerConfig = buildTriggerConfig(parsed.triggerConfig);

  let initialPhase: string;
  let phases: Record<string, ContractPhase>;
  try {
    const result = parsePhaseBlocks(parsed.phasesDsl.split("\n"), 0);
    initialPhase = result.initialPhase;
    phases = result.phases;
  } catch (error) {
    const proposeError = new ContractProposeError(
      `Drafted phases failed to parse: ${error instanceof Error ? error.message : String(error)}`
    );
    proposeError.rawDsl = parsed.phasesDsl;
    throw proposeError;
  }

  const validation = validateContractPhases(initialPhase, phases);
  if (!validation.valid) {
    const proposeError = new ContractProposeError(
      `Drafted phases failed validation:\n  - ${validation.errors.map((e) => e.message).join("\n  - ")}`
    );
    proposeError.rawDsl = parsed.phasesDsl;
    throw proposeError;
  }

  const referenceErrors = validateSkillReferences(phases, availableSkills);
  if (referenceErrors.length > 0) {
    const proposeError = new ContractProposeError(`Drafted phases reference skills/abilities that don't exist:\n  - ${referenceErrors.join("\n  - ")}`);
    proposeError.rawDsl = parsed.phasesDsl;
    throw proposeError;
  }

  const contract: ContractV2Definition = {
    name: parsed.name,
    version: "v1",
    description: parsed.description,
    initialPhase,
    phases,
    parameters: {},
    triggerType: parsed.triggerType,
    triggerConfig,
    onFailureAction: "ignore",
    enabled: true,
  };

  const preview = `Fires ${buildTriggerPreview(triggerConfig)} → runs ${describePhaseChain(initialPhase, phases)}${parsed.description ? ` — ${parsed.description}` : ""}`;

  return { contract, phasesDsl: parsed.phasesDsl, preview };
}

const MAX_ATTEMPTS = 4;

export async function proposeContract(intent: string, api: DutyAPI): Promise<ContractProposal> {
  if (!intent.trim()) {
    throw new ContractProposeError("Intent required");
  }

  const availableSkills = api.skills ? await api.skills.list_skills_with_abilities().catch(() => []) : [];

  const systemPrompt = buildSystemPrompt(intent, availableSkills);
  let promptText = systemPrompt;
  let lastError: ContractProposeError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptProposal(promptText, api, availableSkills);
    } catch (error) {
      lastError = error instanceof ContractProposeError ? error : new ContractProposeError(String(error));
      if (attempt === MAX_ATTEMPTS) break;
      // Feed the specific failure back and ask for a corrected JSON object only —
      // cheaper and more reliable than hoping a longer one-shot prompt gets it right.
      promptText = `${systemPrompt}\n\nYour previous attempt failed with this error:\n${lastError.message}\n\nFix ONLY that issue and return the corrected JSON object (same rules as before — ONLY a single JSON object, no markdown fences, no explanation).`;
    }
  }

  throw lastError ?? new ContractProposeError("Proposal failed for an unknown reason");
}
