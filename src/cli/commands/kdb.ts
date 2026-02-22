/**
 * ronin kdb — ontology and memory stats and queries
 *
 * Subcommands:
 *   stats                    Show ontology + memory table stats
 *   memory search <query>     Search memories by text (--limit N)
 *   memory recent            Recent memories (--limit N)
 *   memory get <key>         Retrieve value by key
 *   ontology search           Search nodes (--type, --name, --domain, --limit)
 *   ontology lookup <id>      Get node by id
 *   ontology related <id>     Related nodes (--relation, --depth, --limit)
 */

import { join } from "path";
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

  if (sub === "ontology") {
    const action = rest[0];
    if (!action || action.startsWith("--")) {
      console.error("❌ Usage: ronin kdb ontology <search|lookup|related> [args] [options]");
      process.exit(1);
    }
    await kdbOntology(action, rest.slice(1), options);
    return;
  }

  console.error(`❌ Unknown subcommand: ${sub}`);
  console.log("Usage: ronin kdb <stats|memory|ontology> ...");
  console.log("       ronin kdb stats");
  console.log("       ronin kdb memory search <query> [--limit N]");
  console.log("       ronin kdb memory recent [--limit N]");
  console.log("       ronin kdb memory get <key>");
  console.log("       ronin kdb ontology search [--type T] [--name pattern] [--domain D] [--limit N]");
  console.log("       ronin kdb ontology lookup <id>");
  console.log("       ronin kdb ontology related <id> [--relation R] [--depth N] [--limit N]");
  process.exit(1);
}

function getLimit(args: string[], defaultLimit: number): number {
  const i = args.indexOf("--limit");
  if (i !== -1 && i + 1 < args.length) {
    const n = parseInt(args[i + 1], 10);
    if (!Number.isNaN(n) && n > 0) return Math.min(n, 100);
  }
  return defaultLimit;
}

function getArg(name: string, args: string[]): string | undefined {
  const i = args.indexOf(name);
  if (i !== -1 && i + 1 < args.length) return args[i + 1];
  return undefined;
}

async function kdbStats(options: KdbOptions): Promise<void> {
  const api = await getApi(options);

  console.log("\n📊 Knowledge DB stats\n");

  // Memory: use db.query for counts (MemoryStore doesn't expose count)
  try {
    const memRows = await api.db.query<{ total: number }>(
      "SELECT COUNT(*) as total FROM memories"
    );
    const convRows = await api.db.query<{ total: number }>(
      "SELECT COUNT(*) as total FROM conversations"
    );
    const stateRows = await api.db.query<{ total: number }>(
      "SELECT COUNT(*) as total FROM agent_state"
    );
    const memories = memRows[0]?.total ?? 0;
    const conversations = convRows[0]?.total ?? 0;
    const agentStates = stateRows[0]?.total ?? 0;

    console.log("  Memory");
    console.log("    memories:      " + memories);
    console.log("    conversations: " + conversations);
    console.log("    agent_state:   " + agentStates);
    console.log("");
  } catch (e) {
    console.log("  Memory: (tables not found or error)");
    console.log("");
  }

  if (api.ontology) {
    try {
      const stats = await api.ontology.stats();
      console.log("  Ontology");
      const nodeTypes = Object.entries(stats.nodes).sort((a, b) => b[1] - a[1]);
      const totalNodes = nodeTypes.reduce((s, [, c]) => s + c, 0);
      console.log("    nodes: " + totalNodes);
      for (const [type, count] of nodeTypes) {
        console.log("      " + type + ": " + count);
      }
      const edgeTypes = Object.entries(stats.edges).sort((a, b) => b[1] - a[1]);
      const totalEdges = edgeTypes.reduce((s, [, c]) => s + c, 0);
      console.log("    edges: " + totalEdges);
      for (const [relation, count] of edgeTypes) {
        console.log("      " + relation + ": " + count);
      }
      console.log("");
    } catch (e) {
      console.log("  Ontology: (error) " + (e instanceof Error ? e.message : String(e)));
      console.log("");
    }
  } else {
    console.log("  Ontology: (plugin not loaded)");
    console.log("");
  }

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

async function kdbOntology(
  action: string,
  args: string[],
  options: KdbOptions
): Promise<void> {
  const api = await getApi(options);
  if (!api.ontology) {
    console.error("❌ Ontology plugin not loaded.");
    process.exit(1);
  }

  if (action === "search") {
    const type = getArg("--type", args);
    const name = getArg("--name", args);
    const domain = getArg("--domain", args);
    const limit = getLimit(args, 20);
    const nodes = await api.ontology.search({
      type: type ?? undefined,
      nameLike: name ?? undefined,
      domain: domain ?? undefined,
      limit,
    });
    console.log(formatJson(nodes));
    return;
  }

  if (action === "lookup") {
    const id = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
    if (!id) {
      console.error("❌ ronin kdb ontology lookup <id>");
      process.exit(1);
    }
    const node = await api.ontology.lookup(id);
    if (!node) {
      console.log("(not found)");
      return;
    }
    console.log(formatJson(node));
    return;
  }

  if (action === "related") {
    const id = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
    if (!id) {
      console.error("❌ ronin kdb ontology related <id> [--relation R] [--depth N] [--limit N]");
      process.exit(1);
    }
    const relation = getArg("--relation", args);
    const depth = getArg("--depth", args);
    const limit = getLimit(args, 10);
    const results = await api.ontology.related({
      nodeId: id,
      relation: relation ?? undefined,
      depth: depth ? parseInt(depth, 10) : undefined,
      limit,
    });
    console.log(formatJson(results));
    return;
  }

  console.error(`❌ Unknown ontology action: ${action}`);
  console.log("Usage: ronin kdb ontology <search|lookup|related> ...");
  process.exit(1);
}
