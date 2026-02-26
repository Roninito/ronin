/**
 * Technique DSL Parser
 *
 * Parses .technique files into a TechniqueDefinition.
 *
 * Grammar:
 *   technique <name> <version>
 *     description "<text>"
 *     category "<text>"
 *     tags ["tag1", "tag2"]
 *     type composite | custom
 *     requires skill|tool <name>
 *     input { <name>: <type> ... }
 *     output { <name>: <type> ... }
 *     step <name>
 *       run skill|tool <name>
 *       with { ... }
 *       output <varName>
 *     return { ... }
 *     handler "<path>"   (for custom type)
 */

import type {
  TechniqueDefinition,
  TechniqueAST,
  TechniqueStep,
  ReturnMapping,
  SchemaDefinition,
  SchemaField,
  TechniqueDependency,
} from "./types.js";

export class TechniqueParseError extends Error {
  constructor(
    message: string,
    public line?: number,
  ) {
    super(line !== undefined ? `Line ${line}: ${message}` : message);
    this.name = "TechniqueParseError";
  }
}

/**
 * Parse a .technique DSL string into a TechniqueDefinition.
 */
export class TechniqueParser {
  parse(source: string): TechniqueDefinition {
    const lines = source.split("\n");
    const ctx = new ParseContext(lines);

    // First non-blank line must be: technique <name> <version>
    const header = ctx.nextMeaningfulLine();
    if (!header) throw new TechniqueParseError("Empty technique file");

    const headerMatch = header.text.match(/^technique\s+(\S+)\s+(v\d+)\s*$/);
    if (!headerMatch) {
      throw new TechniqueParseError(
        `Expected "technique <name> <version>", got: ${header.text}`,
        header.lineNo,
      );
    }
    const name = headerMatch[1];
    const version = headerMatch[2];

    // Parse body fields
    let description = "";
    let category: string | undefined;
    let tags: string[] | undefined;
    let type: "composite" | "custom" | undefined;
    const requires: TechniqueDependency[] = [];
    let inputSchema: SchemaDefinition = {};
    let outputSchema: SchemaDefinition = {};
    const steps: TechniqueStep[] = [];
    let returnMapping: ReturnMapping = {};
    let handlerPath: string | undefined;

    while (!ctx.done()) {
      const line = ctx.nextMeaningfulLine();
      if (!line) break;

      const stripped = line.text.trim();

      if (stripped.startsWith("description ")) {
        description = extractQuotedOrBare(stripped, "description", line.lineNo);
      } else if (stripped.startsWith("category ")) {
        category = extractQuotedOrBare(stripped, "category", line.lineNo);
      } else if (stripped.startsWith("tags ")) {
        tags = parseInlineArray(stripped.replace(/^tags\s+/, ""), line.lineNo);
      } else if (stripped.startsWith("type ")) {
        const t = stripped.replace(/^type\s+/, "").trim();
        if (t !== "composite" && t !== "custom") {
          throw new TechniqueParseError(`type must be "composite" or "custom"`, line.lineNo);
        }
        type = t;
      } else if (stripped.startsWith("requires ")) {
        const dep = parseRequires(stripped, line.lineNo);
        requires.push(dep);
      } else if (stripped.startsWith("input {") || stripped === "input {") {
        inputSchema = parseSchemaBlock(ctx, line.lineNo);
      } else if (stripped.startsWith("output {") || stripped === "output {") {
        outputSchema = parseSchemaBlock(ctx, line.lineNo);
      } else if (stripped.startsWith("step ")) {
        const headerIndent = line.text.match(/^(\s*)/)?.[1]?.length ?? 0;
        const step = parseStep(ctx, stripped, line.lineNo, headerIndent);
        steps.push(step);
      } else if (stripped.startsWith("return {") || stripped === "return {") {
        // Handle inline: return { key: val, key2: val2 }
        const inlineMatch = stripped.match(/^return\s*\{([^}]*)\}/);
        if (inlineMatch) {
          returnMapping = {};
          for (const entry of inlineMatch[1].split(",")) {
            const colonIdx = entry.indexOf(":");
            if (colonIdx === -1) continue;
            const key = entry.slice(0, colonIdx).trim();
            const val = entry.slice(colonIdx + 1).trim();
            if (key) (returnMapping as Record<string, unknown>)[key] = parseScalar(val);
          }
        } else {
          returnMapping = parseReturnBlock(ctx, line.lineNo);
        }
      } else if (stripped.startsWith("handler ")) {
        handlerPath = extractQuotedOrBare(stripped, "handler", line.lineNo);
      } else if (stripped === "") {
        continue;
      } else {
        // Unknown field — skip silently for forward compatibility
      }
    }

