import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, isAbsolute } from "path";
import { generateAndWriteToolDocs, TOOL_DOCS_DIR, resolveToolDocsBaseDir } from "../src/tools/toolDocs.js";
import { MemoryStore } from "../src/memory/Memory.js";
import { FilesAPI } from "../src/api/files.js";

// Regression for the same post-vault-migration cleanup as
// tests/memory-store-root.test.ts. Before this fix, the boot regen and the
// daily tools-indexer duty both passed the default `TOOL_DOCS_DIR` (a
// CWD-relative path) straight to generateAndWriteToolDocs, which then wrote
// `memory/notes/tools/*.md` into the project repo's cwd instead of the vault.
// Tests here pin the contract: `generateAndWriteToolDocs` writes verbatim to
// whatever `baseDir` is passed — it's the caller's job to resolve relative
// paths against the active memory root before calling.

describe("generateAndWriteToolDocs baseDir contract", () => {
  let dataDir: string;
  let absoluteBaseDir: string;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), "ronin-tool-docs-"));
    absoluteBaseDir = join(dataDir, "memory", "notes", "tools");
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("writes to the exact absolute path passed in (not CWD)", async () => {
    const store = new MemoryStore(dataDir);
    const api = {
      tools: { list: () => [] }, // empty tool list produces no per-category files but still writes an index.md
      files: new FilesAPI(),
      memory: { ...store, getRootDir: () => store.getRootDir() },
    } as never;

    await generateAndWriteToolDocs(api, absoluteBaseDir);

    expect(existsSync(absoluteBaseDir)).toBe(true);
    expect(existsSync(join(absoluteBaseDir, "index.md"))).toBe(true);
    // And critically: nothing was written to the CWD-relative mirror.
    expect(existsSync(join(process.cwd(), TOOL_DOCS_DIR))).toBe(false);
  });

  it("TOOL_DOCS_DIR constant is a relative path that needs caller-side resolution", () => {
    // If this constant ever becomes absolute, the createAPI boot path and the
    // tools-indexer duty both stop needing the resolution logic, but that's a
    // coordinate change — the test below is a tripwire to catch that change.
    expect(isAbsolute(TOOL_DOCS_DIR)).toBe(false);
    // Resolves to `<memoryRoot>/notes/tools` where memoryRoot is e.g.
    // `<vault>/memory`. Sibling of conversations/ and blackboards/ inside
    // MemoryStore, not a path that includes the `memory/` prefix.
    expect(TOOL_DOCS_DIR).toBe("notes/tools");
  });

  it("MemoryStore.getRootDir matches the absolute path it was created with", () => {
    // Whatever MemoryStore's internal notesDir resolves to, getRootDir() must
    // equal the path passed to the constructor — the tools-indexer duty uses
    // this to compute the right sibling path for tool docs.
    const store = new MemoryStore(dataDir);
    expect(store.getRootDir()).toBe(dataDir);
    expect(store.getRootDir().endsWith("memory")).toBe(false); // dataDir already ends in /memory
    expect(store.getRootDir()).not.toBe("memory"); // never falls back to the default
  });
});

describe("resolveToolDocsBaseDir", () => {
  it("anchors the relative sentinel against api.memory.getRootDir()", () => {
    const root = "/Users/test/vault/memory";
    const api = { memory: { getRootDir: () => root } };
    const resolved = resolveToolDocsBaseDir(api as never);
    expect(resolved).toBe(join(root, TOOL_DOCS_DIR));
    expect(resolved).toBe("/Users/test/vault/memory/notes/tools");
  });

  it("passes an already-absolute baseDir through unchanged", () => {
    const abs = "/tmp/custom-tool-docs";
    const api = { memory: { getRootDir: () => "/somewhere/else" } };
    expect(resolveToolDocsBaseDir(api as never, abs)).toBe(abs);
  });

  it("falls back to the CWD-relative sentinel when api.memory has no getRootDir", () => {
    // This keeps tests that mock a partial api.memory working — better to land
    // in the cwd-relative default than to throw at boot.
    const api = { memory: {} };
    expect(resolveToolDocsBaseDir(api as never)).toBe(TOOL_DOCS_DIR);
  });
});
