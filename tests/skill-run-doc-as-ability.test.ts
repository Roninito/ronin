import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DutyAPI } from "../src/types/index.js";
import type { ToolContext, ToolDefinition } from "../src/tools/types.js";
import { registerLocalTools } from "../src/tools/providers/LocalTools.js";
import { FilesAPI } from "../src/api/files.js";
import skillsPlugin from "../plugins/skills.js";

const dummyContext: ToolContext = { conversationId: "test", timestamp: Date.now() };

// Regression for the Telegram failure on 2026-09-17 where `skills.run("obsidian-cli")`
// returned "Skill \"obsidian-cli\" has no abilities" — the AI correctly chose the skill
// but the skill itself (kepano's obsidian-cli) has no `## Abilities` section: it's pure
// documentation that the AI should read and then execute the documented shell command.
// The fix is to return the skill body as the result with a hint, instead of erroring.
function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "ronin-skills-run-"));
  // Lay out the fake skill under <dataDir>/skills/doc-as-ability/SKILL.md so the real
  // skills plugin discovery (which reads from config.skillsDir) can find it.
  const skillsRoot = join(dataDir, "skills");
  require("fs").mkdirSync(join(skillsRoot, "doc-as-ability"), { recursive: true });
  require("fs").writeFileSync(
    join(skillsRoot, "doc-as-ability", "SKILL.md"),
    [
      "---",
      "name: doc-as-ability",
      "description: A doc-only skill with no ## Abilities section.",
      "---",
      "",
      "# Doc as ability",
      "",
      "Run `my-cli do-thing --foo=bar` to do the thing.",
      "",
    ].join("\n")
  );

  const tools = new Map<string, ToolDefinition>();
  const register = (tool: ToolDefinition) => tools.set(tool.name, tool);

  const api = {
    files: new FilesAPI(),
    config: {
      getSystem: () => ({ dataDir, skillsDir: skillsRoot }),
      getAll: () => ({ desktop: { features: { screenCapture: false } } }),
      getNotifications: () => ({ preferredChat: "auto" }),
      get: (path: string) => {
        if (path === "memory.vaultPath") return undefined;
        return undefined;
      },
    },
    plugins: {
      has: () => false,
      call: async (_pluginName: string, method: string, ...args: unknown[]) => {
        return skillsPlugin.methods[method as keyof typeof skillsPlugin.methods](
          ...(args as unknown[])
        );
      },
    },
    skills: {
      use_skill: async () => ({ success: true, output: {}, logs: [] }),
    },
    ai: {
      complete: async () =>
        JSON.stringify({
          skillName: "doc-as-ability",
          ability: "nonexistent",
          params: {},
        }),
    },
  } as unknown as DutyAPI;

  registerLocalTools(api, register);
  return { tools, dataDir, api, skillsRoot };
}

describe("skills.run — doc-as-ability fallback", () => {
  it("returns the skill instructions instead of erroring when a skill has no structured abilities (AI-pick branch)", async () => {
    const { tools, dataDir, api } = setup();
    (skillsPlugin.methods.setAPI as (a: unknown) => void)(api);

    try {
      const run = tools.get("skills.run")!;
      expect(run).toBeDefined();

      const result = await run.handler(
        { query: "doc-as-ability", action: "do the thing" } as never,
        dummyContext
      );

      if (!result.success) {
        throw new Error(`unexpected failure: ${(result as { error?: string }).error}`);
      }
      expect(result.success).toBe(true);
      expect(result.data).toBeTruthy();
      const data = result.data as { noAbilities?: boolean; instructions?: string; skillName?: string };
      expect(data.noAbilities).toBe(true);
      expect(data.skillName).toBe("doc-as-ability");
      expect(data.instructions).toContain("my-cli do-thing --foo=bar");
    } finally {
      (skillsPlugin.methods.setAPI as (a: null) => void)(null);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("returns the skill instructions in the fallback discover-by-query branch too", async () => {
    const { tools, dataDir, api } = setup();
    (skillsPlugin.methods.setAPI as (a: unknown) => void)(api);

    // Override ai.complete to return empty — forces the fallback discover_skills branch
    api.ai.complete = async () => "";

    try {
      const run = tools.get("skills.run")!;
      const result = await run.handler(
        { query: "doc-as-ability", action: "do the thing" } as never,
        dummyContext
      );

      if (!result.success) {
        throw new Error(`unexpected failure: ${(result as { error?: string }).error}`);
      }
      expect(result.success).toBe(true);
      const data = result.data as { noAbilities?: boolean; instructions?: string };
      expect(data.noAbilities).toBe(true);
      expect(data.instructions).toContain("my-cli do-thing");
    } finally {
      (skillsPlugin.methods.setAPI as (a: null) => void)(null);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // Regression for the 2026-09-17 Telegram failure: "show me the contents of the state
  // of ronin file" went to skills.run, AI selection came back empty twice, and the user
  // got no answer. The guard at the top of skills.run now rejects obvious built-in tool
  // requests with a hint pointing at local.file.read before the AI ever gets called.
  it("rejects built-in tool requests before invoking the AI selection", async () => {
    const { tools, dataDir, api } = setup();
    (skillsPlugin.methods.setAPI as (a: unknown) => void)(api);

    try {
      const run = tools.get("skills.run")!;
      const result = await run.handler(
        { query: "show me the contents of the state of ronin file", action: "show contents" } as never,
        dummyContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("local.file.read");
    } finally {
      (skillsPlugin.methods.setAPI as (a: null) => void)(null);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects 'list files in folder' style requests", async () => {
    const { tools, dataDir, api } = setup();
    (skillsPlugin.methods.setAPI as (a: unknown) => void)(api);

    try {
      const run = tools.get("skills.run")!;
      const result = await run.handler(
        { query: "list files in /Users/me/notes", action: "list files in /Users/me/notes" } as never,
        dummyContext
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("local.file");
    } finally {
      (skillsPlugin.methods.setAPI as (a: null) => void)(null);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
