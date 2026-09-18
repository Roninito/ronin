/**
 * Contract DSL Parser V2
 *
 * Parses .contract files:
 *
 *   contract <name> <version>
 *     description "<text>"
 *     trigger cron "<expression>"
 *     trigger event "<eventType>"
 *     trigger webhook "<path>"
 *     parameters {
 *       key: value
 *     }
 *     on_failure {
 *       action retry|alert|ignore
 *       max_attempts 3
 *       backoff exponential
 *       initial_delay 1s
 *       max_delay 30s
 *       alert_email "email"
 *     }
 *     initial <phase>
 *     phase <name>
 *       run skill <name> [ability <name>]
 *       next <phase> | complete | fail
 *     phase <name>
 *       wait event <name> [timeout <ms>]
 *       next <phase> | complete | fail
 *
 * The phase graph replaced `target kata <name> <version>` (2026-09-17) — a
 * contract now declares its own phases inline instead of pointing at a
 * separately-versioned Kata artifact. See src/contract/phase-compiler.ts for
 * the validation (reachability/cycles/dangling `next`) run at the end of parse().
 */

import type { ContractV2Definition, TriggerType, TriggerConfig, FailureAction, ContractPhase, PhaseAction } from "../types/shared.js";
import { validateContractPhases } from "./phase-compiler.js";

export class ContractParseError extends Error {
  constructor(message: string, public line?: number) {
    super(line !== undefined ? `Line ${line}: ${message}` : message);
    this.name = "ContractParseError";
  }
}

/**
 * Parse the `initial <phase>` / `phase <name> ...` block(s) starting at
 * `lines[startIdx]`. Consumes every contiguous, recognized phase-grammar line
 * (skipping blank lines and `#` comments) and stops at the first line that
 * isn't part of this grammar (or EOF), returning where it stopped so the
 * caller can resume parsing the rest of a full .contract file from there.
 * Standalone so `propose.ts` can reuse it for phase-only AI-drafted snippets
 * that never had a `contract NAME vN` header/trigger wrapper.
 */
export function parsePhaseBlocks(
  lines: string[],
  startIdx: number,
): { initialPhase: string; phases: Record<string, ContractPhase>; nextIdx: number } {
  let idx = startIdx;
  let initialPhase = "";
  const phases: Record<string, ContractPhase> = {};

  function peekMeaningful(): { text: string; lineNo: number } | null {
    let i = idx;
    while (i < lines.length) {
      const text = lines[i]!.trimEnd();
      if (text.trim() !== "" && !text.trim().startsWith("#")) return { text: text.trim(), lineNo: i + 1 };
      i++;
    }
    return null;
  }

  function consumeMeaningful(): { text: string; lineNo: number } | null {
    while (idx < lines.length) {
      const text = lines[idx]!.trimEnd();
      const lineNo = idx + 1;
      idx++;
      if (text.trim() !== "" && !text.trim().startsWith("#")) return { text: text.trim(), lineNo };
    }
    return null;
  }

  for (;;) {
    const peeked = peekMeaningful();
    if (!peeked) break;

    const initialMatch = peeked.text.match(/^initial\s+(\S+)\s*$/);
    if (initialMatch) {
      consumeMeaningful();
      initialPhase = initialMatch[1]!;
      continue;
    }

    const phaseMatch = peeked.text.match(/^phase\s+(\S+)\s*$/);
    if (!phaseMatch) break; // Not part of the phase grammar — hand control back.
    consumeMeaningful();
    const phaseName = phaseMatch[1]!;

    const actionLine = consumeMeaningful();
    if (!actionLine) throw new ContractParseError(`phase '${phaseName}' has no action`, peeked.lineNo);

    let action: PhaseAction;
    const runMatch = actionLine.text.match(/^run\s+skill\s+(\S+)(?:\s+ability\s+(\S+))?\s*$/);
    const waitMatch = actionLine.text.match(/^wait\s+event\s+(\S+)(?:\s+timeout\s+(\d+))?\s*$/);
    if (runMatch) {
      action = { type: "run", skill: runMatch[1]!, ability: runMatch[2] };
    } else if (waitMatch) {
      action = { type: "wait", eventName: waitMatch[1]!, timeout: waitMatch[2] ? Number(waitMatch[2]) : undefined };
    } else {
      throw new ContractParseError(
        `Expected "run skill <name>" or "wait event <name>" for phase '${phaseName}'`,
        actionLine.lineNo,
      );
    }

    const terminalLine = consumeMeaningful();
    if (!terminalLine) throw new ContractParseError(`phase '${phaseName}' has no next/complete/fail`, actionLine.lineNo);

    const nextMatch = terminalLine.text.match(/^next\s+(\S+)\s*$/);
    let next: string | undefined;
    let terminal: "complete" | "fail" | undefined;
    if (nextMatch) {
      next = nextMatch[1]!;
    } else if (terminalLine.text === "complete") {
      terminal = "complete";
    } else if (terminalLine.text === "fail") {
      terminal = "fail";
    } else {
      throw new ContractParseError(
        `Expected "next <phase>", "complete", or "fail" for phase '${phaseName}'`,
        terminalLine.lineNo,
      );
    }

    phases[phaseName] = { name: phaseName, action, next, terminal };
  }

  return { initialPhase, phases, nextIdx: idx };
}

