/**
 * ronin kdb — inspect Ronin's file-backed memory (memory/notes, memory/conversations, memory/blackboards)
 *
 * Subcommands:
 *   stats                     Show file counts per memory area
 *   memory search <query>     Search notes by text (--limit N)
 *   memory recent             Recently modified notes (--limit N)
 *   memory get <key>          Retrieve a stored value by key
 *   conversation <duty>       Show a duty's conversation transcript (--limit N)
 *   blackboard <duty>         Show a duty's blackboard
 */

import { join, dirname } from "path";
import { existsSync, readdirSync } from "fs";
import { getConfigService } from "../../config/ConfigService.js";
import { createAPI } from "../../api/index.js";

export interface KdbOptions {
  dbPath?: string;
  pluginDir?: string;
  userPluginDir?: string;
}

async function getApi(options: KdbOptions = {}) {
  const configService = getConfigService();
  await configService.load();
  const config = configService.getAll();
  const system = config.system as { userPluginDir?: string; pluginDir?: string };
  const dbPath = options.dbPath ?? (config as { dbPath?: string }).dbPath;

  return createAPI({
    pluginDir: options.pluginDir ?? system?.pluginDir ?? join(process.cwd(), "plugins"),
    userPluginDir: options.userPluginDir ?? system?.userPluginDir,
    dbPath,
  });
}

function memoryDir(options: KdbOptions): string {
  return options.dbPath ? join(dirname(options.dbPath), "memory") : "memory";
}

function countMarkdownFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".md")).length;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function kdbCommand(args: string[], options: KdbOptions = {}): Promise<void> {
  const sub = args[0] ?? "stats";
  const rest = args.slice(1);

  if (sub === "stats") {
    await kdbStats(options);
    return;
  }

  if (sub === "memory") {
    const action = rest[0];
    if (!action || action.startsWith("--")) {
      console.error("❌ Usage: ronin kdb memory <search|recent|get> [args] [--limit N]");
      process.exit(1);
    }
    await kdbMemory(action, rest.slice(1), options);
    return;
  }

  if (sub === "conversation") {
    const dutyName = rest[0] && !rest[0].startsWith("--") ? rest[0] : undefined;
    if (!dutyName) {
      console.error("❌ Usage: ronin kdb conversation <duty> [--limit N]");
      process.exit(1);
    }
    await kdbConversation(dutyName, rest.slice(1), options);
    return;
  }

  if (sub === "blackboard") {
    const dutyName = rest[0] && !rest[0].startsWith("--") ? rest[0] : undefined;
    if (!dutyName) {
      console.error("❌ Usage: ronin kdb blackboard <duty>");
      process.exit(1);
    }
    await kdbBlackboard(dutyName, options);
    return;
  }

  console.error(`❌ Unknown subcommand: ${sub}`);
  console.log("Usage: ronin kdb <stats|memory|conversation|blackboard> ...");
  console.log("       ronin kdb stats");
  console.log("       ronin kdb memory search <query> [--limit N]");
  console.log("       ronin kdb memory recent [--limit N]");
  console.log("       ronin kdb memory get <key>");
  console.log("       ronin kdb conversation <duty> [--limit N]");
  console.log("       ronin kdb blackboard <duty>");
  process.exit(1);
}

function getLimit(args: string[], defaultLimit: number): number {
  const i = args.indexOf("--limit");
  if (i !== -1 && i + 1 < args.length) {
    const n = parseInt(args[i + 1] ?? "", 10);
    if (!Number.isNaN(n) && n > 0) return Math.min(n, 100);
  }
  return defaultLimit;
}

async function kdbStats(options: KdbOptions): Promise<void> {
  const dir = memoryDir(options);

  console.log("\n📊 Memory stats (" + dir + ")\n");
  console.log("  notes:         " + countMarkdownFiles(join(dir, "notes")));
  console.log("  conversations: " + countMarkdownFiles(join(dir, "conversations")));
  console.log("  blackboards:   " + countMarkdownFiles(join(dir, "blackboards")));
  console.log("");
}

async function kdbMemory(
  action: string,
  args: string[],
  options: KdbOptions
): Promise<void> {
  const api = await getApi(options);

  if (action === "search") {
    const query = args.filter(a => !a.startsWith("--")).join(" ").trim();
    if (!query) {
      console.error("❌ ronin kdb memory search <query> [--limit N]");
      process.exit(1);
    }
    const limit = getLimit(args, 10);
    const results = await api.memory.search(query, limit);
    console.log(formatJson(results.map(m => ({
      id: m.id,
      key: m.key,
      text: m.text ?? (typeof m.value === "string" ? m.value.slice(0, 200) : undefined),
      createdAt: m.createdAt.toISOString(),
    }))));
    return;
  }

  if (action === "recent") {
    const limit = getLimit(args, 10);
    const results = await api.memory.getRecent(limit);
    console.log(formatJson(results.map(m => ({
      id: m.id,
      key: m.key,
      text: m.text ?? (typeof m.value === "string" ? m.value.slice(0, 200) : undefined),
      createdAt: m.createdAt.toISOString(),
    }))));
    return;
  }

  if (action === "get") {
    const key = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
    if (!key) {
      console.error("❌ ronin kdb memory get <key>");
      process.exit(1);
    }
    const value = await api.memory.retrieve(key);
    if (value === null || value === undefined) {
      console.log("(not found)");
      return;
    }
    console.log(formatJson(value));
    return;
  }

  console.error(`❌ Unknown memory action: ${action}`);
  console.log("Usage: ronin kdb memory <search|recent|get> ...");
  process.exit(1);
}

async function kdbConversation(dutyName: string, args: string[], options: KdbOptions): Promise<void> {
  const api = await getApi(options);
  const limit = getLimit(args, 50);
  const entries = await api.memory.getConversations(dutyName, limit);
  if (!entries.length) {
    console.log("(no conversation history for " + dutyName + ")");
    return;
  }
  for (const entry of entries) {
    console.log(`### ${entry.role} — ${entry.createdAt.toISOString()}`);
    console.log(entry.content);
    console.log("");
  }
}

async function kdbBlackboard(dutyName: string, options: KdbOptions): Promise<void> {
  const api = await getApi(options);
  const content = await api.memory.getBlackboard(dutyName);
  console.log(content || "(empty blackboard for " + dutyName + ")");
}
