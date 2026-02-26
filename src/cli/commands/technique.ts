/**
 * Technique CLI — list, show, create, test, validate, register, deprecate, delete
 *
 * Subcommands:
 *   list        List registered techniques (--category, --tag, --type, --sort, --limit)
 *   show        Show technique details (--examples, --dependencies, --used-by, --stats)
 *   create      Interactive wizard to create a technique
 *   test        Test a technique with params (--params, --verbose, --timeout)
 *   validate    Validate a .technique file without registering
 *   register    Register a technique from a .technique file
 *   deprecate   Mark a technique as deprecated (--replacement, --reason)
 *   delete      Delete a technique (--force)
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { stdin, stdout } from "process";
import { createInterface } from "readline";
import { getConfigService } from "../../config/ConfigService.js";
import { createAPI } from "../../api/index.js";
import { TechniqueParser, TechniqueParseError } from "../../techniques/parser.js";
import { TechniqueRegistry } from "../../techniques/storage.js";
import { TechniqueExecutor } from "../../techniques/executor.js";
import type { TechniqueRow } from "../../techniques/types.js";

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const c = {
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  lime:   (s: string) => `\x1b[92m${s}\x1b[0m`,
};

// ── Options ───────────────────────────────────────────────────────────────────

export interface TechniqueOptions {
  dbPath?: string;
  pluginDir?: string;
  userPluginDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  // list filters
  category?: string;
  tag?: string;
  type?: string;
  deprecated?: boolean;
  active?: boolean;
  sort?: string;
  limit?: number;
  // show extras
  examples?: boolean;
  dependencies?: boolean;
  usedBy?: boolean;
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
  // internal: skip plugin loading for read-only subcommands
  _skipPlugins?: boolean;
}

// ── API factory ───────────────────────────────────────────────────────────────

async function getApi(options: TechniqueOptions, skipPlugins = false) {
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
    skipPlugins: skipPlugins || (options._skipPlugins ?? false),
  });
}

// ── Readline helper ───────────────────────────────────────────────────────────

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatStatus(row: TechniqueRow): string {
  return row.deprecated ? c.yellow("⚠️  Deprecated") : c.green("✅ Active");
}

function formatType(row: TechniqueRow): string {
  return row.type === "composite" ? c.cyan("composite") : c.yellow("custom");
}

function relativeTime(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdList(args: string[], options: TechniqueOptions): Promise<void> {
  const api = await getApi(options);
  const registry = new TechniqueRegistry(api);
  // Give DB a moment to init
  await new Promise((r) => setTimeout(r, 100));

  const rows = await registry.list({
    category: options.category,
    tag: options.tag,
    type: options.type as any,
    deprecated: options.deprecated,
    sort: options.sort as any,
    limit: options.limit,
  });

  if (rows.length === 0) {
    console.log(c.dim("No techniques found."));
    return;
  }

  // Group by category
  const byCategory: Record<string, TechniqueRow[]> = {};
  for (const row of rows) {
    const cat = row.category ?? "Uncategorized";
    (byCategory[cat] ??= []).push(row);
  }

  console.log(c.bold(`\nAvailable Techniques (${rows.length}):\n`));
  for (const [cat, items] of Object.entries(byCategory)) {
    console.log(c.cyan(`${cat} (${items.length}):`));
    for (const row of items) {
      const status = row.deprecated ? c.yellow(" [deprecated]") : "";
      const type = c.dim(`[${row.type}]`);
      console.log(`  ${c.bold(row.name)} ${c.dim("v" + row.version)} ${type}${status}`);
      if (row.description) console.log(`    ${c.dim(row.description)}`);
    }
    console.log();
  }
}

async function cmdShow(args: string[], options: TechniqueOptions): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error(c.red("Usage: ronin technique show <name>"));
    process.exit(1);
  }

  const api = await getApi(options);
  const registry = new TechniqueRegistry(api);
  await new Promise((r) => setTimeout(r, 100));

  const row = await registry.get(name);
  if (!row) {
    console.error(c.red(`Technique not found: ${name}`));
    process.exit(1);
  }

  const parser = new TechniqueParser();
  let def;
  try {
    def = parser.parse(row.definition);
  } catch {
    def = null;
  }

  console.log();
  console.log(`${c.bold("Technique:")} ${c.cyan(row.name)} ${c.dim("v" + row.version)}`);
  console.log(`${c.bold("Type:")}      ${formatType(row)}`);
  console.log(`${c.bold("Category:")} ${row.category ?? c.dim("—")}`);
  console.log(`${c.bold("Status:")}   ${formatStatus(row)}`);
  if (row.deprecated && row.replacement_technique) {
    console.log(`${c.bold("Replacement:")} ${c.yellow(row.replacement_technique)}`);
  }
  console.log(`${c.bold("Description:")} ${row.description}`);

  if (row.tags) {
    try {
      const tags: string[] = JSON.parse(row.tags);
      console.log(`${c.bold("Tags:")}     ${tags.map((t) => c.dim(`#${t}`)).join(" ")}`);
    } catch {}
  }

  if (options.dependencies || options.usedBy) {
    console.log();
    if (options.dependencies) {
      const deps = await registry.getDependencies(name);
      console.log(c.bold("Dependencies:"));
      if (deps.length === 0) {
        console.log(c.dim("  None"));
      } else {
        for (const d of deps) {
          console.log(`  ${c.dim(d.kind + ":")} ${d.dep}`);
        }
      }
    }
    if (options.usedBy) {
      const katas = await registry.getUsedBy(name);
      console.log(c.bold("\nUsed by Katas:"));
      if (katas.length === 0) {
        console.log(c.dim("  None"));
      } else {
        for (const k of katas) console.log(`  ${c.cyan(k)}`);
      }
    }
  }

  if (def?.type === "composite" && def.ast.type === "composite" && def.ast.steps.length > 0) {
    console.log();
    console.log(c.bold("Execution Flow:"));
    for (const step of def.ast.steps) {
      console.log(`  ${c.dim("step")} ${c.cyan(step.name)}  ${c.dim("→")} ${step.runType} ${c.bold(step.runName)}`);
    }
  }

  if (options.stats) {
    console.log();
    console.log(c.bold("Stats:"));
    console.log(`  Created:         ${new Date(row.created_at).toLocaleDateString()}`);
    console.log(`  Last used:       ${relativeTime(row.last_used_at)}`);
    console.log(`  Total runs:      ${row.usage_count}`);
    console.log(`  Avg duration:    ${formatDuration(row.average_duration)}`);
  }

  console.log();
}

async function cmdValidate(args: string[], options: TechniqueOptions): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error(c.red("Usage: ronin technique validate <file>"));
    process.exit(1);
  }

  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    console.error(c.red(`File not found: ${filePath}`));
    process.exit(1);
  }

  const source = readFileSync(resolved, "utf8");
  const parser = new TechniqueParser();

  try {
    const def = parser.parse(source);
    console.log(c.green(`✅ Technique definition valid`));
    console.log(`   Name:    ${c.bold(def.name)} v${def.version}`);
    console.log(`   Type:    ${def.type}`);
    if (def.type === "composite" && def.ast.type === "composite") {
      console.log(`   Steps:   ${def.ast.steps.length}`);
    }
    console.log(`   Deps:    ${def.requires.length}`);
    if (!def.category) console.log(c.yellow("   ⚠ No category specified (recommended)"));
    if (!def.tags || def.tags.length === 0) console.log(c.yellow("   ⚠ No tags specified (recommended)"));
  } catch (err: any) {
    console.error(c.red(`❌ Invalid technique: ${err.message}`));
    process.exit(1);
  }
}

async function cmdRegister(args: string[], options: TechniqueOptions): Promise<void> {
  const filePath = args[0];
  if (!filePath) {
    console.error(c.red("Usage: ronin technique register <file>"));
    process.exit(1);
  }

  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    console.error(c.red(`File not found: ${filePath}`));
    process.exit(1);
  }

  const source = readFileSync(resolved, "utf8");
  const parser = new TechniqueParser();

  let def;
  try {
    def = parser.parse(source);
  } catch (err: any) {
    console.error(c.red(`❌ Parse error: ${err.message}`));
    process.exit(1);
  }

  const api = await getApi(options);
  const registry = new TechniqueRegistry(api);
  await new Promise((r) => setTimeout(r, 150));

  try {
    await registry.register(def);
    console.log(c.green(`✅ Registered: ${def.name} ${def.version}`));
  } catch (err: any) {
    console.error(c.red(`❌ Registration failed: ${err.message}`));
    process.exit(1);
  }
}

async function cmdTest(args: string[], options: TechniqueOptions): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error(c.red("Usage: ronin technique test <name> [--params <json>] [--verbose]"));
    process.exit(1);
  }

  let params: Record<string, unknown> = {};
  if (options.params) {
    try {
      params = JSON.parse(options.params);
    } catch {
      console.error(c.red("--params must be valid JSON"));
      process.exit(1);
    }
  }

  const api = await getApi(options);
  const executor = new TechniqueExecutor(api);
  await new Promise((r) => setTimeout(r, 150));

  console.log(c.bold(`\n🧪 Testing technique: ${name}`));
  if (options.verbose) {
    console.log(`Input: ${JSON.stringify(params, null, 2)}\n`);
  }

  const start = Date.now();
  try {
    const result = await executor.execute(name, params, { api });
    const elapsed = Date.now() - start;

    if (options.verbose) {
      console.log(c.bold("Steps:"));
      for (const step of result.steps) {
        const status = step.error ? c.red("✗") : c.green("✓");
        console.log(`  ${status} ${step.name} ${c.dim(`(${formatDuration(step.durationMs)})`)}`);
        if (step.error) console.log(`      ${c.red(step.error)}`);
      }
      console.log();
    }

    console.log(c.bold("Output:"));
    console.log(JSON.stringify(result.output, null, 2));
    console.log();
    console.log(c.green(`✅ Test passed (${formatDuration(elapsed)} total)`));
  } catch (err: any) {
    console.error(c.red(`\n❌ Test failed: ${err.message}`));
    process.exit(1);
  }
}

async function cmdDeprecate(args: string[], options: TechniqueOptions): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error(c.red("Usage: ronin technique deprecate <name> [--replacement <name>] [--reason <text>]"));
    process.exit(1);
  }

  const api = await getApi(options);
  const registry = new TechniqueRegistry(api);
  await new Promise((r) => setTimeout(r, 100));

  const row = await registry.get(name);
  if (!row) {
    console.error(c.red(`Technique not found: ${name}`));
    process.exit(1);
  }

  await registry.deprecate(name, options.replacement, options.reason);
  console.log(c.yellow(`✅ Technique deprecated: ${name}`));
  if (options.replacement) console.log(`   Replacement: ${c.cyan(options.replacement)}`);
  if (options.reason) console.log(`   Reason: ${c.dim(options.reason)}`);

  const usedBy = await registry.getUsedBy(name);
  if (usedBy.length > 0) {
    console.log(c.yellow(`\nKatas using ${name} (${usedBy.length}):`));
    for (const k of usedBy) console.log(`  - ${k}`);
  }
}

async function cmdDelete(args: string[], options: TechniqueOptions): Promise<void> {
  const name = args[0];
  if (!name) {
    console.error(c.red("Usage: ronin technique delete <name> [--force]"));
    process.exit(1);
  }

  const api = await getApi(options);
  const registry = new TechniqueRegistry(api);
  await new Promise((r) => setTimeout(r, 100));

  const row = await registry.get(name);
  if (!row) {
    console.error(c.red(`Technique not found: ${name}`));
    process.exit(1);
  }

  const usedBy = await registry.getUsedBy(name);
  if (usedBy.length > 0 && !options.force) {
    console.log(c.yellow(`⚠ Warning: This technique is used by ${usedBy.length} kata(s):`));
    for (const k of usedBy) console.log(`  - ${k}`);
    const confirm = await prompt("Delete anyway? [y/N]: ");
    if (!confirm.toLowerCase().startsWith("y")) {
      console.log(c.dim("Cancelled."));
      return;
    }
  } else if (!options.force) {
    const confirm = await prompt(`Delete technique "${name}"? [y/N]: `);
    if (!confirm.toLowerCase().startsWith("y")) {
      console.log(c.dim("Cancelled."));
      return;
    }
  }

  await registry.delete(name);
  console.log(c.green(`✅ Deleted: ${name}`));
}

async function cmdCreate(args: string[], options: TechniqueOptions): Promise<void> {
  console.log(c.bold("\n🔧 Technique Creation Wizard\n"));

  const name = args[0] ?? await prompt("Technique name (e.g. discord.summarizeChannel): ");
  const category = await prompt("Category: ");
  const description = await prompt("Description: ");
  const typeChoice = await prompt("Type (1=composite, 2=custom) [1]: ");
  const type = typeChoice === "2" ? "custom" : "composite";

  let dsl = `technique ${name} v1\n`;
  dsl += `  description "${description}"\n`;
  if (category) dsl += `  category "${category}"\n`;
  dsl += `  type ${type}\n`;

  if (type === "composite") {
    const steps: string[] = [];
    let stepNum = 1;
    console.log(c.dim("\nAdd steps (blank run name to finish):"));
    while (true) {
      const runName = await prompt(`  Step ${stepNum} - run skill/tool name (blank to finish): `);
      if (!runName) break;
      const runTypeChoice = await prompt(`  Step ${stepNum} - type (skill/tool) [skill]: `);
      const runType = runTypeChoice === "tool" ? "tool" : "skill";
      const outputVar = await prompt(`  Step ${stepNum} - output variable name: `);
      steps.push(`  step step${stepNum}\n    run ${runType} ${runName}\n    with {}\n    output ${outputVar || `step${stepNum}_output`}`);
      stepNum++;
    }
    if (steps.length > 0) {
      dsl += "\n" + steps.join("\n\n") + "\n\n";
      dsl += `  return {}\n`;
    }
  } else {
    const handler = await prompt("Handler file path: ");
    dsl += `  handler "${handler}"\n`;
  }

  console.log(c.bold("\nGenerated technique definition:"));
  console.log(c.dim("─".repeat(50)));
  console.log(dsl);
  console.log(c.dim("─".repeat(50)));

  const confirm = await prompt("\nRegister this technique? [Y/n]: ");
  if (confirm.toLowerCase() === "n") {
    console.log(c.dim("Cancelled."));
    return;
  }

  const parser = new TechniqueParser();
  let def;
  try {
    def = parser.parse(dsl);
  } catch (err: any) {
    console.error(c.red(`❌ Parse error: ${err.message}`));
    process.exit(1);
  }

  const api = await getApi(options);
  const registry = new TechniqueRegistry(api);
  await new Promise((r) => setTimeout(r, 150));

  try {
    await registry.register(def);
    console.log(c.green(`\n✅ Technique registered: ${def.name} ${def.version}`));
  } catch (err: any) {
    console.error(c.red(`❌ Registration failed: ${err.message}`));
    process.exit(1);
  }
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${c.bold("ronin technique")} — Manage reusable technique definitions

${c.bold("USAGE")}
  ronin technique <subcommand> [options]

${c.bold("SUBCOMMANDS")}
  list          List registered techniques
  show <name>   Show technique details
  create        Interactive technique creation wizard
  test <name>   Test a technique with given params
  validate <f>  Validate a .technique file
  register <f>  Register a technique from a file
  deprecate <n> Mark a technique as deprecated
  delete <n>    Delete a technique

${c.bold("LIST OPTIONS")}
  --category <name>   Filter by category
  --tag <tag>         Filter by tag
  --type <type>       Filter by type (composite|custom)
  --deprecated        Show deprecated techniques
  --sort <field>      Sort by: name, created, usage
  --limit <n>         Limit results

${c.bold("SHOW OPTIONS")}
  --examples          Show usage examples
  --dependencies      Show dependencies
  --used-by           Show katas that use it
  --stats             Show execution stats

${c.bold("TEST OPTIONS")}
  --params <json>     Input parameters as JSON
  --verbose           Show detailed execution
  --timeout <ms>      Timeout in milliseconds

${c.bold("DEPRECATE OPTIONS")}
  --replacement <n>   Replacement technique name
  --reason <text>     Deprecation reason

${c.bold("DELETE OPTIONS")}
  --force             Skip confirmation
`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function techniqueCommand(args: string[], options: TechniqueOptions): Promise<void> {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  // Subcommands that don't need plugins
  const PLUGIN_FREE = new Set(["list", "show", "validate", "register", "deprecate", "delete"]);
  if (PLUGIN_FREE.has(subcommand)) options._skipPlugins = true;

  switch (subcommand) {
    case "list":      await cmdList(subArgs, options); break;
    case "show":      await cmdShow(subArgs, options); break;
    case "create":    await cmdCreate(subArgs, options); break;
    case "test":      await cmdTest(subArgs, options); break;
    case "validate":  await cmdValidate(subArgs, options); break;
    case "register":  await cmdRegister(subArgs, options); break;
    case "deprecate": await cmdDeprecate(subArgs, options); break;
    case "delete":    await cmdDelete(subArgs, options); break;
    default:
      if (!subcommand || subcommand === "help" || subcommand === "--help") {
        printHelp();
      } else {
        console.error(c.red(`Unknown technique subcommand: ${subcommand}`));
        printHelp();
        process.exit(1);
      }
  }
  process.exit(0);
}
