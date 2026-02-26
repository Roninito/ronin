/**
 * Kata DSL Parser — Phase 7
 *
 * Converts DSL source text → Abstract Syntax Tree (AST)
 *
 * Grammar (simplified):
 *   kata NAME VERSION
 *   requires (skill|kata) NAME [VERSION]
 *   initial PHASE_NAME
 *   phase PHASE_NAME
 *     (run skill NAME | spawn kata NAME VERSION -> VAR)
 *     (next PHASE_NAME | complete | fail)
 */

import type { Token, KataAST, Phase, Requirement } from "./types.js";

/**
 * Tokenize DSL source
 */
function tokenize(source: string): Token[] {
  const lines = source.split("\n");
  const tokens: Token[] = [];
  let lineNum = 0;

  const keywords = new Set([
    "kata",
    "requires",
    "skill",
    "initial",
    "phase",
    "run",
    "spawn",
    "wait",
    "event",
    "timeout",
    "next",
    "complete",
    "fail",
    "ai-model",
    "ai-tags",
    "ai-fallback",
  ]);

  for (const line of lines) {
    lineNum++;
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue; // Skip empty & comments

    const parts = trimmed.split(/\s+/);
    let col = 1;

    for (const part of parts) {
      if (keywords.has(part)) {
        tokens.push({
          type: "keyword",
          value: part,
          line: lineNum,
          column: col,
        });
      } else if (part.match(/^d+$/)) {
        // Number token for timeout values
        tokens.push({
          type: "number",
          value: part,
          line: lineNum,
          column: col,
        });
      } else if (part.match(/^v\d+/)) {
        tokens.push({
          type: "version",
          value: part,
          line: lineNum,
          column: col,
        });
      } else if (part === "->") {
        tokens.push({
          type: "arrow",
          value: "->",
          line: lineNum,
          column: col,
        });
      } else {
        tokens.push({
          type: "identifier",
          value: part,
          line: lineNum,
          column: col,
        });
      }

      col += part.length + 1;
    }

    tokens.push({
      type: "newline",
      value: "\n",
      line: lineNum,
      column: col,
    });
  }

  tokens.push({ type: "eof", value: "", line: lineNum, column: 0 });
  return tokens;
}

/**
 * Kata DSL Parser
 */
export class KataParser {
  private tokens: Token[] = [];
  private pos: number = 0;

  /**
   * Parse DSL source → AST
   */
  parse(source: string): KataAST {
    this.tokens = tokenize(source);
    this.pos = 0;

    return this.parseKata();
  }

  private parseKata(): KataAST {
    // kata NAME VERSION
    this.expectKeyword("kata");
    const name = this.expectIdentifier();
    const version = this.expectVersion();
    this.skipNewlines();

    let aiModel: KataAST["aiModel"] | undefined;

    // Optional kata-level ai-model, ai-tags, ai-fallback directives
    while (
      this.peekKeyword("ai-model") ||
      this.peekKeyword("ai-tags") ||
      this.peekKeyword("ai-fallback")
    ) {
      if (this.peekKeyword("ai-model")) {
        this.consumeKeyword("ai-model");
        const nametag = this.expectIdentifier();
        if (!aiModel) aiModel = {};
        aiModel.nametag = nametag;
        this.skipNewlines();
      } else if (this.peekKeyword("ai-tags")) {
        this.consumeKeyword("ai-tags");
        const tags: string[] = [];
        while (!this.peekKeyword("ai-model") && !this.peekKeyword("ai-fallback") && !this.peekKeyword("requires") && !this.peekKeyword("initial")) {
          tags.push(this.expectIdentifier());
          if (!this.peekType("identifier")) break;
        }
        if (!aiModel) aiModel = {};
        aiModel.tags = tags;
        this.skipNewlines();
      } else if (this.peekKeyword("ai-fallback")) {
        this.consumeKeyword("ai-fallback");
        const fallback = this.expectIdentifier();
        if (!aiModel) aiModel = {};
        aiModel.fallback = fallback;
        this.skipNewlines();
      }
    }

    // requires ...
    const requires: Requirement[] = [];
    while (this.peekKeyword("requires")) {
      this.consumeKeyword("requires");
      requires.push(this.parseRequirement());
      this.skipNewlines();
    }

    // initial PHASE
    this.expectKeyword("initial");
    const initial = this.expectIdentifier();
    this.skipNewlines();

    // phases
    const phases: Record<string, Phase> = {};
    while (this.peekKeyword("phase")) {
      const phase = this.parsePhase();
      phases[phase.name] = phase;
      this.skipNewlines();
    }

    return {
      name,
      version,
      requires,
      initial,
      phases,
      aiModel: aiModel && Object.keys(aiModel).length > 0 ? aiModel : undefined,
    };
  }

  private parseRequirement(): Requirement {
    const type = this.current().value as "skill" | "kata";
    this.consume();

    const name = this.expectIdentifier();

    // Optional version for katas
    let version: string | undefined;
    if (this.peekType("version")) {
      version = this.current().value;
      this.consume();
    }

    return { type, name, version };
  }

