/**
 * Per-category tool documentation.
 *
 * Chat cannot be handed all ~200+ registered tool schemas on every turn — that's
 * 8-20k tokens of pure schema overhead before a single word of conversation, and
 * chatty.ts bypasses the tokenGuard middleware entirely. Instead, plugin-backed
 * tools are grouped by category (one category = one plugin, matching `provider:
 * "plugin:<name>"` on ToolDefinition) and written out as real markdown files a
 * model can read on demand via the `local.tools.load_category` tool — the same
 * "discover, then use" shape Skills already use, generalized to plugin tools.
 *
 * `local.*`, `mcp:*`, and duty-self-registered tools (e.g.
 * `contracts.proposeReflex`) are deliberately NOT gated behind this — they're
 * few (~35-40 total combined) and meant to always be visible; only the
 * auto-wrapped bulk plugin surface (the ~186-tool part) needed lazy loading.
 */

import * as path from "path";
import type { DutyAPI } from "../types/index.js";
import type { ToolDefinition, OpenAIFunctionSchema } from "./types.js";

// Relative to the memory root (`<vault>/memory`), NOT to the vault itself.
// When createAPI resolves this against `memoryDir`, it lands at
// `<vault>/memory/notes/tools/` — sibling of `conversations/` and `blackboards/`,
// which is where MemoryStore writes notes via the obsidian plugin.
export const TOOL_DOCS_DIR = "notes/tools";
export const TOOL_DOCS_INDEX_PATH = `${TOOL_DOCS_DIR}/index.md`;

/**
 * Resolve a baseDir against the API's memory root when it's the relative
 * sentinel `TOOL_DOCS_DIR`. Callers should pass the result of this helper to
 * any toolDocs function that takes a `baseDir` parameter — that way reads and
 * writes of the tool-doc files always target the same vault the messenger is
 * reading from, regardless of cwd. Tests can still pass an absolute path to
 * override (it's used verbatim if it's already absolute).
 */
export function resolveToolDocsBaseDir(api: { memory?: { getRootDir?: () => string } }, baseDir: string = TOOL_DOCS_DIR): string {
  if (path.isAbsolute(baseDir)) return baseDir;
  const root = api.memory?.getRootDir?.();
  if (!root) return baseDir; // fall back to CWD-relative; better than throwing
  return path.join(root, baseDir);
}

export interface ToolCategorySummary {
  category: string;
  toolCount: number;
  /** First few method names, for a quick-scan index line. */
  sample: string[];
}

const PLUGIN_PROVIDER_PREFIX = "plugin:";

/**
 * Categories deliberately excluded from loading: the raw plugin methods here
 * (discord_sendMessage, telegram_sendMessage, etc.) require a manually-managed
 * clientId/botId obtained by calling an `init*` method — which is itself never
 * offered (see `isPluginMethodSkipped` in src/api/index.ts, which skips
 * `init*`/`set*`/`remove*`). They're a dead end for a model with no way to get
 * that id. `local.discord.*`/`local.telegram.*` in LocalTools.ts cover the same
 * ground with auto-init from config and are always visible (provider: "local")
 * — no loss from excluding the raw plugin category here.
 */
const DEAD_END_CATEGORIES = new Set(["discord", "telegram"]);

function categoryFromProvider(provider: string): string | null {
  if (!provider.startsWith(PLUGIN_PROVIDER_PREFIX)) return null;
  const category = provider.slice(PLUGIN_PROVIDER_PREFIX.length);
  return DEAD_END_CATEGORIES.has(category) ? null : category;
}

/** Group plugin-backed tools by category (plugin name). Excludes local/mcp tools. */
export function groupPluginToolsByCategory(tools: ToolDefinition[]): Map<string, ToolDefinition[]> {
  const byCategory = new Map<string, ToolDefinition[]>();
  for (const tool of tools) {
    const category = categoryFromProvider(tool.provider);
    if (!category) continue;
    const list = byCategory.get(category) ?? [];
    list.push(tool);
    byCategory.set(category, list);
  }
  return byCategory;
}