    if (!description) throw new TechniqueParseError("description is required");
    if (!type) throw new TechniqueParseError("type is required (composite | custom)");

    let ast: TechniqueAST;
    if (type === "composite") {
      ast = { type: "composite", steps, returnMapping };
    } else {
      if (!handlerPath) {
        throw new TechniqueParseError('custom technique requires a "handler <path>" field');
      }
      ast = { type: "custom", handlerPath };
    }

    return {
      name,
      version,
      description,
      category,
      tags,
      type,
      requires,
      inputSchema,
      outputSchema,
      ast,
      source,
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

class ParseContext {
  private idx = 0;
  constructor(private lines: string[]) {}

  done(): boolean {
    return this.idx >= this.lines.length;
  }

  peek(): { text: string; lineNo: number } | null {
    let i = this.idx;
    while (i < this.lines.length) {
      const text = this.lines[i].trimEnd();
      if (text.trim() !== "" && !text.trim().startsWith("#")) {
        return { text, lineNo: i + 1 };
      }
      i++;
    }
    return null;
  }

  nextMeaningfulLine(): { text: string; lineNo: number } | null {
    while (this.idx < this.lines.length) {
      const text = this.lines[this.idx].trimEnd();
      const lineNo = this.idx + 1;
      this.idx++;
      if (text.trim() !== "" && !text.trim().startsWith("#")) {
        return { text, lineNo };
      }
    }
    return null;
  }

  /** Consume lines until we find closing brace at the base indent level */
  consumeBlock(): string[] {
    const collected: string[] = [];
    let depth = 1;
    while (this.idx < this.lines.length) {
      const text = this.lines[this.idx].trimEnd();
      this.idx++;
      if (text.includes("{")) depth++;
      if (text.includes("}")) {
        depth--;
        if (depth === 0) break;
      }
      collected.push(text);
    }
    return collected;
  }
}

function extractQuotedOrBare(line: string, keyword: string, lineNo: number): string {
  const rest = line.replace(new RegExp(`^${keyword}\\s+`), "").trim();
  if (rest.startsWith('"') && rest.endsWith('"')) return rest.slice(1, -1);
  return rest;
}

function parseInlineArray(raw: string, lineNo: number): string[] {
  const match = raw.trim().match(/^\[(.*)]/s);
  if (!match) throw new TechniqueParseError(`Expected array like ["a","b"]`, lineNo);
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

function parseRequires(line: string, lineNo: number): TechniqueDependency {
  const match = line.match(/^requires\s+(skill|tool)\s+(\S+)/);
  if (!match) {
    throw new TechniqueParseError(`Expected "requires skill|tool <name>"`, lineNo);
  }
  return { kind: match[1] as "skill" | "tool", name: match[2] };
}

function parseSchemaBlock(ctx: ParseContext, lineNo: number): SchemaDefinition {
  const bodyLines = ctx.consumeBlock();
  const schema: SchemaDefinition = {};
  let currentField: string | null = null;
  let currentFieldDef: SchemaField | null = null;

  for (const raw of bodyLines) {
    const line = raw.trim();
    if (!line) continue;

    // Field declaration: <name>: <type>
    const fieldMatch = line.match(/^(\w+):\s*(\w+)$/);
    if (fieldMatch) {
      if (currentField && currentFieldDef) schema[currentField] = currentFieldDef;
      currentField = fieldMatch[1];
      currentFieldDef = { type: fieldMatch[2] as SchemaField["type"] };
      continue;
    }

    // Field attribute
    if (currentField && currentFieldDef) {
      if (line.startsWith("description ")) {
        currentFieldDef.description = extractQuotedOrBare(line, "description", lineNo);
      } else if (line.startsWith("required ")) {
        currentFieldDef.required = line.includes("true");
      } else if (line.startsWith("default ")) {
        const val = line.replace(/^default\s+/, "").trim();
        currentFieldDef.default = parseScalar(val);
      } else if (line.startsWith("enum ")) {
        currentFieldDef.enum = parseInlineArray(line.replace(/^enum\s+/, ""), lineNo);
      } else if (line.startsWith("format ")) {
        currentFieldDef.format = extractQuotedOrBare(line, "format", lineNo);
      } else if (line.startsWith("items ")) {
        currentFieldDef.items = { type: line.replace(/^items\s+/, "").trim() as SchemaField["type"] };
      }
    }
  }

  if (currentField && currentFieldDef) schema[currentField] = currentFieldDef;
  return schema;
}

function parseStep(ctx: ParseContext, headerLine: string, lineNo: number, headerIndent = 0): TechniqueStep {
  const nameMatch = headerLine.match(/^step\s+(\S+)/);
  if (!nameMatch) throw new TechniqueParseError(`Expected "step <name>"`, lineNo);
  const stepName = nameMatch[1];

  let description: string | undefined;
  let runType: "skill" | "tool" | undefined;
  let runName: string | undefined;
  let ability: string | undefined;
  let params: Record<string, unknown> = {};
  let output = "";

  // Peek at indented lines belonging to this step
  while (true) {
    const next = ctx.peek();
    if (!next) break;
    const indent = next.text.match(/^(\s+)/)?.[1]?.length ?? 0;
    if (indent <= headerIndent) break; // Back at root or same level

    ctx.nextMeaningfulLine(); // consume
    const line = next.text.trim();

    if (line.startsWith("description ")) {
      description = extractQuotedOrBare(line, "description", next.lineNo);
    } else if (line.startsWith("run ")) {
      const m = line.match(/^run\s+(skill|tool)\s+(\S+)/);
      if (!m) throw new TechniqueParseError(`Expected "run skill|tool <name>"`, next.lineNo);
      runType = m[1] as "skill" | "tool";
      runName = m[2];
    } else if (line.startsWith("ability ")) {
      ability = line.replace(/^ability\s+/, "").trim();
    } else if (line.startsWith("with {")) {
      // If closing brace is on same line, parse inline; otherwise use consumeBlock
      const inlineMatch = line.match(/^with\s*\{([^}]*)\}/);
      if (inlineMatch) {
        // Parse inline: "with { key: val, key2: val2 }"
        params = {};
        for (const entry of inlineMatch[1].split(",")) {
          const colonIdx = entry.indexOf(":");
          if (colonIdx === -1) continue;
          const key = entry.slice(0, colonIdx).trim();
          const val = entry.slice(colonIdx + 1).trim();
          if (key) params[key] = parseScalar(val);
        }
      } else {
        params = parseInlineObject(ctx, next.lineNo);
      }
    } else if (line.startsWith("output ")) {
      output = line.replace(/^output\s+/, "").trim();
    }
  }

  if (!runType || !runName) {
    throw new TechniqueParseError(`step "${stepName}" requires "run skill|tool <name>"`, lineNo);
  }

  return { name: stepName, description, runType, runName, ability, params, output };
}

function parseReturnBlock(ctx: ParseContext, lineNo: number): ReturnMapping {
  const bodyLines = ctx.consumeBlock();
  const result: ReturnMapping = {};
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/,$/, "");
    result[key] = parseScalar(val);
  }
  return result;
}

/** Parse an inline object { key: value, ... } (consumes block) */
function parseInlineObject(ctx: ParseContext, lineNo: number): Record<string, unknown> {
  const bodyLines = ctx.consumeBlock();
  const result: Record<string, unknown> = {};
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (!line) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/,$/, "");
    result[key] = parseScalar(val);
  }
  return result;
}

/** Parse a scalar value (string, number, boolean, or variable reference) */
function parseScalar(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (!isNaN(Number(raw)) && raw !== "") return Number(raw);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  // Return as-is (variable reference like "input.channelId")
  return raw;
}
