import { describe, it, expect, beforeEach } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import { runEngineMigrations } from "../src/database/migrations.js";
import { ContractStorageV2 } from "../src/contract/storage-v2.js";
import { CronEngine, ContractEngine } from "../src/contract/engine.js";

// Mock DutyAPI with in-memory database + a minimal event bus
// (same db-mock pattern as tests/artifacts.test.ts)
function createMockAPI(): DutyAPI {
  const Database = require("bun:sqlite").Database;
  const db = new Database(":memory:");

  const listeners = new Map<string, Set<(data: unknown) => void>>();

  const api = {
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
    events: {
      emit: (event: string, data: unknown, _source: string) => {
        for (const handler of listeners.get(event) ?? []) handler(data);
      },
      on: (event: string, handler: (data: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(handler);
      },
      off: (event: string, handler: (data: unknown) => void) => {
        listeners.get(event)?.delete(handler);
      },
      beam: () => {},
      query: async () => undefined,
      reply: () => {},
      getRegisteredEvents: () => [],
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as DutyAPI;

  return api;
}

describe("Contract engine — V2 storage wiring", () => {
  let api: DutyAPI;
  let storage: ContractStorageV2;

  beforeEach(async () => {
    api = createMockAPI();
    await runEngineMigrations((api as any).db);
    storage = new ContractStorageV2(api);
  });

  it("CronEngine reads from contracts_v2 (not the dead V1 table) and emits a correctly-mapped payload", async () => {
    await storage.create({
      name: "daily-digest",
      version: "v1",
      targetKata: "codebase-digest",
      targetKataVersion: "v2",
      parameters: {},
      triggerType: "cron",
      triggerConfig: { type: "cron", expression: "* * * * *" },
      onFailureAction: "ignore",
      enabled: true,
    });

    const engine = new CronEngine(api);
    let received: any = null;
    (api as any).events.on("contract.cron_triggered", (payload: any) => { received = payload; });

    await (engine as any).tick();

    expect(received).not.toBeNull();
    expect(received.contractName).toBe("daily-digest");
    expect(typeof received.contractId).toBe("string");
    expect(received.kataName).toBe("codebase-digest");
    expect(received.kataVersion).toBe("v2");
    expect(received.expression).toBe("* * * * *");
  });

  it("CronEngine skips disabled contracts", async () => {
    await storage.create({
      name: "disabled-one",
      version: "v1",
      targetKata: "x",
      targetKataVersion: "v1",
      parameters: {},
      triggerType: "cron",
      triggerConfig: { type: "cron", expression: "* * * * *" },
      onFailureAction: "ignore",
      enabled: false,
    });

    const engine = new CronEngine(api);
    let fired = false;
    (api as any).events.on("contract.cron_triggered", () => { fired = true; });

    await (engine as any).tick();
    expect(fired).toBe(false);
  });

  it("CronEngine skips a non-matching cron expression", async () => {
    await storage.create({
      name: "midnight-only",
      version: "v1",
      targetKata: "x",
      targetKataVersion: "v1",
      parameters: {},
      triggerType: "cron",
      // Guaranteed not to match "now" in this century.
      triggerConfig: { type: "cron", expression: "0 0 1 1 *" },
      onFailureAction: "ignore",
      enabled: true,
    });

    const engine = new CronEngine(api);
    let fired = false;
    (api as any).events.on("contract.cron_triggered", () => { fired = true; });

    await (engine as any).tick();
    expect(fired).toBe(false);
  });

  it("ContractEngine turns a cron trigger into task.spawn_requested and records execution", async () => {
    await storage.create({
      name: "weekly-report",
      version: "v1",
      targetKata: "finance.audit",
      targetKataVersion: "v1",
      parameters: {},
      triggerType: "cron",
      triggerConfig: { type: "cron", expression: "* * * * *" },
      onFailureAction: "ignore",
      enabled: true,
    });

    const cronEngine = new CronEngine(api);
    const contractEngine = new ContractEngine(api);
    contractEngine.start();

    let spawnRequest: any = null;
    (api as any).events.on("task.spawn_requested", (payload: any) => { spawnRequest = payload; });

    await (cronEngine as any).tick();
    // handleCronTrigger's own work (emit + recordExecution) runs synchronously
    // off the "contract.cron_triggered" emit above; give its microtasks a tick.
    await new Promise((r) => setTimeout(r, 0));

    expect(spawnRequest).not.toBeNull();
    expect(spawnRequest.kataName).toBe("finance.audit");
    expect(spawnRequest.kataVersion).toBe("v1");
    expect(typeof spawnRequest.contractId).toBe("string");

    const row = await storage.getByName("weekly-report");
    expect(row?.execution_count).toBe(1);
    expect(row?.last_executed_at).not.toBeNull();
  });

  it("ContractEngine pipes the triggering event's payload into task.spawn_requested.initialVariables for event triggers", async () => {
    const contractEngine = new ContractEngine(api);
    contractEngine.start();

    let spawnRequest: any = null;
    (api as any).events.on("task.spawn_requested", (payload: any) => { spawnRequest = payload; });

    (api as any).events.emit("contract.event_triggered", {
      contractId: "7",
      contractName: "quiet-handoff",
      kataName: "quiet-handoff-kata",
      kataVersion: "v1",
      timestamp: Date.now(),
      eventPayload: { trust_level: 35, rival: { name: "Kael" } },
    }, "test");

    await new Promise((r) => setTimeout(r, 0));

    expect(spawnRequest).not.toBeNull();
    expect(spawnRequest.initialVariables).toEqual({ trust_level: 35, rival: { name: "Kael" } });
  });
});
