import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "os";

export interface AiCommandOptions {
  args: string[];
}

interface AiRegistry {
  version: 1;
  definitions: AiDefinition[];
}

interface AiDefinition {
  name: string;
  provider: "ollama";
  model: string;
  args?: string[];
  tags?: string[];
  description?: string;
  command?: string;
}

const DEFAULT_REGISTRY_PATH = join(homedir(), ".ronin", "ai-models.json");

export async function aiCommand(options: AiCommandOptions): Promise<void> {
  const args = options.args || [];
  const subcommand = args[0];

  if (!subcommand || subcommand.startsWith("--")) {
    printAiHelp();
    return;
  }

  switch (subcommand) {
    case "list":
      await listDefinitions(args.slice(1));
      break;
    case "add":
      await addDefinition(args.slice(1));
      break;
    case "remove":
      await removeDefinition(args.slice(1));
      break;
    case "show":
      await showDefinition(args.slice(1));
      break;
    case "run":
      await runDefinition(args.slice(1));
      break;
    case "help":
      printAiHelp();
      break;
    default:
      console.error(`❌ Unknown ai command: ${subcommand}`);
      printAiHelp();
  }
}

export async function ensureAiRegistry(path: string = DEFAULT_REGISTRY_PATH): Promise<void> {
  await loadRegistry(path);
}

function printAiHelp(): void {
  console.log(`
Ronin AI Definitions

Usage: ronin ai <command> [options]

Commands:
  list                List all AI definitions
  add <name>          Add an AI definition
  remove <name>       Remove an AI definition
  show <name>         Show a definition (JSON)
  run <name>          Run a definition (ollama run)
  help                Show this help message

Options:
  --file <path>       Registry file (default: ~/.ronin/ai-models.json)
  --provider <name>   Provider (default: ollama)
  --model <name>      Model name (required for add)
  --args "<args>"     Args for provider command (space or comma separated)
  --tags "a,b"        Comma-separated tags
  --description "..." Description for the definition
  --force             Overwrite existing definition

Examples:
  ronin ai list
  ronin ai add qwen3 --model qwen3:1.7b --description "Fast local model"
  ronin ai run qwen3
`);
}

async function listDefinitions(args: string[]): Promise<void> {
  const filePath = getArg("--file", args) || DEFAULT_REGISTRY_PATH;
  const registry = await loadRegistry(filePath);

  if (registry.definitions.length === 0) {
    console.log("No AI definitions found.");
    return;
  }

  console.log(`\n🧠 AI Definitions (${registry.definitions.length})\n`);

  for (const def of registry.definitions) {
    console.log(`• ${def.name}`);
    console.log(`  Provider: ${def.provider}`);
    console.log(`  Model: ${def.model}`);
    if (def.description) console.log(`  Description: ${def.description}`);
    if (def.tags && def.tags.length > 0) console.log(`  Tags: ${def.tags.join(", ")}`);
    console.log();
  }
}

async function addDefinition(args: string[]): Promise<void> {
  const name = args[0];
  if (!name || name.startsWith("--")) {
    console.error("❌ Name required. Usage: ronin ai add <name> --model <model>");
    return;
  }

  const filePath = getArg("--file", args) || DEFAULT_REGISTRY_PATH;
  const provider = (getArg("--provider", args) || "ollama") as "ollama";
  const model = getArg("--model", args);
  const description = getArg("--description", args);
  const argsValue = getArg("--args", args);
  const tagsValue = getArg("--tags", args);
  const force = args.includes("--force");

  if (!model) {
    console.error("❌ --model is required for add");
    return;
  }

  if (provider !== "ollama") {
    console.error(`❌ Unsupported provider: ${provider}`);
    return;
  }

  const registry = await loadRegistry(filePath);
  const existingIndex = registry.definitions.findIndex(def => def.name === name);
  if (existingIndex !== -1 && !force) {
    console.error(`❌ Definition already exists: ${name}`);
    console.log("💡 Use --force to overwrite");
    return;
  }

  const def: AiDefinition = {
    name,
    provider,
    model,
    description,
    args: parseArgsList(argsValue),
    tags: parseTags(tagsValue),
  };

  validateDefinition(def);

  if (existingIndex !== -1) {
    registry.definitions[existingIndex] = def;
  } else {
    registry.definitions.push(def);
  }

  await saveRegistry(filePath, registry);
  console.log(`✅ Saved AI definition: ${name}`);
}

