/**
 * Shared duty-authoring logic.
 *
 * Used by both `ronin create duty` (src/cli/commands/create-duty.ts, CLI-only,
 * interactive) and `duties.proposeDuty` (duties/duty-executor.ts, the chat-
 * reachable proposal flow). Extracted so the two paths can't drift on what a
 * valid duty file looks like — mirrors last session's extraction of
 * KATA_DSL_GRAMMAR into src/kata/dsl-grammar.ts for the same reason.
 */

export function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derive a filesystem-safe duty name from a plain-English description —
 * takes the first few meaningful words (stopwords filtered) and kebab-cases
 * them.
 */
export function extractDutyName(description: string): string {
  const words = description.toLowerCase().split(/\s+/);
  const meaningfulWords = words.filter(
    (w) => w.length > 2 && !["the", "and", "for", "with", "that", "this"].includes(w)
  );
  return toKebabCase(meaningfulWords.slice(0, 3).join("-") || "duty");
}

/**
 * System prompt instructing the model on Ronin's BaseDuty shape and the
 * DutyAPI surface available via `this.api`. Shared verbatim between the CLI
 * and the chat proposal flow so both produce code the same validation bar
 * (validateDutyCode below) will accept.
 */
export function buildDutyAuthoringSystemPrompt(): string {
  return `You are an AI assistant helping to create Ronin duty files.

Ronin duties are TypeScript classes that extend BaseDuty. They have:
- A static schedule property (cron expression) if they should run on a schedule
- A static watch property (array of file patterns) if they should watch files
- A static webhook property (string path) if they should handle webhooks
- An execute() method that contains the main duty logic
- Optional onFileChange() and onWebhook() methods

If the duty emits, listens for, beams, or queries events, also declare that topology
(purely declarative — it does not replace the real this.api.events calls in your code,
it just makes the topology visible to tooling without scanning source):
- static events = { in: [...], out: [...] } — broadcast event names consumed/emitted
- static beams = [{ target: "duty-name", eventType: "..." }] — targeted sends
- static queries = { out: [{ target: "duty-name", queryType: "...", timeoutMs: 5000 }], served: ["..."] }
Only include the fields that actually apply — omit static events/beams/queries entirely
if the duty doesn't use them.

Available APIs via this.api:
- api.ai - AI operations (complete, chat, callTools)
- api.memory - Memory storage (store, retrieve, search)
- api.files - File operations (read, write, list, watch)
- api.db - Database operations (query, execute, transaction)
- api.http - HTTP client (get, post)
- api.events - Events (emit, on, off, beam, query, reply)
- api.plugins - Plugin calls (call)

The duty class should:
1. Import BaseDuty from "../src/duty/index.js"
2. Import DutyAPI type from "../src/types/index.js"
3. Export default class that extends BaseDuty
4. Have a constructor that calls super(api)
5. Implement execute() method with the main logic

Generate complete, working TypeScript code for the duty.`;
}

export interface DutyValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Structural validation bar for generated duty code — the same 4 checks
 * `ronin create duty` has always used. Intentionally not a real TS parse:
 * matches the existing bar rather than inventing a stricter one here.
 */
export function validateDutyCode(code: string): DutyValidationResult {
  const errors: string[] = [];
  if (!code.includes("import")) errors.push("Generated code is missing imports");
  if (!code.includes("export default class")) errors.push("Generated code is missing 'export default class'");
  if (!code.includes("extends BaseDuty")) errors.push("Generated code doesn't extend BaseDuty");
  if (!code.includes("execute()")) errors.push("Generated code is missing execute() method");
  return { valid: errors.length === 0, errors };
}

/**
 * Pull TypeScript out of a model response — prefers a fenced code block,
 * falls back to the raw text, then trims any explanatory prose the model
 * left before the first `import`.
 */
export function extractCodeFromResponse(raw: string): string {
  const codeBlockMatch = raw.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/);
  let code = codeBlockMatch?.[1] ?? raw;
  code = code.replace(/^[^i]*import/i, "import").trim();
  return code;
}
