import { describe, it, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import type { DutyAPI } from "@ronin/types/index.js";
import type { ChainContext } from "@ronin/sar";
import { createArtifactInjectMiddleware } from "../src/middleware/artifactInject.js";

function createMockAPI(): { api: DutyAPI; db: Database } {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY, name TEXT, type TEXT, tags TEXT, state TEXT, completion_threshold INTEGER
    );
    CREATE TABLE artifact_assets (
      artifact_id TEXT, category TEXT, target INTEGER, collected INTEGER, pending INTEGER
    );
  `);

  const api = {
    db: {
      query: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        return params && params.length > 0 ? stmt.all(...params) : stmt.all();
      },
      execute: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        params && params.length > 0 ? stmt.run(...params) : stmt.run();
      },
    },
  } as unknown as DutyAPI;

  return { api, db };
}

function ctxWithUserMessage(content: string): ChainContext {
  return { messages: [{ role: "user", content }] } as unknown as ChainContext;
}

async function run(mw: ReturnType<typeof createArtifactInjectMiddleware>, ctx: ChainContext): Promise<void> {
  await mw(ctx, async () => {});
}

describe("artifactInject middleware", () => {
  let api: DutyAPI;
  let db: Database;

  beforeEach(() => {
    ({ api, db } = createMockAPI());
  });

  it("injects context when the message mentions the artifact's id", async () => {
    db.exec(
      `INSERT INTO artifacts VALUES ('rts-game-assets-x1', 'RTS Game Assets', 'game_assets', '["strategy","3d"]', 'ACTIVE', 85)`
    );
    db.exec(`INSERT INTO artifact_assets VALUES ('rts-game-assets-x1', 'models', 12, 8, 4)`);

    const mw = createArtifactInjectMiddleware({ api });
    const ctx = ctxWithUserMessage("can you check on rts-game-assets-x1 for me?");
    await run(mw, ctx);

    expect(ctx.messages[0]?.role).toBe("system");
    expect(ctx.messages[0]?.content).toContain("RTS Game Assets");
    expect(ctx.messages[0]?.content).toContain("matched by id");
    expect(ctx.messages[0]?.content).toContain("models (4)");
  });

  it("injects context when the message mentions the artifact's name", async () => {
    db.exec(`INSERT INTO artifacts VALUES ('a1', 'Byzantine History Notes', 'research', '[]', 'ACTIVE', 85)`);

    const mw = createArtifactInjectMiddleware({ api });
    const ctx = ctxWithUserMessage("add another source to byzantine history notes");
    await run(mw, ctx);

    expect(ctx.messages[0]?.content).toContain("matched by name");
  });

  it("injects context on tag keyword overlap", async () => {
    db.exec(`INSERT INTO artifacts VALUES ('a1', 'Vehicle Pack', 'game_assets', '["vehicle","models"]', 'ACTIVE', 85)`);

    const mw = createArtifactInjectMiddleware({ api });
    const ctx = ctxWithUserMessage("let's add more vehicle models to the collection");
    await run(mw, ctx);

    expect(ctx.messages[0]?.content).toContain("matched by tags");
  });

  it("does not inject when nothing matches", async () => {
    db.exec(`INSERT INTO artifacts VALUES ('a1', 'Vehicle Pack', 'game_assets', '["vehicle","models"]', 'ACTIVE', 85)`);

    const mw = createArtifactInjectMiddleware({ api });
    const ctx = ctxWithUserMessage("what's the weather like today?");
    await run(mw, ctx);

    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0]?.role).toBe("user");
  });

  it("ignores COMPLETE and ARCHIVED artifacts", async () => {
    db.exec(`INSERT INTO artifacts VALUES ('done-1', 'Finished Project', 'research', '[]', 'COMPLETE', 85)`);

    const mw = createArtifactInjectMiddleware({ api });
    const ctx = ctxWithUserMessage("tell me about done-1");
    await run(mw, ctx);

    expect(ctx.messages).toHaveLength(1);
  });

  it("only runs once per chain (idempotent via _artifactInjected)", async () => {
    db.exec(`INSERT INTO artifacts VALUES ('a1', 'Vehicle Pack', 'game_assets', '[]', 'ACTIVE', 85)`);

    const mw = createArtifactInjectMiddleware({ api });
    const ctx = ctxWithUserMessage("check a1");
    await run(mw, ctx);
    const afterFirst = ctx.messages.length;
    await run(mw, ctx);

    expect(ctx.messages.length).toBe(afterFirst);
  });

  it("respects maxArtifacts, picking the highest-relevance match first", async () => {
    // scoreContextRelevance = (matching context-word occurrences) / (tag count).
    // One "vehicle" occurrence against 3 tags -> 0.33, clearly below a
    // perfect 1.0 id-match, so this doesn't tie on sort order.
    db.exec(`INSERT INTO artifacts VALUES ('a1', 'Vehicle Pack', 'game_assets', '["vehicle","fleet","chassis"]', 'ACTIVE', 85)`);
    db.exec(`INSERT INTO artifacts VALUES ('vehicle-pack-exact-id', 'Something Else', 'research', '[]', 'ACTIVE', 85)`);

    const mw = createArtifactInjectMiddleware({ api, maxArtifacts: 1 });
    const ctx = ctxWithUserMessage("vehicle-pack-exact-id needs review");
    await run(mw, ctx);

    // Exactly one injected message (id match, score 1.0, beats the tag match).
    const injected = ctx.messages.filter((m) => m.role === "system");
    expect(injected).toHaveLength(1);
    expect(injected[0]?.content).toContain("Something Else");
  });

  it("never throws when the artifacts tables don't exist", async () => {
    const bareDb = new Database(":memory:"); // no tables at all
    const bareApi = {
      db: {
        query: async (sql: string, params?: any[]) => {
          const stmt = bareDb.prepare(sql);
          return params && params.length > 0 ? stmt.all(...params) : stmt.all();
        },
        execute: async () => {},
      },
    } as unknown as DutyAPI;

    const mw = createArtifactInjectMiddleware({ api: bareApi });
    const ctx = ctxWithUserMessage("anything at all");
    await expect(run(mw, ctx)).resolves.toBeUndefined();
    expect(ctx.messages).toHaveLength(1);
  });

  it("calls next() even when nothing matches or an error occurs", async () => {
    db.exec(`INSERT INTO artifacts VALUES ('a1', 'Vehicle Pack', 'game_assets', '[]', 'ACTIVE', 85)`);
    const mw = createArtifactInjectMiddleware({ api });
    let nextCalled = false;
    await mw(ctxWithUserMessage("nothing relevant"), async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});
