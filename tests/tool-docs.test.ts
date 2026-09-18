import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DutyAPI } from "@ronin/types/index.js";
import { FilesAPI } from "@ronin/api/files.js";
import type { ToolDefinition } from "@ronin/tools/types.js";
import {
  groupPluginToolsByCategory,
  formatCategoryMarkdown,
  formatIndexMarkdown,
  buildCategorySummaries,
  generateAndWriteToolDocs,
  readCategoryDoc,
  readToolIndex,
  buildToolContext,
  loadToolContext,
  expandToolContextForCategory,
  toOpenAISchema,
} from "@ronin/tools/toolDocs.js";

// A fake handler is never invoked by anything under test here — only the
// schema/registration fields (name, description, parameters, provider) matter.
const noopHandler: ToolDefinition["handler"] = async () => ({ success: true, data: null });

function tool(name: string, provider: string, description = `does ${name}`, parameters: ToolDefinition["parameters"] = { type: "object", properties: {} }): ToolDefinition {
  return { name, description, parameters, provider, handler: noopHandler };
}

/** A realistic-scale mixed fixture: several plugin categories, local tools, an mcp server, and the dead-end categories. */
function realisticFixture(): ToolDefinition[] {
  return [
    tool("local.memory.search", "local", "Search memory"),
    tool("local.file.read", "local", "Read a file"),
    tool("local.tools.load_category", "local", "Load a tool category"),
    tool("filesystem_readFile", "mcp:filesystem", "Read a file via MCP"),
    // Duty-self-registered tools use a custom provider naming the duty
    // itself, NOT "local" and NOT "plugin:X" — e.g. the real
    // contracts.proposeReflex uses provider "contract-executor". These must
    // stay always-visible; see the regression test below.
    tool("contracts.proposeReflex", "contract-executor", "Draft a reflex automation"),
    tool("git_status", "plugin:git", "Get git status"),
    tool("git_diff", "plugin:git", "Get git diff", {
      type: "object",
      properties: { path: { type: "string", description: "file path" } },
      required: ["path"],
    }),
    tool("git_commit", "plugin:git", "Commit changes", {
      type: "object",
      properties: { message: { type: "string", description: "commit message" } },
      required: ["message"],
    }),
    tool("email_send", "plugin:email", "Send an email"),
    tool("email_list", "plugin:email", "List emails"),
    tool("discord_sendMessage", "plugin:discord", "Send a discord message (dead end — needs clientId)"),
    tool("telegram_sendMessage", "plugin:telegram", "Send a telegram message (dead end — needs botId)"),
  ];
}

describe("groupPluginToolsByCategory", () => {
  it("groups plugin-backed tools by category and excludes local/mcp tools", () => {
    const byCategory = groupPluginToolsByCategory(realisticFixture());
    expect([...byCategory.keys()].sort()).toEqual(["email", "git"]);
    expect(byCategory.get("git")!.map((t) => t.name).sort()).toEqual(["git_commit", "git_diff", "git_status"]);
    expect(byCategory.get("email")!.map((t) => t.name).sort()).toEqual(["email_list", "email_send"]);
  });

  it("excludes discord and telegram as dead-end categories", () => {
    const byCategory = groupPluginToolsByCategory(realisticFixture());
    expect(byCategory.has("discord")).toBe(false);
    expect(byCategory.has("telegram")).toBe(false);
  });

  it("returns an empty map when given only local/mcp tools", () => {
    const byCategory = groupPluginToolsByCategory([tool("local.x", "local"), tool("y", "mcp:server1")]);
    expect(byCategory.size).toBe(0);
  });
});

describe("formatCategoryMarkdown", () => {
  it("renders every tool with its real name, description, and parameters", () => {
    const md = formatCategoryMarkdown("git", groupPluginToolsByCategory(realisticFixture()).get("git")!);
    expect(md).toContain("# git tools");
    expect(md).toContain("3 tool(s) from the `git` plugin");
    expect(md).toContain("## `git_status`");
    expect(md).toContain("## `git_diff`");
    expect(md).toContain("- `path` (string, required) — file path");
    expect(md).toContain("_No parameters._"); // git_status has none
  });
});