async function removeDefinition(args: string[]): Promise<void> {
  const name = args[0];
  if (!name || name.startsWith("--")) {
    console.error("❌ Name required. Usage: ronin ai remove <name>");
    return;
  }

  const filePath = getArg("--file", args) || DEFAULT_REGISTRY_PATH;
  const registry = await loadRegistry(filePath);
  const nextDefs = registry.definitions.filter(def => def.name !== name);

  if (nextDefs.length === registry.definitions.length) {
    console.error(`❌ Definition not found: ${name}`);
    return;
  }

  await saveRegistry(filePath, { ...registry, definitions: nextDefs });
  console.log(`✅ Removed AI definition: ${name}`);
}

async function showDefinition(args: string[]): Promise<void> {
  const name = args[0];
  if (!name || name.startsWith("--")) {
    console.error("❌ Name required. Usage: ronin ai show <name>");
    return;
  }

  const filePath = getArg("--file", args) || DEFAULT_REGISTRY_PATH;
  const registry = await loadRegistry(filePath);
  const def = registry.definitions.find(item => item.name === name);

  if (!def) {
    console.error(`❌ Definition not found: ${name}`);
    return;
  }

  console.log(JSON.stringify(def, null, 2));
}

async function runDefinition(args: string[]): Promise<void> {
  const name = args[0];
  if (!name || name.startsWith("--")) {
    console.error("❌ Name required. Usage: ronin ai run <name>");
    return;
  }

  const [argsBefore, extraArgs] = splitArgs(args.slice(1), "--");
  const filePath = getArg("--file", argsBefore) || DEFAULT_REGISTRY_PATH;
  const registry = await loadRegistry(filePath);
  const def = registry.definitions.find(item => item.name === name);

  if (!def) {
    console.error(`❌ Definition not found: ${name}`);
    return;
  }

  if (def.provider !== "ollama") {
    console.error(`❌ Unsupported provider: ${def.provider}`);
    return;
  }

  const commandArgs = ["run", def.model, ...(def.args || []), ...extraArgs];
  const proc = Bun.spawn(["ollama", ...commandArgs], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  await proc.exited;
  if (proc.exitCode !== 0) {
    console.error(`❌ ollama exited with code ${proc.exitCode}`);
  }
}

async function loadRegistry(path: string): Promise<AiRegistry> {
  if (!existsSync(path)) {
    const registry = { version: 1, definitions: [] };
    await saveRegistry(path, registry);
    return registry;
  }

  const raw = await readFile(path, "utf-8");
  if (!raw.trim()) {
    const registry = { version: 1, definitions: [] };
    await saveRegistry(path, registry);
    return registry;
  }

  const data = JSON.parse(raw) as AiRegistry;
  if (!data || data.version !== 1 || !Array.isArray(data.definitions)) {
    throw new Error("Invalid AI registry file format");
  }

  return data;
}

async function saveRegistry(path: string, registry: AiRegistry): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(registry, null, 2));
}

function validateDefinition(def: AiDefinition): void {
  if (!def.name) throw new Error("Definition name is required");
  if (!def.model) throw new Error("Definition model is required");
  if (!def.provider) throw new Error("Definition provider is required");
}

function getArg(flag: string, args: string[]): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return undefined;
}

function parseArgsList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const cleaned = value.trim();
  if (!cleaned) return undefined;
  if (cleaned.includes(",")) {
    return cleaned.split(",").map(item => item.trim()).filter(Boolean);
  }
  return cleaned.split(/\s+/).filter(Boolean);
}

function parseTags(value?: string): string[] | undefined {
  if (!value) return undefined;
  const tags = value.split(",").map(tag => tag.trim()).filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function splitArgs(args: string[], delimiter: string): [string[], string[]] {
  const index = args.indexOf(delimiter);
  if (index === -1) return [args, []];
  return [args.slice(0, index), args.slice(index + 1)];
}
