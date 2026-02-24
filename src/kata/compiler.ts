/**
 * Kata DSL Compiler — Phase 7
 *
 * Converts AST → Compiled Graph with validation
 * Ensures determinism, safety, and completeness
 */

import { createHash } from "crypto";
import type {
  KataAST,
  CompiledKata,
  ValidationResult,
  ValidationError,
} from "./types.js";

/**
 * Validation Rules
 */
const VALIDATION_RULES = {
  noUnreachablePhases: (ast: KataAST): ValidationError[] => {
    const errors: ValidationError[] = [];
    const reachable = new Set<string>();
    const queue = [ast.initial];

    while (queue.length > 0) {
      const phase = queue.shift()!;
      if (reachable.has(phase)) continue;

      const phaseObj = ast.phases[phase];
      if (!phaseObj) {
        errors.push({
          rule: "missing_phase",
          phase,
          message: `Phase '${phase}' referenced but not defined`,
        });
        continue;
      }

      reachable.add(phase);

      // Add next phase to queue
      if (phaseObj.next) {
        queue.push(phaseObj.next);
      }
    }

    // Check for unreachable phases
    for (const phaseName of Object.keys(ast.phases)) {
      if (!reachable.has(phaseName)) {
        errors.push({
          rule: "unreachable_phase",
          phase: phaseName,
          message: `Phase '${phaseName}' is unreachable from initial phase '${ast.initial}'`,
        });
      }
    }

    return errors;
  },

  hasTerminals: (ast: KataAST): ValidationError[] => {
    const errors: ValidationError[] = [];

    for (const [name, phase] of Object.entries(ast.phases)) {
      // Must have either next OR terminal
      if (!phase.next && !phase.terminal) {
        errors.push({
          rule: "missing_transition",
          phase: name,
          message: `Phase '${name}' must have 'next' or be terminal ('complete'/'fail')`,
        });
      }

      // Can't have both
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

  initialPhaseExists: (ast: KataAST): ValidationError[] => {
    if (!ast.phases[ast.initial]) {
      return [
        {
          rule: "missing_initial_phase",
          message: `Initial phase '${ast.initial}' not defined`,
        },
      ];
    }
    return [];
  },

  noCycles: (ast: KataAST): ValidationError[] => {
    const errors: ValidationError[] = [];
    const visited = new Set<string>();
    const rec = new Set<string>(); // Recursion stack

    const hasCycle = (phase: string): boolean => {
      if (rec.has(phase)) return true;
      if (visited.has(phase)) return false;

      rec.add(phase);
      const phaseObj = ast.phases[phase];

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

    hasCycle(ast.initial);

    return errors;
  },

  requiredSkillsExist: (ast: KataAST): ValidationError[] => {
    const errors: ValidationError[] = [];

    // Extract all required skills from requirements
    const declaredSkills = ast.requires
      .filter((r) => r.type === "skill")
      .map((r) => r.name);

    // Extract skills used in phases
    const usedSkills = new Set<string>();
    for (const phase of Object.values(ast.phases)) {
      if (phase.action.type === "run") {
        usedSkills.add(phase.action.skill);
      }
    }

    // Check all used skills are declared
    for (const skill of usedSkills) {
      if (!declaredSkills.includes(skill)) {
        errors.push({
          rule: "undeclared_skill",
          message: `Skill '${skill}' used but not declared in 'requires'`,
        });
      }
    }

    return errors;
  },
};

/**
 * Kata Compiler
 */
export class KataCompiler {
  /**
   * Compile & validate AST → CompiledKata
   */
  compile(ast: KataAST): CompiledKata {
    // Validate
    const validation = this.validate(ast);
    if (!validation.valid) {
      throw new Error(
        `Kata compilation failed:\n${validation.errors
          .map((e) => `  - ${e.message}`)
          .join("\n")}`
      );
    }

    // Extract skills
    const requiredSkills = ast.requires
      .filter((r) => r.type === "skill")
      .map((r) => r.name);

    // Compute checksum
    const checksum = this.computeChecksum(JSON.stringify(ast));

    return {
      ...ast,
      requiredSkills,
      checksum,
    };
  }

  /**
   * Validate AST against all rules
   */
  validate(ast: KataAST): ValidationResult {
    const errors: ValidationError[] = [];

    // Run all validation rules
    for (const [, ruleFn] of Object.entries(VALIDATION_RULES)) {
      errors.push(...ruleFn(ast));
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Compute SHA256 checksum of AST
   */
  private computeChecksum(data: string): string {
    return createHash("sha256").update(data).digest("hex");
  }
}
