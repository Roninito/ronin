/**
 * Contract Phase Graph Validation
 *
 * Ported from src/kata/compiler.ts (2026-09-17), adapted to validate a
 * contract's inline `(initialPhase, phases)` directly rather than a Kata AST.
 * Dropped from the original: `requiredSkillsExist` (its only reason to exist
 * was checking against `requires` declarations, which no longer exist —
 * skill existence is now checked separately, against the real skill list, by
 * whoever authors a phase) and checksum computation (no immutable registry
 * left to key by checksum).
 */

import type { ContractPhase, ValidationError, ValidationResult } from "../types/shared.js";

type PhaseValidationRule = (initialPhase: string, phases: Record<string, ContractPhase>) => ValidationError[];

const VALIDATION_RULES: Record<string, PhaseValidationRule> = {
  noUnreachablePhases: (initialPhase, phases): ValidationError[] => {
    const errors: ValidationError[] = [];
    const reachable = new Set<string>();
    const queue = [initialPhase];

    while (queue.length > 0) {
      const phase = queue.shift()!;
      if (reachable.has(phase)) continue;

      const phaseObj = phases[phase];
      if (!phaseObj) {
        errors.push({
          rule: "missing_phase",
          phase,
          message: `Phase '${phase}' referenced but not defined`,
        });
        continue;
      }

      reachable.add(phase);
      if (phaseObj.next) queue.push(phaseObj.next);
    }

    for (const phaseName of Object.keys(phases)) {
      if (!reachable.has(phaseName)) {
        errors.push({
          rule: "unreachable_phase",
          phase: phaseName,
          message: `Phase '${phaseName}' is unreachable from initial phase '${initialPhase}'`,
        });
      }
    }

    return errors;
  },

  hasTerminals: (_initialPhase, phases): ValidationError[] => {
    const errors: ValidationError[] = [];

    for (const [name, phase] of Object.entries(phases)) {
      if (!phase.next && !phase.terminal) {
        errors.push({
          rule: "missing_transition",
          phase: name,
          message: `Phase '${name}' must have 'next' or be terminal ('complete'/'fail')`,
        });
      }
      if (phase.next && phase.terminal) {
        errors.push({
          rule: "conflicting_transition",
          phase: name,
          message: `Phase '${name}' cannot have both 'next' and terminal`,
        });
      }
    }

    return errors;
  },

  initialPhaseExists: (initialPhase, phases): ValidationError[] => {
    if (!phases[initialPhase]) {
      return [
        {
          rule: "missing_initial_phase",
          message: `Initial phase '${initialPhase}' not defined`,
        },
      ];
    }
    return [];
  },

  noCycles: (initialPhase, phases): ValidationError[] => {
    const errors: ValidationError[] = [];
    const visited = new Set<string>();
    const rec = new Set<string>();

    const hasCycle = (phase: string): boolean => {
      if (rec.has(phase)) return true;
      if (visited.has(phase)) return false;

      rec.add(phase);
      const phaseObj = phases[phase];

      if (phaseObj?.next) {
        if (hasCycle(phaseObj.next)) {
          errors.push({
            rule: "cycle_detected",
            phase,
            message: `Cycle detected starting from phase '${phase}'`,
          });
          return true;
        }
      }

      rec.delete(phase);
      visited.add(phase);
      return false;
    };

    hasCycle(initialPhase);

    return errors;
  },
};

/** Validate a contract's phase graph — reachability, terminals, cycles. */
export function validateContractPhases(
  initialPhase: string,
  phases: Record<string, ContractPhase>,
): ValidationResult {
  const errors: ValidationError[] = [];
  for (const ruleFn of Object.values(VALIDATION_RULES)) {
    errors.push(...ruleFn(initialPhase, phases));
  }
  return { valid: errors.length === 0, errors };
}
