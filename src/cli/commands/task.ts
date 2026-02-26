/**
 * Task CLI — list, show, cancel, retry
 *
 * Subcommands:
 *   list            List tasks (--status, --kata, --contract, --limit)
 *   show <task-id>  Show task details with phase breakdown
 *   cancel <id>     Cancel a running/pending task
 *   retry <id>      Retry a failed task
 */

import { join } from "path";
import { getConfigService } from "../../config/ConfigService.js";
import { createAPI } from "../../api/index.js";
import { TaskStorageV2 } from "../../task/storage-v2.js";
import type { TaskV2Row, TaskPhaseRow, TaskV2Status } from "../../techniques/types.js";

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const c = {
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
};

// ── Options ───────────────────────────────────────────────────────────────────

export interface TaskOptions {
  dbPath?: string;
  pluginDir?: string;
  userPluginDir?: string;
  status?: string;
  kata?: string;
  contract?: string;
  limit?: number;
  force?: boolean;
}

// ── API factory ───────────────────────────────────────────────────────────────

async function getApi(options: TaskOptions) {
  const configService = getConfigService();
  await configService.load();
  const config = configService.getAll();
  const system = config.system as { userPluginDir?: string; pluginDir?: string };
  return createAPI({
    pluginDir: options.pluginDir ?? system?.pluginDir ?? join(process.cwd(), "plugins"),
    userPluginDir: options.userPluginDir ?? system?.userPluginDir,
    dbPath: options.dbPath,
    skipPlugins: true,
  });
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatTaskStatus(status: TaskV2Status): string {
  switch (status) {
    case "completed": return c.green("✅ completed");
    case "running":   return c.cyan("⚡ running");
    case "pending":   return c.yellow("⏳ pending");
    case "failed":    return c.red("❌ failed");
    case "canceled":  return c.dim("🚫 canceled");
    default:          return c.dim(status);
  }
}

function formatPhaseStatus(status: string): string {
  switch (status) {
    case "completed": return c.green("✓");
    case "running":   return c.cyan("→");
    case "pending":   return c.dim("○");
    case "failed":    return c.red("✗");
    default:          return c.dim("?");
  }
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function relativeTime(ts: number | null): string {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleString();
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdList(args: string[], options: TaskOptions): Promise<void> {
  const api = await getApi(options);
  const storage = new TaskStorageV2(api);
  await new Promise((r) => setTimeout(r, 100));

  const tasks = await storage.listTasks({
    status: options.status as TaskV2Status | undefined,
    kata: options.kata,
    contract: options.contract,
    limit: options.limit ?? 20,
  });

  if (tasks.length === 0) {
    console.log(c.dim("No tasks found."));
    return;
  }

  console.log(c.bold(`\nTasks (${tasks.length}):\n`));
  const header = `  ${"Task ID".padEnd(16)} ${"Status".padEnd(14)} ${"Kata".padEnd(30)} ${"Duration".padEnd(10)} Started`;
  console.log(c.dim(header));
  console.log(c.dim("  " + "─".repeat(85)));

  for (const task of tasks) {
    const statusStr = task.status === "completed" ? c.green("completed".padEnd(12))
      : task.status === "failed" ? c.red("failed".padEnd(12))
      : task.status === "running" ? c.cyan("running".padEnd(12))
      : c.dim(task.status.padEnd(12));
    const kata = `${task.source_kata}`.slice(0, 28).padEnd(30);
    const dur = formatDuration(task.duration).padEnd(10);
    const started = relativeTime(task.started_at);
    console.log(`  ${task.task_id.padEnd(16)} ${statusStr}   ${kata} ${dur} ${started}`);
  }
  console.log();
}

async function cmdShow(args: string[], options: TaskOptions): Promise<void> {
  const taskId = args[0]?.replace(/^#/, ""); // allow #tsk_xxx or tsk_xxx
  if (!taskId) {
    console.error(c.red("Usage: ronin task show <task-id>"));
    process.exit(1);
  }

  const api = await getApi(options);
  const storage = new TaskStorageV2(api);
  await new Promise((r) => setTimeout(r, 100));

  const task = await storage.getTask(taskId);
  if (!task) {
    console.error(c.red(`Task not found: ${taskId}`));
    process.exit(1);
  }

  const phases = await storage.getPhases(taskId);

  console.log();
  console.log(`${c.bold("Task:")}    ${c.cyan(task.task_id)}`);
  console.log(`${c.bold("Status:")}  ${formatTaskStatus(task.status)}`);
  console.log(`${c.bold("Kata:")}    ${task.source_kata} ${c.dim("v" + task.source_kata_version)}`);
  if (task.source_contract) {
    console.log(`${c.bold("Contract:")} ${task.source_contract}`);
  }
  console.log(`${c.bold("Created:")} ${relativeTime(task.created_at)}`);
  if (task.started_at) console.log(`${c.bold("Started:")} ${relativeTime(task.started_at)}`);
  if (task.completed_at) console.log(`${c.bold("Completed:")} ${relativeTime(task.completed_at)}`);
  if (task.duration) console.log(`${c.bold("Duration:")} ${formatDuration(task.duration)}`);
  if (task.error) {
    console.log(`${c.bold("Error:")} ${c.red(task.error)}`);
    if (task.error_phase) console.log(`${c.bold("Error phase:")} ${c.red(task.error_phase)}`);
  }

  if (phases.length > 0) {
    console.log();
    console.log(c.bold("Phase Execution:"));
    for (const phase of phases) {
      const icon = formatPhaseStatus(phase.status);
      const dur = formatDuration(phase.duration);
      const what = phase.technique_name
        ? `technique ${c.cyan(phase.technique_name)}`
        : phase.skill_name
        ? `skill ${c.cyan(phase.skill_name)}`
        : phase.tool_name
        ? `tool ${c.cyan(phase.tool_name)}`
        : "";
      console.log(`  ${icon} ${c.bold(phase.phase_name)} ${c.dim(phase.phase_type ?? "")} ${what} ${c.dim(`(${dur})`)}`);
      if (phase.error) console.log(`      ${c.red("Error: " + phase.error)}`);
    }
  }

  if (task.output) {
    console.log();
    console.log(c.bold("Output:"));
    try {
      console.log(JSON.stringify(JSON.parse(task.output), null, 2));
    } catch {
      console.log(task.output);
    }
  }

  console.log();
}

async function cmdCancel(args: string[], options: TaskOptions): Promise<void> {
  const taskId = args[0]?.replace(/^#/, "");
  if (!taskId) { console.error(c.red("Usage: ronin task cancel <task-id>")); process.exit(1); }

  const api = await getApi(options);
  const storage = new TaskStorageV2(api);
  await new Promise((r) => setTimeout(r, 100));

  const task = await storage.getTask(taskId);
  if (!task) { console.error(c.red(`Task not found: ${taskId}`)); process.exit(1); }

  if (task.status !== "pending" && task.status !== "running") {
    console.error(c.yellow(`Task is already ${task.status} — cannot cancel.`));
    process.exit(1);
  }

  await storage.updateTaskStatus(taskId, "canceled");
  console.log(c.yellow(`✅ Task canceled: ${taskId}`));
}

async function cmdRetry(args: string[], options: TaskOptions): Promise<void> {
  const taskId = args[0]?.replace(/^#/, "");
  if (!taskId) { console.error(c.red("Usage: ronin task retry <task-id>")); process.exit(1); }

  const api = await getApi(options);
  const storage = new TaskStorageV2(api);
  await new Promise((r) => setTimeout(r, 100));

  const task = await storage.getTask(taskId);
  if (!task) { console.error(c.red(`Task not found: ${taskId}`)); process.exit(1); }

  if (task.status !== "failed" && task.status !== "canceled") {
    console.error(c.yellow(`Task is ${task.status} — can only retry failed or canceled tasks.`));
    process.exit(1);
  }

  // Reset to pending
  await storage.updateTaskStatus(taskId, "pending", { error: undefined });
  console.log(c.green(`✅ Task reset to pending: ${taskId}`));
  console.log(c.dim("The kata-runner agent will pick it up on the next tick."));
}

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${c.bold("ronin task")} — View and manage task executions

${c.bold("USAGE")}
  ronin task <subcommand> [options]

${c.bold("SUBCOMMANDS")}
  list                   List tasks
  show <task-id>         Show task details and phase breakdown
  cancel <task-id>       Cancel a pending or running task
  retry <task-id>        Retry a failed or canceled task

${c.bold("LIST OPTIONS")}
  --status <status>      Filter by status (pending|running|completed|failed|canceled)
  --kata <name>          Filter by source kata
  --contract <name>      Filter by source contract
  --limit <n>            Limit results (default: 20)
`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function taskCommand(args: string[], options: TaskOptions): Promise<void> {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "list":   await cmdList(subArgs, options); break;
    case "show":   await cmdShow(subArgs, options); break;
    case "cancel": await cmdCancel(subArgs, options); break;
    case "retry":  await cmdRetry(subArgs, options); break;
    default:
      if (!subcommand || subcommand === "help" || subcommand === "--help") {
        printHelp();
      } else {
        console.error(c.red(`Unknown task subcommand: ${subcommand}`));
        printHelp();
        process.exit(1);
      }
  }
  process.exit(0);
}
