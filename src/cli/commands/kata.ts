/**
 * Kata CLI — propose, list, show, validate, register, test, deprecate, delete katas
 *
 * Subcommands:
 *   propose <intent>      AI-generates a kata DSL from plain language intent
 *   list                  List all registered katas in local DB
 *   show <name> [ver]     Show a kata's DSL and phase graph
 *   validate <file>       Parse + compile a .kata file without registering
 *   register <file>       Register a kata from a .kata file
 *   test <name>           Test a kata with params
 *   deprecate <name>      Mark a kata as deprecated
 *   delete <name>         Delete a kata
 *
 * Aliases:
 *   ronin create kata <intent>   → same as ronin kata propose
 */

import { join, resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { stdin, stdout } from "process";
import { createInterface } from "readline";
import { getConfigService } from "../../config/ConfigService.js";
import { createAPI } from "../../api/index.js";
import { KataParser } from "../../kata/parser.js";
import { KataCompiler } from "../../kata/compiler.js";
import { KataRegistry } from "../../kata/registry.js";
import { KataStorageV2 } from "../../kata/storage-v2.js";

// ─── ANSI helpers ──────────────────────────────────────────────────────────────
const c = {
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ─── Options ───────────────────────────────────────────────────────────────────
export interface KataOptions {
  dbPath?: string;
  pluginDir?: string;
  userPluginDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  local?: boolean;   // --local: register directly, skip dojo flow
  port?: number;     // --port: ronin server port (default 3000)
  yes?: boolean;     // --yes / -y: skip confirmation prompt
  // list filters
  category?: string;
  tag?: string;
  sort?: string;
  limit?: number;
  // show extras
  phases?: boolean;
  dependencies?: boolean;
  contracts?: boolean;
  stats?: boolean;
  // test
  params?: string;
  verbose?: boolean;
  timeout?: number;
  // deprecate
  replacement?: string;
  reason?: string;
  // delete
  force?: boolean;
}

// ─── API factory ───────────────────────────────────────────────────────────────
async function getApi(options: KataOptions, skipPlugins = false) {
  const configService = getConfigService();
  await configService.load();
  const config = configService.getAll();
  const system = config.system as { userPluginDir?: string; pluginDir?: string };
  return createAPI({
    pluginDir: options.pluginDir ?? system?.pluginDir ?? join(process.cwd(), "plugins"),
    userPluginDir: options.userPluginDir ?? system?.userPluginDir,
    dbPath: options.dbPath,
    ollamaUrl: options.ollamaUrl,
    ollamaModel: options.ollamaModel,
    skipPlugins,
  });
}

// ─── Readline helper ───────────────────────────────────────────────────────────
async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────────
async function isServerRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/status`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function emitToServer(event: string, data: unknown, port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/events/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── DSL generator ─────────────────────────────────────────────────────────────
async function generateKataDSL(
  intent: string,
  api: { ai: { complete: (prompt: string) => Promise<string> } }
): Promise<string> {
  const systemPrompt = `You are a Kata DSL expert for the Ronin agent system.
Generate a Kata DSL definition from a user intent.

Kata DSL grammar:
  kata <name> v<N>
    requires skill <skill-name>
    ...
    initial <phase-name>

    phase <phase-name>
      run skill <skill-name>
      next <phase-name>

    phase <last-phase>
      run skill <skill-name>
      complete

Rules:
- Name format: domain.action (e.g. system.log.monitor, finance.audit, data.pipeline)
- Skill names use prefix convention:
    py.<name>   = Python-based skill (data processing, ML, scripts, system calls)
    ts.<name>   = TypeScript-based skill (API calls, file ops, web scraping, automation)
  Use the prefix that best matches the work each phase does.
- Every phase must either: next <phase>, complete, or fail
- The initial phase must be defined
- At least 2 phases for non-trivial intents
- Return ONLY the raw DSL text — no markdown fences, no explanation

User intent: ${intent}`;

  const raw = await api.ai.complete(systemPrompt);

  // Strip any accidental markdown fences
  return raw
    .replace(/^```[a-z]*\n?/im, "")
    .replace(/\n?```$/im, "")
    .trim();
}

// ─── subcommand: propose ───────────────────────────────────────────────────────
async function proposeKata(intent: string, options: KataOptions): Promise<void> {
  if (!intent.trim()) {
    console.error(c.red("❌ Intent required"));
    console.log(`  Usage: ronin kata propose "monitor system logs and alert on errors"`);
    process.exit(1);
  }

  console.log(c.cyan(`⚔️  Generating kata proposal for: ${c.bold(intent)}`));
  console.log(c.dim("   Using AI to draft DSL phases and skill references…\n"));

  const api = await getApi(options);
  const parser = new KataParser();
  const compiler = new KataCompiler();

  // ── Generate DSL ──
  let source: string;
  try {
    source = await generateKataDSL(intent, api);
  } catch (error) {
    console.error(c.red("❌ AI generation failed:"), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // ── Validate ──
  let compiled;
  try {
    const ast = parser.parse(source);
    compiled = compiler.compile(ast);
  } catch (error) {
    console.error(c.red("\n❌ Generated DSL failed validation:"), error instanceof Error ? error.message : String(error));
    console.log(c.dim("\nRaw DSL:\n") + source);
    process.exit(1);
  }

  const validation = compiler.validate(parser.parse(source));
  if (!validation.valid) {
    console.error(c.red("\n⚠️  Validation warnings:"));
    for (const err of validation.errors) {
      console.error(`   ${c.yellow("·")} [${err.rule}] ${err.message}${err.phase ? ` (phase: ${err.phase})` : ""}`);
    }
    console.log();
  }

  // ── Preview ──
  const phaseNames = Object.keys(compiled.phases);
  console.log(c.bold(`📋 Proposed Kata: ${c.cyan(compiled.name)} ${c.dim(`v${compiled.version}`)}`));
  console.log(c.dim(`   Phases (${phaseNames.length}): `) + phaseNames.join(c.dim(" → ")));
  if (compiled.requiredSkills.length > 0) {
    console.log(c.dim("   Skills: ") + compiled.requiredSkills.map((s) => {
      if (s.startsWith("py.")) return c.yellow(`🐍 ${s}`);
      if (s.startsWith("ts.")) return c.cyan(`⚡ ${s}`);
      return s;
    }).join("  "));
  }
  console.log();
  console.log(c.dim("─".repeat(60)));
  console.log(source);
  console.log(c.dim("─".repeat(60)));
  console.log();

  // ── Confirm ──
  if (!options.yes) {
    const answer = await prompt(c.bold("Register this kata? ") + c.dim("[y/n] "));
    if (!answer.toLowerCase().startsWith("y")) {
      console.log(c.dim("Cancelled."));
      return;
    }
  }

  // ── Register ──
  const port = options.port ?? (process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : 3000);
  const serverUp = !options.local && await isServerRunning(port);

  if (serverUp) {
    // Submit to Dojo via capability.missing → full proposal/approval flow
    const ok = await emitToServer("capability.missing", { intent, _proposedDsl: source }, port);
    if (ok) {
      console.log(c.green(`✅ Proposal submitted to Dojo Agent for review.`));
      console.log(c.dim(`   Listen for kata.creation_proposed at localhost:${port}`));
    } else {
      console.error(c.red("❌ Failed to submit to server. Try --local to register directly."));
      process.exit(1);
    }
  } else {
    // Register directly in local DB
    try {
      const registry = new KataRegistry(api);
      const result = await registry.register(source);
      console.log(c.green(`✅ Kata registered: ${c.bold(result.name)} v${result.version}`));
      console.log(c.dim(`   ${phaseNames.length} phases · ${compiled.requiredSkills.length} skills`));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("already registered")) {
        console.log(c.yellow(`⚠️  ${msg}`));
      } else {
        console.error(c.red("❌ Registration failed:"), msg);
        process.exit(1);
      }
    }
  }
  process.exit(0);
}

// ─── subcommand: list ─────────────────────────────────────────────────────────
async function listKatas(options: KataOptions): Promise<void> {
  const api = await getApi(options, true);
  const rows = await api.db?.query<{
    id: string; name: string; version: string; required_skills: string; created_at: number;
  }>("SELECT id, name, version, required_skills, created_at FROM kata_definitions ORDER BY name, version") ?? [];

  if (rows.length === 0) {
    console.log(c.dim("No katas registered. Try: ronin kata propose \"your intent\""));
    process.exit(0);
  }

  console.log(c.bold(`\n⚔️  Registered Katas (${rows.length})\n`));
  for (const row of rows) {
    const skills: string[] = JSON.parse(row.required_skills ?? "[]");
    const date = new Date(row.created_at).toLocaleDateString();
    console.log(`  ${c.cyan(c.bold(row.name))} ${c.dim(`v${row.version}`)}  ${c.dim(date)}`);
    if (skills.length > 0) {
      console.log(`  ${c.dim("skills: ")}${skills.join(", ")}`);
    }
    console.log();
  }
  process.exit(0);
}

// ─── subcommand: show ─────────────────────────────────────────────────────────
async function showKata(name: string, version: string | undefined, options: KataOptions): Promise<void> {
  if (!name) {
    console.error(c.red("❌ Kata name required"));
    console.log("  Usage: ronin kata show <name> [version]");
    process.exit(1);
  }

  const api = await getApi(options, true);
  const whereClause = version
    ? "WHERE name = ? AND version = ?"
    : "WHERE name = ? ORDER BY created_at DESC LIMIT 1";
  const params = version ? [name, version] : [name];

  const rows = await api.db?.query<{
    name: string; version: string; source_code: string; compiled_graph: string; created_at: number;
  }>(`SELECT name, version, source_code, compiled_graph, created_at FROM kata_definitions ${whereClause}`, params) ?? [];

  if (rows.length === 0) {
    console.error(c.red(`❌ Kata not found: ${name}${version ? ` v${version}` : ""}`));
    process.exit(1);
  }

  const row = rows[0];
  const compiled = JSON.parse(row.compiled_graph);
  const phaseNames = Object.keys(compiled.phases ?? {});

  console.log(c.bold(`\n⚔️  ${c.cyan(row.name)} ${c.dim(`v${row.version}`)}`));
  console.log(c.dim(`   Registered: ${new Date(row.created_at).toLocaleString()}`));
  console.log(c.dim(`   Phases (${phaseNames.length}): `) + phaseNames.join(c.dim(" → ")));
  if (compiled.requiredSkills?.length > 0) {
    console.log(c.dim("   Skills: ") + compiled.requiredSkills.map((s: string) => {
      if (s.startsWith("py.")) return c.yellow(`🐍 ${s}`);
      if (s.startsWith("ts.")) return c.cyan(`⚡ ${s}`);
      return s;
    }).join("  "));
  }
  console.log();
  console.log(c.dim("─".repeat(60)));
  console.log(row.source_code);
  console.log(c.dim("─".repeat(60)));
  console.log();
  process.exit(0);
}

// ─── subcommand: validate ─────────────────────────────────────────────────────
async function validateKataFile(filePath: string): Promise<void> {
  if (!filePath) {
    console.error(c.red("❌ File path required"));
    console.log("  Usage: ronin kata validate <file.kata>");
    process.exit(1);
  }

  if (!existsSync(filePath)) {
    console.error(c.red(`❌ File not found: ${filePath}`));
    process.exit(1);
  }

  const source = readFileSync(filePath, "utf-8");
  const parser = new KataParser();
  const compiler = new KataCompiler();

  let ast;
  try {
    ast = parser.parse(source);
  } catch (error) {
    console.error(c.red("❌ Parse error:"), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const result = compiler.validate(ast);

  if (result.valid) {
    const compiled = compiler.compile(ast);
    const phaseCount = Object.keys(compiled.phases).length;
    console.log(c.green(`✅ Valid kata: ${compiled.name} v${compiled.version}`));
    console.log(c.dim(`   ${phaseCount} phases · ${compiled.requiredSkills.length} skills`));
    process.exit(0);
  } else {
    console.error(c.red(`❌ Validation failed (${result.errors.length} error${result.errors.length !== 1 ? "s" : ""}):\n`));
    for (const err of result.errors) {
      console.error(`  ${c.yellow("·")} [${c.bold(err.rule)}] ${err.message}${err.phase ? c.dim(` (phase: ${err.phase})`) : ""}`);
    }
    process.exit(1);
  }
}

// ─── subcommand: register ─────────────────────────────────────────────────────
async function registerKataFile(filePath: string, options: KataOptions): Promise<void> {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    console.error(c.red(`❌ File not found: ${filePath}`));
    process.exit(1);
  }
  const source = readFileSync(resolved, "utf8");
  const api = await getApi(options, true);
  const registry = new KataRegistry(api);
  await new Promise((r) => setTimeout(r, 150));
  try {
    const compiled = await registry.registerOrSkip(source);
    console.log(c.green(`✅ Registered: ${compiled.name} ${compiled.version}`));
  } catch (err: any) {
    console.error(c.red(`❌ Registration failed: ${err.message}`));
    process.exit(1);
  }
}

// ─── subcommand: test ─────────────────────────────────────────────────────────
async function testKata(name: string, options: KataOptions): Promise<void> {
  if (!name) {
    console.error(c.red("❌ Usage: ronin kata test <name> [--params <json>] [--verbose]"));
    process.exit(1);
  }
  let params: Record<string, unknown> = {};
  if (options.params) {
    try { params = JSON.parse(options.params); } catch { console.error(c.red("--params must be valid JSON")); process.exit(1); }
  }
  const api = await getApi(options);
  console.log(c.bold(`\n🧪 Testing kata: ${name}`));
  if (options.verbose) console.log(`Input: ${JSON.stringify(params, null, 2)}\n`);
  // Emit test event — kata-executor handles it
  api.events?.emit("kata.execute", { kataName: name, initialVariables: params }, "cli");
  console.log(c.green(`✅ Kata execution requested. Monitor with: ronin task list --kata ${name}`));
}

// ─── subcommand: deprecate ────────────────────────────────────────────────────
async function deprecateKata(name: string, options: KataOptions): Promise<void> {
  if (!name) {
    console.error(c.red("❌ Usage: ronin kata deprecate <name> [--replacement <name>]"));
    process.exit(1);
  }
  const api = await getApi(options, true);
  const storage = new KataStorageV2(api);
  await new Promise((r) => setTimeout(r, 100));
  await storage.deprecate(name, options.replacement);
  console.log(c.yellow(`✅ Kata deprecated: ${name}`));
  if (options.replacement) console.log(`   Replacement: ${c.cyan(options.replacement)}`);
}

// ─── subcommand: delete ───────────────────────────────────────────────────────
async function deleteKata(name: string, options: KataOptions): Promise<void> {
  if (!name) {
    console.error(c.red("❌ Usage: ronin kata delete <name> [--force]"));
    process.exit(1);
  }
  if (!options.force) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(`Delete kata "${name}"? [y/N]: `, (a) => { rl.close(); resolve(a.trim()); });
    });
    if (!answer.toLowerCase().startsWith("y")) { console.log(c.dim("Cancelled.")); return; }
  }
  const api = await getApi(options, true);
  const storage = new KataStorageV2(api);
  await new Promise((r) => setTimeout(r, 100));
  await storage.delete(name);
  console.log(c.green(`✅ Deleted: ${name}`));
}

// ─── Main entry point ─────────────────────────────────────────────────────────
export async function kataCommand(args: string[], options: KataOptions = {}): Promise<void> {
  const sub = args[0] ?? "help";
  const rest = args.slice(1);

  switch (sub) {
    case "propose":
    case "create":
    case "new": {
      const intent = rest.filter((a) => !a.startsWith("--")).join(" ");
      await proposeKata(intent, options);
      break;
    }
    case "list":
    case "ls": {
      await listKatas(options);
      break;
    }
    case "show":
    case "get": {
      const name = rest.find((a) => !a.startsWith("--")) ?? "";
      const version = rest.find((a, i) => i > 0 && !a.startsWith("--"));
      await showKata(name, version, options);
      break;
    }
    case "validate":
    case "check": {
      const file = rest.find((a) => !a.startsWith("--")) ?? "";
      await validateKataFile(file);
      break;
    }
    case "register": {
      const file = rest.find((a) => !a.startsWith("--")) ?? "";
      await registerKataFile(file, options);
      break;
    }
    case "test": {
      const name = rest.find((a) => !a.startsWith("--")) ?? "";
      await testKata(name, options);
      break;
    }
    case "deprecate": {
      const name = rest.find((a) => !a.startsWith("--")) ?? "";
      await deprecateKata(name, options);
      break;
    }
    case "delete":
    case "remove": {
      const name = rest.find((a) => !a.startsWith("--")) ?? "";
      await deleteKata(name, options);
      break;
    }
    case "help":
    case "--help":
    case "-h":
    default: {
      printHelp();
      if (sub !== "help" && sub !== "--help" && sub !== "-h") {
        console.error(c.red(`\n❌ Unknown subcommand: ${sub}`));
        process.exit(1);
      }
    }
  }
  process.exit(0);
}

function printHelp(): void {
  console.log(`
${c.bold("Usage:")} ronin kata <subcommand> [options]

${c.bold("Subcommands:")}
  ${c.cyan("propose")} <intent>     AI-generates a kata DSL from plain language
  ${c.cyan("list")}                 List all registered katas
  ${c.cyan("show")} <name> [ver]    Show a kata's DSL and phase graph
  ${c.cyan("validate")} <file>      Parse + compile a .kata file without registering

${c.bold("Options:")}
  ${c.dim("--local")}              Register directly in local DB (skip dojo flow)
  ${c.dim("--yes, -y")}            Skip confirmation prompt
  ${c.dim("--port <n>")}           Ronin server port (default: 3000)
  ${c.dim("--db-path <path>")}     Custom database path
  ${c.dim("--ollama-model <m>")}   Override AI model for generation

${c.bold("Examples:")}
  ronin kata propose "monitor system logs and alert on errors"
  ronin kata propose "audit financial transactions daily" --local
  ronin create kata "sync obsidian notes to telegram"
  ronin kata list
  ronin kata show system.log.monitor
  ronin kata validate ./my-kata.kata
`);
}