describe("formatIndexMarkdown / buildCategorySummaries", () => {
  it("sorts categories alphabetically and lists sample tool names", () => {
    const byCategory = groupPluginToolsByCategory(realisticFixture());
    const summaries = buildCategorySummaries(byCategory);
    const md = formatIndexMarkdown(summaries);

    const emailLine = md.split("\n").findIndex((l) => l.includes("**email**"));
    const gitLine = md.split("\n").findIndex((l) => l.includes("**git**"));
    expect(emailLine).toBeGreaterThan(-1);
    expect(gitLine).toBeGreaterThan(emailLine); // alphabetical: email before git

    expect(md).toContain("- **git** (3): git_status, git_diff, git_commit");
    expect(md).toContain("local.tools.load_category");
    expect(md).not.toContain("discord");
    expect(md).not.toContain("telegram");
  });

  it("truncates the sample list and shows a +N more suffix past 6 tools", () => {
    const manyTools = Array.from({ length: 9 }, (_, i) => tool(`big_method${i}`, "plugin:big"));
    const summaries = buildCategorySummaries(groupPluginToolsByCategory(manyTools));
    const md = formatIndexMarkdown(summaries);
    expect(md).toContain("+3 more");
  });

  it("says so when there are no plugin categories at all", () => {
    expect(formatIndexMarkdown([])).toContain("No plugin tool categories available");
  });
});

describe("generateAndWriteToolDocs (real file I/O, temp dir)", () => {
  let scratchDir: string;

  afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  });

  it("writes one markdown file per category plus an index, readable back exactly", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-tool-docs-"));
    const files = new FilesAPI();
    const api = { files, tools: { list: () => realisticFixture() } } as unknown as DutyAPI;

    const summaries = await generateAndWriteToolDocs(api, scratchDir);

    expect(summaries.map((s) => s.category).sort()).toEqual(["email", "git"]);

    const gitDoc = await readCategoryDoc(api, "git", scratchDir);
    expect(gitDoc).toContain("## `git_commit`");
    expect(gitDoc).toContain("- `message` (string, required) — commit message");

    const index = await readToolIndex(api, scratchDir);
    expect(index).toContain("- **git** (3)");
    expect(index).toContain("- **email** (2)");
  });

  it("readToolIndex returns \"\" (not a throw) when docs were never generated", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-tool-docs-empty-"));
    const api = { files: new FilesAPI() } as unknown as DutyAPI;
    expect(await readToolIndex(api, scratchDir)).toBe("");
  });

  it("readCategoryDoc throws for an unknown category (caller decides how to handle it)", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-tool-docs-missing-"));
    const files = new FilesAPI();
    const api = { files, tools: { list: () => realisticFixture() } } as unknown as DutyAPI;
    await generateAndWriteToolDocs(api, scratchDir);

    await expect(readCategoryDoc(api, "nonexistent", scratchDir)).rejects.toThrow();
  });
});

describe("buildToolContext — what chat actually sees at the start of a turn", () => {
  it("local/mcp/duty-registered tools are visible up front; only bulk plugin tools are deferred", () => {
    const context = buildToolContext(realisticFixture(), "# Tool categories\n\n(index text)\n");

    const visibleNames = context.schemas.map((s) => s.function.name).sort();
    expect(visibleNames).toEqual([
      "contracts.proposeReflex",
      "filesystem_readFile",
      "local.file.read",
      "local.memory.search",
      "local.tools.load_category",
    ]);

    // Plugin tools exist in byCategory (ready to be loaded) but are NOT in schemas yet.
    expect(context.byCategory.get("git")!.length).toBe(3);
    expect(context.schemas.some((s) => s.function.name === "git_status")).toBe(false);

    expect(context.categoryIndexText).toBe("# Tool categories\n\n(index text)\n");
    expect(context.loadedCategories.size).toBe(0);
  });

  it("REGRESSION: duty-self-registered tools (custom provider, e.g. 'contract-executor') must stay visible", () => {
    // These are some of the most important chat-creation tools in the system
    // (contracts.proposeReflex, duties.proposeDuty, schedule.writeSchedule).
    // A provider filter that only recognized "local"/"mcp:*" would have made
    // all of them unreachable — this pins the fix.
    const context = buildToolContext(
      [
        tool("contracts.proposeReflex", "contract-executor"),
        tool("duties.proposeDuty", "duty-executor"),
        tool("schedule.writeSchedule", "schedule-manager"),
      ],
      ""
    );
    expect(context.schemas.map((s) => s.function.name).sort()).toEqual([
      "contracts.proposeReflex",
      "duties.proposeDuty",
      "schedule.writeSchedule",
    ]);
  });
});

