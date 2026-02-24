/**
 * Kata DSL Types — Phase 7
 *
 * Defines the AST (Abstract Syntax Tree), compiled graph representation,
 * and storage models for Kata DSL.
 *
 * Flow: DSL source → Parser → AST → Compiler → CompiledKata (validated)
 */

/**
 * Phase Action: Either run a skill or spawn a child kata
 */
export type PhaseAction =
  | { type: "run"; skill: string }
  | { type: "spawn"; kata: string; version: string };

/**
 * Phase Terminal State: How a phase ends
 */
export type PhaseTerminal = "complete" | "fail";

/**
 * Single Phase in a Kata
 */
export interface Phase {
  name: string;
  action: PhaseAction;
  next?: string; // Next phase name, or undefined if terminal
  terminal?: PhaseTerminal; // Set if phase is terminal (no next)
}

/**
 * Parsed Kata AST (output of parser)
 */
export interface KataAST {
  name: string;
  version: string;
  requires: Requirement[];
  initial: string;
  phases: Record<string, Phase>;
}

/**
 * Requirement: Either a skill or a kata dependency
 */
export interface Requirement {
  type: "skill" | "kata";
  name: string;
  version?: string; // For katas, the version; for skills, optional
}

/**
 * Compiled & validated Kata — immutable after registration
 */
export interface CompiledKata extends KataAST {
  requiredSkills: string[]; // Extracted from requirements
  checksum: string; // SHA256 of source for validation
}

/**
 * Kata Definition stored in database
 */
export interface KataDefinition {
  id: string; // "finance.audit_v2"
  name: string; // "finance.audit"
  version: string; // "v2"
  sourceCode: string; // Full DSL text
  compiledGraph: CompiledKata; // Compiled, validated graph
  requiredSkills: string[]; // Extracted list
  checksum: string; // For integrity validation
  ontologyNodeId?: string; // Reference to ontology node
  createdAt: number; // Unix timestamp
  updatedAt: number; // Unix timestamp
}

/**
 * Validation Error — from compiler
 */
export interface ValidationError {
  rule: string; // e.g., "unreachable_phase", "missing_transition"
  phase?: string; // Which phase (if applicable)
  message: string; // Human-readable error
}

/**
 * Validation Result from compiler
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Parser Token for DSL tokenization
 */
export interface Token {
  type:
    | "keyword"
    | "identifier"
    | "version"
    | "arrow"
    | "newline"
    | "indent"
    | "dedent"
    | "eof";
  value: string;
  line: number;
  column: number;
}