function formatParameters(schema: ToolDefinition["parameters"]): string {
  const props = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  const keys = Object.keys(props);
  if (keys.length === 0) return "_No parameters._";

  return keys
    .map((key) => {
      const p = props[key]!;
      const req = required.has(key) ? ", required" : "";
      const desc = p.description ? ` — ${p.description}` : "";
      return `- \`${key}\` (${p.type}${req})${desc}`;
    })
    .join("\n");
}

/** Full markdown doc for one category (plugin), listing every tool with its real signature. */
export function formatCategoryMarkdown(category: string, tools: ToolDefinition[]): string {
  const sections = tools
    .map((t) => `## \`${t.name}\`\n\n${t.description}\n\n**Parameters:**\n${formatParameters(t.parameters)}`)
    .join("\n\n---\n\n");

  return `# ${category} tools\n\n${tools.length} tool(s) from the \`${category}\` plugin. Call any of these directly by name — they're already registered.\n\n---\n\n${sections}\n`;
}

/** Compact index: one line per category, meant to be injected into chat context directly. */
export function formatIndexMarkdown(summaries: ToolCategorySummary[]): string {
  if (summaries.length === 0) return "# Tool categories\n\nNo plugin tool categories available.\n";

  const lines = summaries
    .sort((a, b) => a.category.localeCompare(b.category))
    .map((s) => {
      const sample = s.sample.join(", ");
      const more = s.toolCount > s.sample.length ? `, +${s.toolCount - s.sample.length} more` : "";
      return `- **${s.category}** (${s.toolCount}): ${sample}${more}`;
    });

  return [
    "# Tool categories",
    "",
    "Each category below is a plugin with real tools you can call, but their full",
    "signatures aren't loaded yet. Call `local.tools.load_category` with the",
    "category name to get exact tool names, descriptions, and parameters before",
    "calling anything in that category.",
    "",
    ...lines,
    "",
  ].join("\n");
}

export function buildCategorySummaries(byCategory: Map<string, ToolDefinition[]>): ToolCategorySummary[] {
  const summaries: ToolCategorySummary[] = [];
  for (const [category, tools] of byCategory) {
    summaries.push({
      category,
      toolCount: tools.length,
      sample: tools.slice(0, 6).map((t) => t.name),
    });
  }
  return summaries;
}

/**
 * Generate and write one markdown file per plugin category plus a top-level
 * index, from whatever is actually registered in the tool router right now.
 * Called once at boot (src/api/index.ts) and periodically by
 * duties/tools-indexer.ts as a refresh safety net.
 *
 * `baseDir` should be an ABSOLUTE path. The default value `TOOL_DOCS_DIR`
 * (`"memory/notes/tools"`) is a CWD-relative sentinel — the boot path in
 * createAPI now resolves it against the active memory root before passing
 * it in, so the docs land in the same vault the messenger reads from
 * (the original default of "CWD-relative" silently wrote into the project
 * repo, leaving the vault empty until something manually copied them over).
 * Tests can pass any temp directory — absolute or relative, it's used verbatim.
 */
export async function generateAndWriteToolDocs(
  api: DutyAPI,
  baseDir: string = TOOL_DOCS_DIR
): Promise<ToolCategorySummary[]> {
  const tools = api.tools.list();
  const byCategory = groupPluginToolsByCategory(tools);

  await api.files.ensureDir(baseDir);

  for (const [category, categoryTools] of byCategory) {
    await api.files.write(`${baseDir}/${category}.md`, formatCategoryMarkdown(category, categoryTools));
  }

  const summaries = buildCategorySummaries(byCategory);
  await api.files.write(`${baseDir}/index.md`, formatIndexMarkdown(summaries));

  return summaries;
}

/** Read one category's doc file. Throws if it doesn't exist — callers decide how to handle that. */
export async function readCategoryDoc(
  api: DutyAPI,
  category: string,
  baseDir?: string
): Promise<string> {
  const resolved = resolveToolDocsBaseDir(api, baseDir ?? TOOL_DOCS_DIR);
  return api.files.read(`${resolved}/${category}.md`);
}