export class ContractParserV2 {
  parse(source: string): ContractV2Definition {
    const lines = source.split("\n");
    let idx = 0;

    // Find header
    function nextLine(): { text: string; lineNo: number } | null {
      while (idx < lines.length) {
        // Non-null: idx < lines.length is checked by the loop condition above.
        const text = lines[idx]!.trimEnd();
        const lineNo = idx + 1;
        idx++;
        if (text.trim() !== "" && !text.trim().startsWith("#")) return { text, lineNo };
      }
      return null;
    }

    const header = nextLine();
    if (!header) throw new ContractParseError("Empty contract file");

    const headerMatch = header.text.match(/^contract\s+(\S+)\s+(v\d+)\s*$/);
    if (!headerMatch) {
      throw new ContractParseError(`Expected "contract <name> <version>"`, header.lineNo);
    }
    // Non-null: both capture groups are mandatory in the regex above, so a match guarantees them.
    const name = headerMatch[1]!;
    const version = headerMatch[2]!;

    let description: string | undefined;
    let initialPhase = "";
    let phases: Record<string, ContractPhase> = {};
    let triggerType: TriggerType = "manual";
    let triggerConfig: TriggerConfig = { type: "manual" };
    const parameters: Record<string, unknown> = {};
    let onFailureAction: FailureAction = "ignore";
    const onFailureConfig: Record<string, unknown> = {};
    let author: string | undefined;

    while (idx < lines.length) {
      const line = nextLine();
      if (!line) break;

      const stripped = line.text.trim();

      if (stripped.startsWith("description ")) {
        description = extractQuoted(stripped.replace(/^description\s+/, ""));
      } else if (stripped.startsWith("author ")) {
        author = extractQuoted(stripped.replace(/^author\s+/, ""));
      } else if (stripped.startsWith("initial ") || stripped.startsWith("phase ")) {
        // Hand off to the standalone phase-block parser; it consumes every
        // contiguous initial/phase line and reports where it stopped so this
        // loop can resume from the next non-phase line (idx currently points
        // just past the line we peeked at, hence idx - 1).
        const result = parsePhaseBlocks(lines, idx - 1);
        if (result.initialPhase) initialPhase = result.initialPhase;
        phases = { ...phases, ...result.phases };
        idx = result.nextIdx;
      } else if (stripped.startsWith("trigger ")) {
        const m = stripped.match(/^trigger\s+(cron|event|webhook)\s+(.*)\s*$/);
        if (m) {
          // Non-null: both capture groups are mandatory in the regex above.
          const tType = m[1]! as "cron" | "event" | "webhook";
          const tValue = extractQuoted(m[2]!.trim());
          triggerType = tType;
          if (tType === "cron") triggerConfig = { type: "cron", expression: tValue };
          else if (tType === "event") triggerConfig = { type: "event", eventType: tValue };
          else if (tType === "webhook") triggerConfig = { type: "webhook", path: tValue };
        } else if (stripped === "trigger manual") {
          triggerType = "manual";
          triggerConfig = { type: "manual" };
        }
      } else if (stripped === "parameters {" || stripped.startsWith("parameters {")) {
        // Consume block
        while (idx < lines.length) {
          // Non-null: idx < lines.length is checked by the loop condition above.
          const pl = lines[idx]!.trimEnd();
          idx++;
          if (pl.trim() === "}") break;
          const colonIdx = pl.indexOf(":");
          if (colonIdx === -1) continue;
          const key = pl.slice(0, colonIdx).trim();
          const val = pl.slice(colonIdx + 1).trim().replace(/,$/, "");
          if (key) parameters[key] = parseScalar(val);
        }
      } else if (stripped === "on_failure {" || stripped.startsWith("on_failure {")) {
        while (idx < lines.length) {
          // Non-null: idx < lines.length is checked by the loop condition above.
          const fl = lines[idx]!.trimEnd();
          idx++;
          if (fl.trim() === "}") break;
          const t = fl.trim();
          if (t.startsWith("action ")) {
            onFailureAction = t.replace(/^action\s+/, "").trim() as FailureAction;
          } else if (t.startsWith("max_attempts ")) {
            onFailureConfig.maxAttempts = parseInt(t.replace(/^max_attempts\s+/, ""));
          } else if (t.startsWith("backoff ")) {
            onFailureConfig.backoff = t.replace(/^backoff\s+/, "").trim();
          } else if (t.startsWith("initial_delay ")) {
            const v = t.replace(/^initial_delay\s+/, "").trim();
            onFailureConfig.initialDelay = parseDuration(v);
          } else if (t.startsWith("max_delay ")) {
            const v = t.replace(/^max_delay\s+/, "").trim();
            onFailureConfig.maxDelay = parseDuration(v);
          } else if (t.startsWith("alert_email ")) {
            onFailureConfig.alertEmail = extractQuoted(t.replace(/^alert_email\s+/, ""));
          }
        }
      }
    }

    if (!initialPhase) throw new ContractParseError("initial <phase> is required");
    if (Object.keys(phases).length === 0) throw new ContractParseError("at least one phase block is required");

    const validation = validateContractPhases(initialPhase, phases);
    if (!validation.valid) {
      const first = validation.errors[0];
      throw new ContractParseError(
        first ? `${first.rule}: ${first.message}` : "invalid phase graph",
      );
    }

    return {
      name,
      version,
      description,
      initialPhase,
      phases,
      parameters,
      triggerType,
      triggerConfig,
      onFailureAction,
      onFailureConfig: Object.keys(onFailureConfig).length > 0 ? onFailureConfig as any : undefined,
      enabled: true,
      author,
    };
  }
}

function extractQuoted(raw: string): string {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (!isNaN(Number(s)) && s !== "") return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s.startsWith("[")) try { return JSON.parse(s); } catch {}
  return s;
}

function parseDuration(s: string): number {
  if (s.endsWith("ms")) return parseInt(s);
  if (s.endsWith("s")) return parseInt(s) * 1000;
  if (s.endsWith("m")) return parseInt(s) * 60000;
  return parseInt(s) || 0;
}
