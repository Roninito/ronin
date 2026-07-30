import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DutyAPI } from "@ronin/types/index.js";
import { runArtifactMigrations } from "../src/artifacts/migrations.js";
import { ArtifactStore } from "../src/artifacts/store.js";
import { calculateCompletion } from "../src/artifacts/types.js";
import { calculateBackoff, calculateNextCheckIn, scoreContextRelevance } from "../src/artifacts/scheduler.js";
import {
  assetFileExists,
  getArtifactAssetsDir,
  guessMimeType,
  isImageAsset,
  resolveStoredAssetPath,
  sanitizeAssetFilename,
} from "../src/artifacts/storage.js";

// Mock DutyAPI with in-memory database (same pattern as tests/database-usage.test.ts)
function createMockAPI(dataDir: string): DutyAPI {
  const Database = require("bun:sqlite").Database;
  const db = new Database(":memory:");

  return {
    db: {
      query: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        return params && params.length > 0 ? stmt.all(...params) : stmt.all();
      },
      execute: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        return params && params.length > 0 ? stmt.run(...params) : stmt.run();
      },
    },
    config: {
      getSystem: () => ({ dataDir }),
    } as any,
  } as unknown as DutyAPI;
}

describe("Artifacts", () => {
  let api: DutyAPI;
  let store: ArtifactStore;
  let dataDir: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "ronin-artifacts-test-"));
    api = createMockAPI(dataDir);
    await runArtifactMigrations(api.db);
    store = new ArtifactStore(api);
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("ArtifactStore CRUD", () => {
    it("creates an artifact with default state INITIALIZED", async () => {
      const meta = await store.create({ name: "Test Game Assets", type: "game_assets", tags: ["game", "test"] });
      expect(meta.id).toBeTruthy();
      expect(meta.state).toBe("INITIALIZED");
      expect(meta.name).toBe("Test Game Assets");
      expect(meta.tags).toEqual(["game", "test"]);
    });

    it("loads a created artifact", async () => {
      const created = await store.create({ name: "Research Project", type: "research" });
      const loaded = await store.load(created.id);
      expect(loaded?.metadata.name).toBe("Research Project");
      expect(loaded?.assetRecords).toEqual([]);
      expect(loaded?.logs).toEqual([]);
    });

    it("returns null for an unknown artifact id", async () => {
      const loaded = await store.load("does-not-exist");
      expect(loaded).toBeNull();
    });

    it("seeds asset categories on create", async () => {
      const meta = await store.create({
        name: "RTS Assets",
        type: "game_assets",
        assets: [{ category: "models", target: 12 }, { category: "textures", target: 25 }],
      });
      expect(meta.assets.models).toEqual({ category: "models", target: 12, collected: 0, pending: 12 });
      expect(meta.assets.textures.target).toBe(25);
    });

    it("updates progress for a category", async () => {
      const meta = await store.create({
        name: "RTS Assets",
        type: "game_assets",
        assets: [{ category: "models", target: 12 }],
      });
      await store.updateProgress(meta.id, "models", { collected: 8, pending: 4 });
      const loaded = await store.load(meta.id);
      expect(loaded?.metadata.assets.models).toMatchObject({ collected: 8, pending: 4 });
    });

    it("creates a new category via updateProgress if it didn't exist", async () => {
      const meta = await store.create({ name: "Loose Project", type: "research" });
      await store.updateProgress(meta.id, "papers", { target: 5, collected: 2, pending: 3 });
      const loaded = await store.load(meta.id);
      expect(loaded?.metadata.assets.papers).toMatchObject({ target: 5, collected: 2, pending: 3 });
    });

    it("records asset files", async () => {
      const meta = await store.create({ name: "Assets", type: "game_assets" });
      await store.addAsset(meta.id, {
        type: "model",
        filename: "guard.glb",
        source: "Sketchfab",
        license: "CC-BY",
        downloadedAt: new Date().toISOString(),
      });
      const loaded = await store.load(meta.id);
      expect(loaded?.assetRecords).toHaveLength(1);
      expect(loaded?.assetRecords[0].filename).toBe("guard.glb");
    });

    it("appends log entries", async () => {
      const meta = await store.create({ name: "Assets", type: "game_assets" });
      await store.appendLog(meta.id, { timestamp: new Date().toISOString(), skillId: "ronin", action: "GATHERED", details: "Got 5 models" });
      const loaded = await store.load(meta.id);
      expect(loaded?.logs).toHaveLength(1);
      expect(loaded?.logs[0].action).toBe("GATHERED");
    });

    it("lists only non-terminal artifacts in listActive", async () => {
      const a = await store.create({ name: "Active One", type: "research" });
      const b = await store.create({ name: "Done One", type: "research" });
      await store.transitionState(b.id, "ACTIVE");
      await store.transitionState(b.id, "COMPLETE");
      const active = await store.listActive();
      expect(active.map((x) => x.id)).toContain(a.id);
      expect(active.map((x) => x.id)).not.toContain(b.id);
    });
  });

  describe("State machine", () => {
    it("allows INITIALIZED -> ACTIVE -> COMPLETE", async () => {
      const meta = await store.create({ name: "Flow", type: "research" });
      await store.transitionState(meta.id, "ACTIVE");
      const done = await store.transitionState(meta.id, "COMPLETE");
      expect(done.state).toBe("COMPLETE");
    });

    it("rejects an invalid transition", async () => {
      const meta = await store.create({ name: "Flow", type: "research" });
      await expect(store.transitionState(meta.id, "COMPLETE")).rejects.toThrow(/Invalid artifact state transition/);
    });

    it("disables scheduling once COMPLETE", async () => {
      const meta = await store.create({ name: "Flow", type: "research" });
      await store.transitionState(meta.id, "ACTIVE");
      const done = await store.transitionState(meta.id, "COMPLETE");
      expect(done.scheduling.enabled).toBe(false);
    });
  });

  describe("evaluateSchedule / backoff", () => {
    it("schedules immediately for a freshly created artifact", async () => {
      const meta = await store.create({ name: "Fresh", type: "research" });
      const decision = await store.evaluateSchedule(meta.id);
      expect(decision.shouldSchedule).toBe(true);
    });

    it("backs off on immediate re-evaluation", async () => {
      const meta = await store.create({ name: "Fresh", type: "research" });
      await store.evaluateSchedule(meta.id); // consumes the first window, advances next_check_in
      const second = await store.evaluateSchedule(meta.id);
      expect(second.shouldSchedule).toBe(false);
      expect(second.reason).toMatch(/Backoff active/);
    });

    it("does not schedule a COMPLETE artifact", async () => {
      const meta = await store.create({ name: "Done", type: "research" });
      await store.transitionState(meta.id, "ACTIVE");
      await store.transitionState(meta.id, "COMPLETE");
      const decision = await store.evaluateSchedule(meta.id);
      expect(decision.shouldSchedule).toBe(false);
      expect(decision.reason).toMatch(/complete/i);
    });

    it("stops scheduling once max attempts are reached", async () => {
      const meta = await store.create({ name: "Persistent", type: "research" });
      // Force attempt_count to max and next_check_in into the past.
      await api.db.execute(`UPDATE artifacts SET attempt_count = 3, next_check_in = ? WHERE id = ?`, [
        new Date(Date.now() - 1000).toISOString(),
        meta.id,
      ]);
      const decision = await store.evaluateSchedule(meta.id);
      expect(decision.shouldSchedule).toBe(false);
      expect(decision.reason).toMatch(/Max scheduling attempts/);
    });
  });

  describe("scheduler math", () => {
    it("computes increasing backoff with each attempt", () => {
      const d0 = calculateBackoff(0, 1.5);
      const d1 = calculateBackoff(1, 1.5);
      const d2 = calculateBackoff(2, 1.5);
      expect(d1).toBeGreaterThan(d0);
      expect(d2).toBeGreaterThan(d1);
      expect(d0).toBe(60 * 60 * 1000);
    });

    it("computes a next-check-in timestamp in the future", () => {
      const now = Date.now();
      const next = calculateNextCheckIn(0, 1.5, now);
      expect(new Date(next).getTime()).toBeGreaterThan(now);
    });

    it("scores context relevance against tags", () => {
      const high = scoreContextRelevance("more vehicle models please", ["vehicle", "models"]);
      const low = scoreContextRelevance("what's the weather", ["vehicle", "models"]);
      expect(high).toBeGreaterThan(low);
    });
  });

  describe("calculateCompletion", () => {
    it("returns 0 for no asset categories", () => {
      expect(calculateCompletion({})).toBe(0);
    });

    it("averages completion ratios across categories, capped at 100%", () => {
      const pct = calculateCompletion({
        models: { category: "models", target: 10, collected: 10, pending: 0 },
        textures: { category: "textures", target: 20, collected: 10, pending: 10 },
      });
      // models 100%, textures 50% -> average 75%
      expect(pct).toBe(75);
    });
  });

  describe("binary asset storage", () => {
    it("creates and returns the artifact's assets directory", () => {
      const dir = getArtifactAssetsDir(api, "some-artifact");
      expect(dir).toContain(join(dataDir, "artifacts", "some-artifact", "assets"));
    });

    it("sanitizes a filename to its basename", () => {
      expect(sanitizeAssetFilename("shot.png")).toBe("shot.png");
      expect(sanitizeAssetFilename("../../etc/passwd")).toBe("passwd");
      expect(sanitizeAssetFilename("/abs/path/shot.png")).toBe("shot.png");
    });

    it("resolves a stored path inside the artifact's assets directory", () => {
      const resolved = resolveStoredAssetPath(api, "art-1", "shot.png");
      expect(resolved).toBe(join(getArtifactAssetsDir(api, "art-1"), "shot.png"));
    });

    it("never lets a traversal-style filename escape the assets directory", () => {
      const resolved = resolveStoredAssetPath(api, "art-1", "../../../etc/passwd");
      expect(resolved.startsWith(getArtifactAssetsDir(api, "art-1"))).toBe(true);
    });

    it("reports whether a stored asset file actually exists on disk", () => {
      expect(assetFileExists(api, "art-2", "missing.png")).toBe(false);
      const dir = getArtifactAssetsDir(api, "art-2");
      writeFileSync(join(dir, "present.png"), "fake-png-bytes");
      expect(assetFileExists(api, "art-2", "present.png")).toBe(true);
    });

    it("guesses mime types from extension", () => {
      expect(guessMimeType("shot.png")).toBe("image/png");
      expect(guessMimeType("notes.pdf")).toBe("application/pdf");
      expect(guessMimeType("data.bin")).toBe("application/octet-stream");
    });

    it("identifies image assets by extension", () => {
      expect(isImageAsset("shot.png")).toBe(true);
      expect(isImageAsset("notes.pdf")).toBe(false);
    });

    it("round-trips storedPath through ArtifactStore.addAsset/load", async () => {
      const meta = await store.create({ name: "Research", type: "research" });
      const dir = getArtifactAssetsDir(api, meta.id);
      writeFileSync(join(dir, "example.png"), "fake-png-bytes");

      await store.addAsset(meta.id, {
        type: "reference",
        filename: "example.png",
        source: "https://example.com",
        downloadedAt: new Date().toISOString(),
        storedPath: "example.png",
      });

      const loaded = await store.load(meta.id);
      expect(loaded?.assetRecords[0].storedPath).toBe("example.png");
    });
  });
});