/** Read the top-level category index. Returns "" if it hasn't been generated yet (e.g. skipPlugins mode). */
export async function readToolIndex(api: DutyAPI, baseDir?: string): Promise<string> {
  const resolved = resolveToolDocsBaseDir(api, baseDir ?? TOOL_DOCS_DIR);
  try {
    return await api.files.read(`${resolved}/index.md`);
  } catch {
    return "";
  }
}

// ── Chat tool context ───────────────────────────────────────────────────
//
// The pure logic behind duties/chatty.ts's tool-calling loop: which schemas
// are visible up front, and how a `local.tools.load_category` call expands
// that set. Pulled out here (rather than left inline in chatty.ts) so it's
// unit-testable independent of chat's HTTP/session machinery.

export interface ToolContext {
  /** Schemas currently visible to the model. Grows as categories are loaded. */
  schemas: OpenAIFunctionSchema[];
  /** Compact category index text — inject into the system prompt as-is (may be ""). */
  categoryIndexText: string;
  /** Every plugin tool, grouped by category, for expandToolContextForCategory to draw from. */
  byCategory: Map<string, ToolDefinition[]>;
  /** Categories already expanded into `schemas`, to make repeated loads a no-op. */
  loadedCategories: Set<string>;
}

export function toOpenAISchema(t: ToolDefinition): OpenAIFunctionSchema {
  return {
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

/**
 * Build the initial tool context for one chat turn: everything EXCEPT the
 * bulk auto-wrapped plugin surface (`provider: "plugin:<name>"`, ~186 tools)
 * is visible immediately, that alone is deferred behind categories.
 *
 * This is deliberately not "only local/mcp" — several duties self-register
 * their own tools directly (`api.tools.register(...)`) with a custom
 * provider naming the duty itself: `contracts.proposeReflex` (provider
 * "contract-executor"), `duties.proposeDuty` (provider "duty-executor"),
 * `schedule.writeSchedule` (provider "schedule-manager"), plus
 * skill-maker/workflow-manager/refactory's own tools. These are hand-written,
 * few (~15-20 total across all of them), and often exactly the tool a chat
 * message is trying to reach (creating a contract/duty/schedule) — nothing
 * like the ~186-tool bulk plugin surface that actually needed gating. They
 * stay always-visible alongside `local.*` and `mcp:*`.
 *
 * Pure — pass in whatever `categoryIndexText` you already read (or "").
 */
export function buildToolContext(allTools: ToolDefinition[], categoryIndexText: string): ToolContext {
  const alwaysVisible = allTools.filter((t) => !t.provider.startsWith(PLUGIN_PROVIDER_PREFIX));
  return {
    schemas: alwaysVisible.map(toOpenAISchema),
    categoryIndexText,
    byCategory: groupPluginToolsByCategory(allTools),
    loadedCategories: new Set(),
  };
}

/** Convenience wrapper: reads the live tool registry + index file and builds a ToolContext in one call. */
export async function loadToolContext(api: DutyAPI, baseDir?: string): Promise<ToolContext> {
  const [allTools, categoryIndexText] = await Promise.all([
    Promise.resolve(api.tools.list()),
    readToolIndex(api, baseDir),
  ]);
  return buildToolContext(allTools, categoryIndexText);
}

/**
 * Expand `context.schemas` in place with one category's real tools.
 * Returns true if it actually added anything new (false for an unknown
 * category, or a category already loaded this turn — safe to call either way).
 */
export function expandToolContextForCategory(context: ToolContext, category: string): boolean {
  if (context.loadedCategories.has(category)) return false;
  context.loadedCategories.add(category);

  const categoryTools = context.byCategory.get(category) ?? [];
  if (categoryTools.length === 0) return false;

  const existingNames = new Set(context.schemas.map((s) => s.function.name));
  let added = false;
  for (const t of categoryTools) {
    if (!existingNames.has(t.name)) {
      context.schemas.push(toOpenAISchema(t));
      added = true;
    }
  }
  return added;
}
