/**
 * Contract Phase Formatting — human-readable summary and DSL round-tripping.
 *
 * Shared by the contracts dashboard, `contract show`/`dry-run`/`export`, the
 * canvas graph's contract tooltips, and AI proposal previews, so "what does
 * this contract actually do" is rendered the same way everywhere.
 */

import type { ContractPhase } from "../types/shared.js";

/** Walk the `next` chain from `initialPhase`, e.g. "weather → mail → post". */
export function describePhaseChain(initialPhase: string, phases: Record<string, ContractPhase>): string {
  const order = phaseChainOrder(initialPhase, phases);
  if (order.length === 0) return "(no phases)";
  return order.join(" → ");
}

/** Phase names in chain order starting at `initialPhase`, guarded against cycles. */
function phaseChainOrder(initialPhase: string, phases: Record<string, ContractPhase>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = initialPhase;

  while (current && phases[current] && !seen.has(current) && order.length <= Object.keys(phases).length) {
    seen.add(current);
    order.push(current);
    current = phases[current]!.next;
  }

  return order;
}

/**
 * Render `initial <phase>` + `phase <name> ... next|complete|fail` blocks —
 * the inverse of `parsePhaseBlocks` in parser-v2.ts. Phases are emitted in
 * chain order (readable top-to-bottom); any phase unreachable from
 * `initialPhase` (shouldn't happen post-validation, but defensive) is
 * appended afterward rather than silently dropped.
 */
export function formatContractPhasesDsl(initialPhase: string, phases: Record<string, ContractPhase>): string {
  const order = phaseChainOrder(initialPhase, phases);
  const remaining = Object.keys(phases).filter((name) => !order.includes(name));
  const lines: string[] = [`initial ${initialPhase}`, ""];

  for (const name of [...order, ...remaining]) {
    const phase = phases[name];
    if (!phase) continue;
    lines.push(`phase ${name}`);
    lines.push(`  ${formatPhaseAction(phase)}`);
    lines.push(`  ${formatPhaseTerminal(phase)}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function formatPhaseAction(phase: ContractPhase): string {
  if (phase.action.type === "run") {
    return phase.action.ability
      ? `run skill ${phase.action.skill} ability ${phase.action.ability}`
      : `run skill ${phase.action.skill}`;
  }
  return phase.action.timeout !== undefined
    ? `wait event ${phase.action.eventName} timeout ${phase.action.timeout}`
    : `wait event ${phase.action.eventName}`;
}

function formatPhaseTerminal(phase: ContractPhase): string {
  if (phase.terminal) return phase.terminal;
  return `next ${phase.next}`;
}