describe("expandToolContextForCategory — what happens after local.tools.load_category is called", () => {
  it("adds the category's real tools to schemas", () => {
    const context = buildToolContext(realisticFixture(), "");
    const before = context.schemas.length;

    const added = expandToolContextForCategory(context, "git");

    expect(added).toBe(true);
    expect(context.schemas.length).toBe(before + 3);
    expect(context.schemas.map((s) => s.function.name)).toEqual(
      expect.arrayContaining(["git_status", "git_diff", "git_commit"])
    );
    expect(context.loadedCategories.has("git")).toBe(true);
  });

  it("loading the same category twice does not duplicate schemas", () => {
    const context = buildToolContext(realisticFixture(), "");
    expandToolContextForCategory(context, "git");
    const afterFirst = context.schemas.length;

    const addedSecondTime = expandToolContextForCategory(context, "git");

    expect(addedSecondTime).toBe(false);
    expect(context.schemas.length).toBe(afterFirst);
  });

  it("is a safe no-op for an unknown category", () => {
    const context = buildToolContext(realisticFixture(), "");
    const before = context.schemas.length;

    const added = expandToolContextForCategory(context, "nonexistent-plugin");

    expect(added).toBe(false);
    expect(context.schemas.length).toBe(before);
  });

  it("loading two different categories accumulates both", () => {
    const context = buildToolContext(realisticFixture(), "");
    expandToolContextForCategory(context, "git");
    expandToolContextForCategory(context, "email");

    const names = context.schemas.map((s) => s.function.name);
    expect(names).toEqual(
      expect.arrayContaining(["git_status", "git_diff", "git_commit", "email_send", "email_list"])
    );
  });
});

describe("loadToolContext — the full assembled context, end to end (real files, real tool list)", () => {
  let scratchDir: string;

  afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  });

  it("shows exactly what a chat turn would see: system-prompt-ready index text and the initial tool list", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-tool-context-"));
    const files = new FilesAPI();
    const api = { files, tools: { list: () => realisticFixture() } } as unknown as DutyAPI;

    // Boot-time step: generate the docs a real chat turn would read.
    await generateAndWriteToolDocs(api, scratchDir);

    // Chat-turn step: assemble the context exactly as duties/chatty.ts does.
    const context = await loadToolContext(api, scratchDir);

    // --- This is the actual assembled context, printed for inspection ---
    console.log("\n=== Category index text (appended to the system prompt) ===\n");
    console.log(context.categoryIndexText);
    console.log("=== Tool schemas visible to the model at turn start ===\n");
    console.log(JSON.stringify(context.schemas, null, 2));
    console.log(`\n(${context.schemas.length} visible now; ${[...context.byCategory.values()].flat().length} more behind ${context.byCategory.size} categories)\n`);

    expect(context.categoryIndexText).toContain("# Tool categories");
    expect(context.schemas.map((s) => s.function.name).sort()).toEqual([
      "contracts.proposeReflex",
      "filesystem_readFile",
      "local.file.read",
      "local.memory.search",
      "local.tools.load_category",
    ]);

    // Now simulate the model calling local.tools.load_category("git") mid-turn.
    const category = "git";
    const docs = await readCategoryDoc(api, category, scratchDir);
    expandToolContextForCategory(context, category);

    console.log(`=== After the model calls local.tools.load_category("${category}") ===\n`);
    console.log("Docs returned to the model as the tool result:\n");
    console.log(docs);
    console.log("Tool schemas visible on the NEXT callTools round:\n");
    console.log(JSON.stringify(context.schemas.filter((s) => s.function.name.startsWith("git")), null, 2));

    expect(docs).toContain("## `git_status`");
    expect(context.schemas.some((s) => s.function.name === "git_status")).toBe(true);
  });
});

describe("toOpenAISchema", () => {
  it("maps a ToolDefinition to the exact {type, function} shape callTools expects", () => {
    const t = tool("git_status", "plugin:git", "Get git status", { type: "object", properties: {} });
    expect(toOpenAISchema(t)).toEqual({
      type: "function",
      function: { name: "git_status", description: "Get git status", parameters: { type: "object", properties: {} } },
    });
  });
});
