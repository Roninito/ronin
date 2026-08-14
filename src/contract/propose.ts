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

function buildSystemPrompt(
  intent: string,
  existingKatas: { name: string; version: string; requiredSkills: string[] }[],
  availableSkills: { name: string; description: string; abilities: { name: string; description?: string; input: string[] }[] }[],
): string {
  const kataList = existingKatas.length > 0
    ? existingKatas.map((k) => `  - ${k.name} v${k.version}${k.requiredSkills.length ? ` (skills: ${k.requiredSkills.join(", ")})` : ""}`).join("\n")
    : "  (none registered)";

  const skillsList = availableSkills.length > 0
    ? availableSkills.map((s) => {
        const abilities = s.abilities.length > 0
          ? s.abilities.map((a) => `${a.name}${a.input.length ? `(${a.input.join(", ")})` : "()"}`).join(", ")
          : "(no abilities listed)";
        return `  - ${s.name}: ${s.description} — abilities: ${abilities}`;
      }).join("\n")
    : "  (none discovered)";

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
  fetching/checking for new data belongs in the kata's phases (via "run skill"), not in
  the trigger.
- CRITICAL: the trigger only decides WHEN the kata runs — it never supplies data. If the
  intent needs data from somewhere (e.g. "discord messages"), the kata MUST have an
  explicit phase that fetches it (e.g. "run skill discord ability read_messages") before
  any phase that processes or forwards that data. Never skip the fetch phase and assume
  the trigger already provided the data.

IMPORTANT — katas and skills are different things, do not confuse them:
- A "kata" is a complete named automation (format "domain.action", e.g. "discord-daily-digest")
  that may already be registered and ready to reuse as-is. existingKataName may ONLY be a name
  copied verbatim from the "Existing katas" list below — never a skill name.
- A "skill" (e.g. "discord", "telegram", "summarize") is a single building block a kata's phases
  call via "run skill <skill-name>" inside newKataDsl. Skills are never valid values for
  existingKataName, even if a skill and a kata happen to share a similar name.
- If the "Existing katas" list says "(none registered)", existingKataName MUST be null and you
  MUST draft newKataDsl instead.

Condition shape (optional, only for event triggers, use when the intent has a qualifier like "when X and Y", "only if Z"):
  A single condition: { "variable": "path.to.value", "operator": "==|!=|>|>=|<|<=|in|not_in|contains|starts_with|ends_with", "value": <any> }
  A group: { "type": "AND"|"OR", "conditions": [ <condition or group>, ... ] }
  "variable" is a dot-path into whatever payload the firing event carries (e.g. "trust_level", "rival.distance") — infer plausible field names from the intent.

Existing katas you may target instead of drafting a new one:
${kataList}

If none of the existing katas fit the intent, draft a new one-phase (or few-phase) kata instead, using this grammar for newKataDsl. Each "run skill" phase action can only call a skill+ability listed below — never invent a skill or ability name that isn't in this list. If the intent needs a capability no listed skill provides, say so in the description rather than inventing one:

Available skills (name: description — abilities: ability(input params), ...):
${skillsList}

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
/** Real skill/ability existence check the DSL compiler doesn't do itself (it only
 *  checks "used implies declared in requires", not "does this skill/ability exist"). */
/** The model reliably gets the skill/ability names and phase logic right but
 *  intermittently forgets a "requires skill X" line for every skill it uses
 *  in a "run skill X" phase — a purely mechanical bookkeeping slip the DSL
 *  compiler treats as fatal. Deterministically patch it rather than burning a
 *  retry (an LLM call) on something regex can fix for free. */
function fixMissingRequiresLines(dsl: string): string {
  const usedSkills = new Set<string>();
  for (const m of dsl.matchAll(/\brun\s+skill\s+(\S+)/g)) if (m[1]) usedSkills.add(m[1]);
  const declaredSkills = new Set<string>();
  for (const m of dsl.matchAll(/\brequires\s+skill\s+(\S+)/g)) if (m[1]) declaredSkills.add(m[1]);
  const missing = [...usedSkills].filter((s) => !declaredSkills.has(s));
  if (missing.length === 0) return dsl;

  const lines = dsl.split("\n");
  const newRequiresLines = missing.map((s) => `  requires skill ${s}`);
  const lastRequiresIdx = lines.reduce((acc, line, i) => (/^\s*requires\s+skill\b/.test(line) ? i : acc), -1);
  if (lastRequiresIdx >= 0) {
    lines.splice(lastRequiresIdx + 1, 0, ...newRequiresLines);
  } else {
    const kataLineIdx = lines.findIndex((line) => /^\s*kata\s+\S+\s+v\d+/.test(line));
    lines.splice(kataLineIdx + 1, 0, ...newRequiresLines);
  }
  return lines.join("\n");
}

function validateSkillReferences(
  compiled: CompiledKata,
  availableSkills: { name: string; abilities: { name: string }[] }[],
): string[] {
  const errors: string[] = [];
  for (const phase of Object.values(compiled.phases)) {
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
  existingKatas: { name: string; version: string; requiredSkills: string[] }[],
  availableSkills: { name: string; description: string; abilities: { name: string; description?: string; input: string[] }[] }[],
): Promise<ContractProposal> {
  const raw = await api.ai.complete(promptText);

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
    parsed.newKataDsl = fixMissingRequiresLines(parsed.newKataDsl);
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
    const referenceErrors = validateSkillReferences(kataCompiled, availableSkills);
    if (referenceErrors.length > 0) {
      const proposeError = new ContractProposeError(`Drafted kata references skills/abilities that don't exist:\n  - ${referenceErrors.join("\n  - ")}`);
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

const MAX_ATTEMPTS = 4;

export async function proposeContract(intent: string, api: DutyAPI): Promise<ContractProposal> {
  if (!intent.trim()) {
    throw new ContractProposeError("Intent required");
  }

  const kataStorage = new KataStorage(api);
  await kataStorage.init();
  const existingKatas = await kataStorage.list();
  const availableSkills = api.skills ? await api.skills.list_skills_with_abilities().catch(() => []) : [];

  const systemPrompt = buildSystemPrompt(intent, existingKatas, availableSkills);
  let promptText = systemPrompt;
  let lastError: ContractProposeError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptProposal(promptText, api, existingKatas, availableSkills);
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
