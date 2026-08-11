/**
 * Workflow CLI — list, show, new, edit, propose
 *
 * Subcommands:
 *   list                   List all workflows (name, status, tags)
 *   show <name>             Print a workflow's contents
 *   new <name>               Scaffold a blank workflow and open it in $EDITOR
 *   edit <name>              Open an existing workflow in $EDITOR
 *   propose "<description>"  AI-drafts a workflow from plain language, y/n confirm, writes on yes
 *
 * No server/db dependency — workflows/ is plain files. `propose` is the only
 * subcommand that touches AI (via createAPI, same as `ronin kata propose`).
 */

import { spawn } from "child_process";
import { stdin, stdout } from "process";
import { createInterface } from "readline";
import { getConfigService } from "../../config/ConfigService.js";
import { createAPI } from "../../api/index.js";
import {
  listWorkflows,
  loadWorkflow,
  getWorkflowsDir,
  sanitizeWorkflowName,
  WorkflowStorage,
  proposeWorkflow,
  WorkflowProposeError,
  renderWorkflowFile,
} from "../../workflow/index.js";
import { join } from "path";

// ─── ANSI helpers ──────────────────────────────────────────────────────────
const c = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

export interface WorkflowOptions {
  dbPath?: string;
  pluginDir?: string;
  userPluginDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  yes?: boolean;
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getApi(options: WorkflowOptions) {
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
  });
}

function openInEditor(filePath: string): void {
  const editor = process.env.EDITOR || "nano";
  spawn(editor, [filePath], { stdio: "inherit" });
}

function printHelp(): void {
  console.log(`
${c.bold("ronin workflow")} — markdown SOPs Duties consult as guidance (never executed)

${c.cyan("list")}                       List all workflows
${c.cyan("show")} <name>                 Print a workflow's contents
${c.cyan("new")} <name>                  Scaffold a blank workflow and open it in $EDITOR
${c.cyan("edit")} <name>                 Open an existing workflow in $EDITOR
${c.cyan("propose")} "<description>"      AI-drafts a workflow, confirm, writes to workflows/

Workflows live in ${c.dim("workflows/")} at the project root — plain markdown, hand-editable any time.
See ${c.dim("docs/WORKFLOWS_PLAN.md")}.
`);
}

function cmdList(): void {
  const workflows = listWorkflows();
  if (workflows.length === 0) {
    console.log(c.dim(`No workflows found in ${getWorkflowsDir()}`));
    return;
  }
  console.log(c.bold(`\nWorkflows (${workflows.length})\n`));
  for (const w of workflows) {
    const statusColor = w.status === "active" ? c.green : w.status === "deprecated" ? c.red : c.dim;
    console.log(`  ${c.cyan(w.name)} ${statusColor(`[${w.status}]`)}`);
    if (w.description) console.log(`    ${w.description}`);
    if (w.tags.length) console.log(`    ${c.dim(w.tags.join(", "))}`);
  }
  console.log();
}

function cmdShow(args: string[]): void {
  const name = args[0];
  if (!name) {
    console.error(c.red("❌ Usage: ronin workflow show <name>"));
    process.exit(1);
  }
  const doc = loadWorkflow(name);
  if (!doc) {
    console.error(c.red(`❌ Workflow not found: ${name}`));
    process.exit(1);
  }
  console.log(doc.raw);
}

function cmdNew(args: string[]): void {
  const name = args[0];
  if (!name) {
    console.error(c.red("❌ Usage: ronin workflow new <name>"));
    process.exit(1);
  }
  const safe = sanitizeWorkflowName(name);
  if (!safe) {
    console.error(c.red(`❌ Invalid name "${name}" — use lowercase letters, numbers, and hyphens.`));
    process.exit(1);
  }
  if (loadWorkflow(safe)) {
    console.error(c.red(`❌ Workflow already exists: ${safe} — use "ronin workflow edit ${safe}" instead.`));
    process.exit(1);
  }

  const content = renderWorkflowFile(
    { name: safe, description: "", tags: [], status: "draft", skills: [] },
    "# Title\n\n## Purpose\n\n## When to use\n\n## Standards & expectations\n\n## Steps\n1. \n\n## Notes\n"
  );

  const storage = new WorkflowStorage();
  storage.save(safe, content).then((saved) => {
    const filePath = join(getWorkflowsDir(), `${saved}.md`);
    console.log(c.green(`✅ Created: ${filePath}`));
    openInEditor(filePath);
  });
}

function cmdEdit(args: string[]): void {
  const name = args[0];
  if (!name) {
    console.error(c.red("❌ Usage: ronin workflow edit <name>"));
    process.exit(1);
  }
  const doc = loadWorkflow(name);
  if (!doc) {
    console.error(c.red(`❌ Workflow not found: ${name}`));
    process.exit(1);
  }
  openInEditor(doc.filePath);
}

async function cmdPropose(args: string[], options: WorkflowOptions): Promise<void> {
  const intent = args.join(" ").trim();
  if (!intent) {
    console.error(c.red("❌ Description required"));
    console.log(`  Usage: ronin workflow propose "how we launch and market a shipped app"`);
    process.exit(1);
  }

  const api = await getApi(options);

  let proposal;
  try {
    proposal = await proposeWorkflow(intent, api);
  } catch (error) {
    const msg = error instanceof WorkflowProposeError || error instanceof Error ? error.message : String(error);
    console.error(c.red("❌ Proposal failed:"), msg);
    process.exit(1);
  }

  console.log(c.bold("\nDrafted workflow:\n"));
  console.log(proposal.content);
  console.log();

  if (!options.yes) {
    const answer = await prompt(c.bold("Save this workflow? ") + c.dim("[y/n] "));
    if (!answer.toLowerCase().startsWith("y")) {
      console.log(c.dim("Cancelled."));
      return;
    }
  }

  const storage = new WorkflowStorage();
  try {
    const saved = await storage.save(proposal.name, proposal.content);
    console.log(c.green(`✅ Workflow saved: ${c.bold(saved)}`));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(c.red("❌ Failed to save:"), msg);
    process.exit(1);
  }
}

export async function workflowCommand(args: string[], options: WorkflowOptions): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      cmdList();
      break;
    case "show":
      cmdShow(rest);
      break;
    case "new":
      cmdNew(rest);
      break;
    case "edit":
      cmdEdit(rest);
      break;
    case "propose":
      await cmdPropose(rest, options);
      break;
    case "help":
    case undefined:
      printHelp();
      break;
    default:
      console.error(c.red(`❌ Unknown workflow subcommand: ${sub}`));
      printHelp();
      process.exit(1);
  }
}
