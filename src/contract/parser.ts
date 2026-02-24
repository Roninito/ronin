/**
 * Contract Parser — Phase 7
 *
 * Parses Contract DSL into AST
 *
 * Syntax:
 *   contract NAME VERSION
 *     trigger cron EXPRESSION
 *     run kata KATA_NAME KATA_VERSION
 *
 * or:
 *   contract NAME VERSION
 *     trigger event EVENT_NAME
 *     run kata KATA_NAME KATA_VERSION
 */

import type { ContractAST, Token, ContractTrigger } from "./types.js";

/**
 * Contract Parser - tokenize + recursive descent parse
 */
export class ContractParser {
  private tokens: Token[] = [];
  private current = 0;

  /**
   * Parse contract DSL source code
   */
  parse(source: string): ContractAST {
    this.tokens = this.tokenize(source);
    this.current = 0;
    return this.parseContract();
  }

  /**
   * Tokenize source code
   */
  private tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    const lines = source.split("\n");

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) continue;

      // Split by whitespace, track positions
      const parts = trimmed.split(/\s+/);
      let column = line.indexOf(trimmed[0]);

      for (const part of parts) {
        if (!part) continue;

        tokens.push({
          type: this.getTokenType(part),
          value: part,
          line: lineNum + 1,
          column,
        });

        column += part.length + 1;
      }
    }

    return tokens;
  }

  /**
   * Determine token type
   */
  private getTokenType(value: string): string {
    const keywords = [
      "contract",
      "trigger",
      "cron",
      "event",
      "run",
      "kata",
    ];

    if (keywords.includes(value)) return value;
    if (/^v\d+$/.test(value)) return "VERSION";
    if (/^\d+$/.test(value)) return "NUMBER";
    if (/^[a-z][\w.]*$/.test(value)) return "IDENTIFIER";

    return "UNKNOWN";
  }

  /**
   * Recursive descent parser
   */
  private parseContract(): ContractAST {
    this.expect("contract");
    const name = this.parseIdentifier();
    const version = this.parseVersion();
    const trigger = this.parseTrigger();
    this.expect("run");
    this.expect("kata");
    const kataName = this.parseIdentifier();
    const kataVersion = this.parseVersion();

    return {
      type: "contract",
      name,
      version,
      trigger,
      kata: {
        name: kataName,
        version: kataVersion,
      },
    };
  }

  /**
   * Parse identifier (dot-separated)
   */
  private parseIdentifier(): string {
    const token = this.peek();
    if (token.type !== "IDENTIFIER") {
      throw new Error(
        `Expected identifier, got '${token.value}' at line ${token.line}:${token.column}`
      );
    }
    this.advance();
    return token.value;
  }

  /**
   * Parse version (v1, v2, etc)
   */
  private parseVersion(): string {
    const token = this.peek();
    if (token.type !== "VERSION") {
      throw new Error(
        `Expected version (v1, v2, etc), got '${token.value}' at line ${token.line}:${token.column}`
      );
    }
    this.advance();
    return token.value;
  }

  /**
   * Parse trigger (cron or event)
   */
  private parseTrigger(): ContractTrigger {
    this.expect("trigger");
    const triggerType = this.peek().value;

    if (triggerType === "cron") {
      return this.parseCronTrigger();
    } else if (triggerType === "event") {
      return this.parseEventTrigger();
    } else {
      throw new Error(
        `Unknown trigger type '${triggerType}' at line ${this.peek().line}`
      );
    }
  }

  /**
   * Parse cron trigger
   */
  private parseCronTrigger() {
    this.expect("cron");

    // Cron expression is 5 space-separated numbers
    const cronParts: string[] = [];
    for (let i = 0; i < 5; i++) {
      const token = this.peek();
      if (token.type !== "NUMBER" && token.value !== "*" && token.value !== "*/6") {
        throw new Error(
          `Expected cron expression number, got '${token.value}' at line ${token.line}`
        );
      }
      cronParts.push(token.value);
      this.advance();
    }

    const expression = cronParts.join(" ");

    return {
      type: "cron",
      expression,
    };
  }

  /**
   * Parse event trigger
   */
  private parseEventTrigger() {
    this.expect("event");
    const eventType = this.parseIdentifier();

    return {
      type: "event",
      eventType,
    };
  }

  /**
   * Expect a specific token
   */
  private expect(type: string): void {
    const token = this.peek();
    if (token.type !== type && token.value !== type) {
      throw new Error(
        `Expected '${type}', got '${token.value}' at line ${token.line}:${token.column}`
      );
    }
    this.advance();
  }

  /**
   * Get current token without consuming
   */
  private peek(): Token {
    if (this.current >= this.tokens.length) {
      return {
        type: "EOF",
        value: "EOF",
        line: 0,
        column: 0,
      };
    }
    return this.tokens[this.current];
  }

  /**
   * Move to next token
   */
  private advance(): void {
    this.current++;
  }
}
