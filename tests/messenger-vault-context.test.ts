import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { buildVaultContext } from "../duties/messenger.js";

// Regression for the 2026-09-17 Telegram failure: a user asked "show me the
// contents of the state of ronin file" and the messenger wandered — called
// skills.run (empty AI response), local.shell.safe to fish around the cwd,
// and never once targeted the active vault. The fix is `buildVaultContext` in
// duties/messenger.ts:1, which surfaces the vault root, the configured vaults,
// and a priority-sorted list of already-indexed vault note keys. Tests here
// pin the contract — the model should be able to read STATE_OF_RONIN.md from
// the prompt alone, without any tool call.

describe("buildVaultContext", () => {
  let dataDir: string;
  let vaultRoot: string;
  let memoryDir: string;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), "ronin-vault-ctx-"));
    vaultRoot = join(dataDir, "Documents", "Obsidian", "RoninAIData");
    memoryDir = join(vaultRoot, "memory");
    const notesDir = join(memoryDir, "notes");
    mkdirSync(notesDir, { recursive: true });

    // Lay out a representative set of indexed notes — STATE_OF_RONIN.md should
    // sort to the top because of the priority helper.
    const indexedNames = [
      "obsidian-ronin-ai-data-state-of-ronin-md-a7779f0c.md",
      "obsidian-ronin-ai-data-copilot-some-conversation-1234abcd.md",
      "obsidian-ronin-ai-data-copilot-another-conversation-5678efgh.md",
      "tool-cache-local-memory-search-query-obsidian-5eb7654c.md",
      "refdoc-local-file-tools.md",
    ];
    for (const name of indexedNames) {
      writeFileSync(join(notesDir, name), "# placeholder\n");
    }
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function mockApi(opts: {
    vaultPath?: string;
    obsidianVaults?: Array<{ id: string; path: string; enabled?: boolean; allowedFolders?: string[] }>;
    listResult?: string[];
    pluginsHas?: boolean;
    pluginCallFails?: boolean;
    /** map from note filename (without .md) → JSON body for the indexed note */
    noteBodies?: Record<string, string>;
  }) {
    const notesDir = `${opts.vaultPath ?? memoryDir}/notes`;
    return {
      config: {
        get: (p: string) => {
          if (p === "memory.vaultPath") return opts.vaultPath ?? memoryDir;
          if (p === "obsidian") return { vaults: opts.obsidianVaults ?? [] };
          return undefined;
        },
      },
      files: {
        list: async (dir: string) => {
          if (dir === notesDir && opts.listResult) return opts.listResult;
          return [];
        },
        read: async (path: string) => {
          const fname = path.split("/").pop() ?? "";
          const stem = fname.replace(/\.md$/, "");
          return opts.noteBodies?.[stem] ?? "# empty\n";
        },
      },
      plugins: {
        has: (_name: string) => opts.pluginsHas !== false,
        call: async (_plugin: string, _method: string, ..._args: unknown[]) => {
          if (opts.pluginCallFails) throw new Error("obsidian plugin unavailable");
          return (opts.obsidianVaults ?? []).map((v) => ({
            id: v.id,
            path: v.path,
            allowedFolders: v.allowedFolders ?? [],
          }));
        },
      },
    } as never;
  }

  it("surfaces the vault root when memory.vaultPath is set", async () => {
    const api = mockApi({
      vaultPath: memoryDir,
      obsidianVaults: [{ id: "ronin-ai-data", path: vaultRoot, enabled: true, allowedFolders: ["memory"] }],
      listResult: [],
    });
    const ctx = await buildVaultContext(api);
    expect(ctx).toContain(vaultRoot);
    expect(ctx).toContain(memoryDir);
  });

  it("surfaces STATE_OF_RONIN.md as the highest-priority indexed note", async () => {
    const api = mockApi({
      vaultPath: memoryDir,
      obsidianVaults: [{ id: "ronin-ai-data", path: vaultRoot, enabled: true, allowedFolders: ["memory"] }],
      listResult: [
        "obsidian-ronin-ai-data-state-of-ronin-md-a7779f0c.md",
        "obsidian-ronin-ai-data-copilot-conversation-aaaaaaaa.md",
        "obsidian-ronin-ai-data-copilot-conversation-bbbbbbbb.md",
        "refdoc-local-file-tools.md",
      ],
    });
    const ctx = await buildVaultContext(api);
    expect(ctx).toContain("obsidian-ronin-ai-data-state-of-ronin-md-a7779f0c");
    // STATE_OF_RONIN should appear before the copilot conversation keys —
    // the priority sort puts README/state files first.
    const stateIdx = ctx.indexOf("state-of-ronin");
    const convIdx = ctx.indexOf("copilot-conversation-aaaaaaaa");
    expect(stateIdx).toBeGreaterThan(-1);
    expect(convIdx).toBeGreaterThan(-1);
    expect(stateIdx).toBeLessThan(convIdx);
  });

  it("falls back gracefully when no vault is configured", async () => {
    const api = {
      config: {
        get: (p: string) => {
          if (p === "memory.vaultPath") return undefined;
          if (p === "obsidian") return { vaults: [] };
          return undefined;
        },
      },
      files: { list: async () => [] },
      plugins: { has: () => false, call: async () => [] },
    } as never;
    const ctx = await buildVaultContext(api);
    expect(ctx).toContain("memory.vaultPath is not configured");
  });

  it("skips plugin call gracefully when obsidian plugin is unavailable", async () => {
    // The plugin may not be loaded in test mode — we shouldn't crash the
    // prompt build just because obsidian isn't registered.
    const api = mockApi({
      vaultPath: memoryDir,
      obsidianVaults: [],
      pluginsHas: false,
      listResult: [],
    });
    const ctx = await buildVaultContext(api);
    expect(ctx).toContain(vaultRoot);
    expect(ctx).not.toContain("undefined");
  });

  it("includes routing rules for vault file lookups", async () => {
    const api = mockApi({
      vaultPath: memoryDir,
      obsidianVaults: [{ id: "ronin-ai-data", path: vaultRoot, enabled: true, allowedFolders: ["memory"] }],
      listResult: [],
    });
    const ctx = await buildVaultContext(api);
    // The rules must explicitly tell the model how to handle vault file requests
    // — that's the whole point of this block.
    expect(ctx).toMatch(/local\.memory\.search.*obsidian-/);
    expect(ctx).toContain("obsidian_readNote");
    expect(ctx).toContain("local.shell.safe");
    // Specifically warn against shell-out, since that was the failure mode.
    expect(ctx).toMatch(/never.*local\.shell\.safe|do not.*local\.shell\.safe/i);
  });

  it("surfaces vault paths from config when plugin is configured", async () => {
    const api = mockApi({
      vaultPath: memoryDir,
      obsidianVaults: [
        { id: "ronin-ai-data", path: vaultRoot, enabled: true, allowedFolders: ["memory", "copilot"] },
        { id: "legacy", path: "/old/vault", enabled: false, allowedFolders: [] },
      ],
      listResult: [],
    });
    const ctx = await buildVaultContext(api);
    expect(ctx).toContain("ronin-ai-data");
    expect(ctx).toContain(vaultRoot);
    expect(ctx).toContain("/old/vault");
  });

  it("limits the surfaced key list to avoid flooding the prompt", async () => {
    // 100 indexed notes — only the top 25 should appear in the prompt, with a
    // marker for the rest. Otherwise small models lose context budget.
    const many = Array.from({ length: 100 }, (_, i) => `obsidian-ronin-ai-data-fake-note-${String(i).padStart(4, "0")}.md`);
    const api = mockApi({
      vaultPath: memoryDir,
      obsidianVaults: [{ id: "ronin-ai-data", path: vaultRoot, enabled: true, allowedFolders: ["memory"] }],
      listResult: many,
    });
    const ctx = await buildVaultContext(api);
    // 25 surfaced, rest summarized as "+75 more"
    expect(ctx).toContain("+75 more");
    // The fake notes ARE mentioned (just with a cap)
    expect(ctx).toContain("obsidian-ronin-ai-data-fake-note-0000");
  });

  // Regression for the 2026-09-17 Telegram failure: "What does the welcome
  // file in the vault say" — the model searched memory with the wrong key
  // (the slug uses `-` separators, but the user said "welcome"), got 0 hits,
  // then tried skills.run twice (rejected by the built-in guard), then
  // finally local.file.read with a path it had to find by another search.
  // The fix is to surface each top-priority note's absolute file_path inline
  // so the model can do a one-shot local.file.read({ path }) without any
  // search round trip.
  it("surfaces the absolute file_path for top-priority indexed notes", async () => {
    const welcomeBody = `---
key: "obsidian-ronin-ai-data-Welcome.md"
kind: "kv"
---

\`\`\`json
{
  "source_agent": "obsidian-vault-indexer",
  "vault_id": "ronin-ai-data",
  "file_path": "/Users/ronin/Documents/Obsidian/RoninAIData/Welcome.md",
  "relative_path": "Welcome.md",
  "title": "Welcome",
  "tags": []
}
\`\`\`
`;
    const api = mockApi({
      vaultPath: memoryDir,
      obsidianVaults: [{ id: "ronin-ai-data", path: vaultRoot, enabled: true, allowedFolders: ["memory"] }],
      listResult: ["obsidian-ronin-ai-data-welcome-md-91dcf8a9.md"],
      noteBodies: {
        "obsidian-ronin-ai-data-welcome-md-91dcf8a9": welcomeBody,
      },
    });
    const ctx = await buildVaultContext(api);
    // The absolute path must be inline so the model can read it without a search.
    expect(ctx).toContain("/Users/ronin/Documents/Obsidian/RoninAIData/Welcome.md");
    // The hint should name local.file.read as a direct path, not just memory.search.
    expect(ctx).toMatch(/local\.file\.read\(\{ path:/);
  });

  it("falls back to key-only entry when the note body can't be parsed", async () => {
    // If the JSON fence is missing/malformed, surface the key + memory.search
    // hint so the model at least has a fallback.
    const api = mockApi({
      vaultPath: memoryDir,
      obsidianVaults: [{ id: "ronin-ai-data", path: vaultRoot, enabled: true, allowedFolders: ["memory"] }],
      listResult: ["obsidian-ronin-ai-data-broken-md-aaaaaaaa.md"],
      noteBodies: { "obsidian-ronin-ai-data-broken-md-aaaaaaaa": "no json fence here\n" },
    });
    const ctx = await buildVaultContext(api);
    // Key still appears; memory.search hint is the fallback.
    expect(ctx).toContain("obsidian-ronin-ai-data-broken-md-aaaaaaaa");
    // The "Indexed vault notes" section is the only place an inline file_path
    // can appear; the routing rules legitimately mention local.file.read but
    // without a real absolute path. So check just the notes block.
    const notesBlock = ctx.split("ROUTING RULES FOR VAULT FILES:")[0] ?? "";
    expect(notesBlock).toContain("local.memory.search");
    expect(notesBlock).not.toContain("local.file.read({ path:");
  });

  it("includes the explicit anti-skills.run guardrail in routing rules", async () => {
    // The user's failure today was the model trying skills.run for file
    // requests. The routing rules must warn against that explicitly.
    const api = mockApi({
      vaultPath: memoryDir,
      obsidianVaults: [{ id: "ronin-ai-data", path: vaultRoot, enabled: true, allowedFolders: ["memory"] }],
      listResult: [],
    });
    const ctx = await buildVaultContext(api);
    expect(ctx).toMatch(/never.*skills\.run|do not.*skills\.run/i);
  });
});
