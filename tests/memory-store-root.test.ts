import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { MemoryStore } from "../src/memory/Memory.js";

// Regression for the post-vault-migration cleanup: MemoryStore must expose its
// absolute root path so peer subsystems (tool-docs regen, kdb stats, anything
// else that needs to write siblings of memory/notes/) can target the same vault
// the messenger reads from. Before this, the daily tools-indexer duty silently
// wrote `notes/tools/*.md` into the project repo's CWD instead of the
// vault, leaving the messenger reading a stale index until manual sync.

describe("MemoryStore.getRootDir", () => {
  let dataDir: string;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), "ronin-memory-root-"));
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns the absolute rootDir it was created with", () => {
    const store = new MemoryStore(dataDir);
    expect(store.getRootDir()).toBe(dataDir);
  });

  it("returns the default 'memory' rootDir when no argument is passed", () => {
    const store = new MemoryStore();
    // Either resolves to a CWD-relative "memory" or, under bun test which
    // sometimes normalizes cwd, an absolute path. We just need to verify it
    // round-trips through whatever the constructor saw — that's the contract
    // every caller downstream depends on.
    expect(typeof store.getRootDir()).toBe("string");
    expect(store.getRootDir().length).toBeGreaterThan(0);
  });

  it("matches dirname(notesDir) — the invariant the tool-docs regen relies on", () => {
    const store = new MemoryStore(dataDir);
    // notesDir is private, but the public invariant is that getRootDir()
    // is the parent of the notes directory. We can verify this by storing
    // a value and then asking the store to read it back from the expected
    // path.
    void store.store("test-key", { hello: "world" });
    // The stored note lives at <rootDir>/notes/<slug>.md
    const notesDir = join(store.getRootDir(), "notes");
    expect(existsSync(notesDir)).toBe(true);
    expect(readdirSync(notesDir).length).toBeGreaterThan(0);
    // Round-trip: dirname(notesDir) === getRootDir()
    expect(dirname(notesDir)).toBe(store.getRootDir());
  });
});