  private parsePhase(): Phase {
    this.expectKeyword("phase");
    const name = this.expectIdentifier();
    this.skipNewlines();

    let aiModel: Phase["aiModel"] | undefined;

    // Optional ai-model, ai-tags, ai-fallback directives
    while (
      this.peekKeyword("ai-model") ||
      this.peekKeyword("ai-tags") ||
      this.peekKeyword("ai-fallback")
    ) {
      if (this.peekKeyword("ai-model")) {
        this.consumeKeyword("ai-model");
        const nametag = this.expectIdentifier();
        if (!aiModel) aiModel = {};
        aiModel.nametag = nametag;
        this.skipNewlines();
      } else if (this.peekKeyword("ai-tags")) {
        this.consumeKeyword("ai-tags");
        const tags: string[] = [];
        // Parse comma-separated or space-separated tags
        while (!this.isAtPhaseStart() && !this.peekKeyword("ai-model") && !this.peekKeyword("ai-fallback") && !this.peekKeyword("run") && !this.peekKeyword("spawn")) {
          tags.push(this.expectIdentifier());
          if (this.peekType("identifier")) {
            continue;
          } else {
            break;
          }
        }
        if (!aiModel) aiModel = {};
        aiModel.tags = tags;
        this.skipNewlines();
      } else if (this.peekKeyword("ai-fallback")) {
        this.consumeKeyword("ai-fallback");
        const fallback = this.expectIdentifier();
        if (!aiModel) aiModel = {};
        aiModel.fallback = fallback;
        this.skipNewlines();
      }
    }

    // Action: run or spawn
    let action: Phase["action"];

    if (this.peekKeyword("run")) {
      this.consumeKeyword("run");
      this.expectKeyword("skill");
      const skill = this.expectIdentifier();
      action = { type: "run", skill };
    } else if (this.peekKeyword("spawn")) {
      this.consumeKeyword("spawn");
      this.expectKeyword("kata");
      const kata = this.expectIdentifier();
      const version = this.expectVersion();
      this.expectArrow();
      this.expectIdentifier();
      action = { type: "spawn", kata, version };
    } else if (this.peekKeyword("wait")) {
      this.consumeKeyword("wait");
      this.expectKeyword("event");
      const eventName = this.expectIdentifier();

      let timeout: number | undefined;
      if (this.peekKeyword("timeout")) {
        this.consumeKeyword("timeout");
        const timeoutToken = this.current();
        if (timeoutToken.type !== "number") {
          throw this.error("Expected number after 'timeout'");
        }
        timeout = parseInt(timeoutToken.value, 10);
        this.consume();
      }

      action = { type: "wait", eventName, timeout };
    } else {
      throw this.error("Expected 'run', 'spawn', or 'wait'");
    }

    this.skipNewlines();

    // Terminal: next, complete, or fail
    let next: string | undefined;
    let terminal: "complete" | "fail" | undefined;

    if (this.peekKeyword("next")) {
      this.consumeKeyword("next");
      next = this.expectIdentifier();
    } else if (this.peekKeyword("complete")) {
      this.consumeKeyword("complete");
      terminal = "complete";
    } else if (this.peekKeyword("fail")) {
      this.consumeKeyword("fail");
      terminal = "fail";
    } else {
      throw this.error(
        "Expected 'next', 'complete', or 'fail' after phase action"
      );
    }

    return {
      name,
      action,
      next,
      terminal,
      aiModel: aiModel && Object.keys(aiModel).length > 0 ? aiModel : undefined,
    };
  }

  // Helpers

  private current(): Token {
    return this.tokens[this.pos] || { type: "eof", value: "", line: 0, column: 0 };
  }

  private peek(): Token | null {
    const next = this.tokens[this.pos + 1];
    return next || null;
  }

  private peekType(type: string): boolean {
    return this.current().type === type;
  }

  private peekKeyword(kw: string): boolean {
    return this.current().type === "keyword" && this.current().value === kw;
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  private expectKeyword(kw: string): void {
    if (!this.peekKeyword(kw)) {
      throw this.error(`Expected keyword '${kw}'`);
    }
    this.consume();
  }

  private consumeKeyword(kw: string): void {
    this.expectKeyword(kw);
  }

  private expectIdentifier(): string {
    if (this.current().type !== "identifier") {
      throw this.error("Expected identifier");
    }
    return this.consume().value;
  }

  private expectVersion(): string {
    if (this.current().type !== "version") {
      throw this.error("Expected version (e.g., v1, v2)");
    }
    return this.consume().value;
  }

  private expectArrow(): void {
    if (this.current().type !== "arrow") {
      throw this.error("Expected '->'");
    }
    this.consume();
  }

  private skipNewlines(): void {
    while (this.peekType("newline")) {
      this.consume();
    }
  }

  private error(message: string): Error {
    const token = this.current();
    return new Error(
      `Parse error at line ${token.line}, column ${token.column}: ${message}`
    );
  }
}
