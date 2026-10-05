/**
 * Markdown contracts — the unit `tasker` runs and `schedule-sensor` wakes.
 *
 * A contract is `~/.ronin/contracts/<name>.md`: flat `key: value`
 * frontmatter between `---` fences, prompt body below. Chatty-authored,
 * no DSL compiler involved.
 *
 *   ---
 *   name: morning-briefing
 *   description: Run the morning briefing every day at 8am
 *   trigger: cron            # cron | event | manual
 *   cron: "0 8 * * *"
 *   mode: sar                # sar | opencode
 *   model:                   # optional override
 *   on_failure: ignore       # ignore | retry | notify
 *   ---
 *
 *   <instruction prompt the run executes>
 *
 * Event contracts use `trigger: event` + `event: <bus event name>` instead
 * of `cron:`. `trigger: manual` contracts never wake on their own — they
 * run via a `tasker.run` event (chatty, CLI, or another duty).
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type ContractTrigger = "cron" | "event" | "manual";
export type ContractMode = "sar" | "opencode";
export type ContractOnFailure = "ignore" | "retry" | "notify";

export interface MarkdownContract {
  /** File basename without .md (fallback if frontmatter `name` is missing). */
  name: string;
  description: string;
  trigger: ContractTrigger;
  /** 5-field cron, required when trigger === "cron". */
  cron?: string;
  /** Bus event name, required when trigger === "event". */
  event?: string;
  mode: ContractMode;
  model?: string;
  onFailure: ContractOnFailure;
  /** Instruction prompt — the markdown body. */
  prompt: string;
  file: string;
}

export function contractsDir(): string {
  const override = process.env.RONIN_CONTRACTS_DIR;
  if (override) return override;
  return join(homedir(), ".ronin", "contracts");
}

/** Parse one markdown contract file. Returns null (with a console warning) when invalid. */
export function parseContractFile(file: string): MarkdownContract | null {
  const raw = readFileSync(file, "utf-8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    console.warn(`[contracts] Skipping ${file}: missing --- frontmatter fence`);
    return null;
  }
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  const fallback = file.replace(/\\/g, "/").split("/").pop()!.replace(/\.md$/, "");
  const trigger = (meta["trigger"] || "manual") as ContractTrigger;
  const mode = (meta["mode"] || "sar") as ContractMode;
  const onFailure = (meta["on_failure"] || "ignore") as ContractOnFailure;
  if (trigger !== "cron" && trigger !== "event" && trigger !== "manual") {
    console.warn(`[contracts] Skipping ${file}: bad trigger "${meta["trigger"]}"`);
    return null;
  }
  if (trigger === "cron" && !meta["cron"]) {
    console.warn(`[contracts] Skipping ${file}: cron trigger needs a cron: line`);
    return null;
  }
  if (trigger === "event" && !meta["event"]) {
    console.warn(`[contracts] Skipping ${file}: event trigger needs an event: line`);
    return null;
  }
  if (mode !== "sar" && mode !== "opencode") {
    console.warn(`[contracts] Skipping ${file}: bad mode "${meta["mode"]}"`);
    return null;
  }
  const prompt = (match[2] || "").trim();
  if (!prompt) {
    console.warn(`[contracts] Skipping ${file}: empty prompt body`);
    return null;
  }
  return {
    name: meta["name"] || fallback,
    description: meta["description"] || "",
    trigger,
    cron: meta["cron"],
    event: meta["event"],
    mode,
    model: meta["model"] || undefined,
    onFailure: onFailure === "retry" || onFailure === "notify" ? onFailure : "ignore",
    prompt,
    file,
  };
}

/** Load every valid *.md contract in the directory (missing dir → []). */
export function loadContracts(dir?: string): MarkdownContract[] {
  const root = dir || contractsDir();
  if (!existsSync(root)) return [];
  const out: MarkdownContract[] = [];
  for (const entry of readdirSync(root)) {
    if (!entry.endsWith(".md")) continue;
    try {
      const parsed = parseContractFile(join(root, entry));
      if (parsed) out.push(parsed);
    } catch (error) {
      console.warn(`[contracts] Skipping ${entry}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return out;
}

/**
 * Cron matcher for schedule-sensor. Supports *, *\/N, N, N-M ranges,
 * and comma lists — a superset of CronScheduler (portfolio-sync needs
 * ranges like `*\/15 9-16 * * 1-5`). Sunday is 0 (7 also accepted).
 */
export function cronMatches(cronExpr: string, now: Date): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, day, month, weekday] = parts as [string, string, string, string, string];
  const values = [now.getMinutes(), now.getHours(), now.getDate(), now.getMonth() + 1, now.getDay()];
  const patterns = [minute, hour, day, month, weekday];
  for (let i = 0; i < 5; i++) {
    if (!fieldMatches(patterns[i]!, values[i]!, i === 4 ? 7 : -1, i === 4 ? 0 : -1)) return false;
  }
  return true;
}

function fieldMatches(pattern: string, value: number, wrapAlt: number, wrapTo: number): boolean {
  // Comma lists first so each arm gets full treatment.
  if (pattern.includes(",")) {
    return pattern.split(",").some((arm) => fieldMatches(arm.trim(), value, wrapAlt, wrapTo));
  }
  if (pattern === "*") return true;
  let base = pattern;
  let step = 1;
  const slash = pattern.indexOf("/");
  if (slash >= 0) {
    base = pattern.slice(0, slash);
    step = parseInt(pattern.slice(slash + 1), 10);
    if (isNaN(step) || step <= 0) return false;
  }
  const inStep = (v: number): boolean => v % step === 0;
  if (base === "" || base === "*") return inStep(value);
  if (base.includes("-")) {
    const [lo, hi] = base.split("-").map((n) => parseInt(n, 10));
    if (isNaN(lo!) || isNaN(hi!)) return false;
    return value >= lo! && value <= hi! && inStep(value);
  }
  const n = parseInt(base, 10);
  if (isNaN(n)) return false;
  // Weekday: accept 7 as Sunday.
  if (wrapAlt >= 0 && n === wrapAlt) return value === wrapTo || inStep(value);
  return value === n;
}
