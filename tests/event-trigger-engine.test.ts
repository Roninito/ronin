import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { DutyAPI } from "@ronin/types/index.js";
import { runEngineMigrations } from "../src/database/migrations.js";
import { ContractStorageV2 } from "../src/contract/storage-v2.js";
import { EventTriggerEngine } from "../src/contract/event-engine.js";
import { ContractEngine } from "../src/contract/engine.js";

// Same mock DutyAPI pattern as tests/contract-engine.test.ts — in-memory sqlite
// + a minimal on/off/emit event bus. No live server, no real integrations.
function createMockAPI(): DutyAPI {
  const Database = require("bun:sqlite").Database;
  const db = new Database(":memory:");
  const listeners = new Map<string, Set<(data: unknown) => void>>();

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
    events: {
      emit: (event: string, data: unknown, _source: string) => {
        for (const handler of [...(listeners.get(event) ?? [])]) handler(data);
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
      getRegisteredEvents: () => [...listeners.entries()].map(([event, h]) => ({ event, handlerCount: h.size })),
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as DutyAPI;
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("EventTriggerEngine", () => {
  let api: DutyAPI;
  let storage: ContractStorageV2;
  let engine: EventTriggerEngine;

  beforeEach(async () => {
    api = createMockAPI();
    await runEngineMigrations((api as any).db);
    storage = new ContractStorageV2(api);
    engine = new EventTriggerEngine(api);
  });

  afterEach(() => {
    engine.stop();
  });

  it("subscribes to an event-type contract's eventType and fires contract.event_triggered", async () => {
    await storage.create({
      name: "quiet-handoff",
      version: "v1",
      targetKata: "quiet-handoff-kata",
      targetKataVersion: "v1",
      parameters: {},
      triggerType: "event",
      triggerConfig: { type: "event", eventType: "trust.changed" },
      onFailureAction: "ignore",
      enabled: true,
    });

    await (engine as any).refresh();

    let received: any = null;
    (api as any).events.on("contract.event_triggered", (payload: any) => { received = payload; });

    (api as any).events.emit("trust.changed", { trust_level: 20 }, "test");
    await flush();

    expect(received).not.toBeNull();
    expect(received.contractName).toBe("quiet-handoff");
    expect(received.kataName).toBe("quiet-handoff-kata");
    expect(received.eventPayload).toEqual({ trust_level: 20 });
  });

  it("blocks the fire when the condition does not match, allows it when it does", async () => {
    await storage.create({
      name: "low-trust-handoff",
      version: "v1",
      targetKata: "handoff",
      targetKataVersion: "v1",
      parameters: {},
      triggerType: "event",
      triggerConfig: {
        type: "event",
        eventType: "trust.changed",
        condition: { variable: "trust_level", operator: "<", value: 40 },
      },
      onFailureAction: "ignore",
      enabled: true,
    });

    await (engine as any).refresh();

    let fireCount = 0;
    (api as any).events.on("contract.event_triggered", () => { fireCount++; });

    (api as any).events.emit("trust.changed", { trust_level: 80 }, "test"); // should NOT fire
    await flush();
    expect(fireCount).toBe(0);

    (api as any).events.emit("trust.changed", { trust_level: 10 }, "test"); // should fire
    await flush();
    expect(fireCount).toBe(1);
  });

  it("does not subscribe to disabled event contracts", async () => {
    await storage.create({
      name: "disabled-reflex",
      version: "v1",
      targetKata: "x",
      targetKataVersion: "v1",
      parameters: {},
      triggerType: "event",
      triggerConfig: { type: "event", eventType: "demo.fired" },
      onFailureAction: "ignore",
      enabled: false,
    });

    await (engine as any).refresh();

    let fired = false;
    (api as any).events.on("contract.event_triggered", () => { fired = true; });
    (api as any).events.emit("demo.fired", {}, "test");
    await flush();

    expect(fired).toBe(false);
  });

  it("unsubscribes when a contract is disabled between refreshes", async () => {
    await storage.create({
      name: "toggle-me",
      version: "v1",
      targetKata: "x",
      targetKataVersion: "v1",
      parameters: {},
      triggerType: "event",
      triggerConfig: { type: "event", eventType: "demo.toggle" },
      onFailureAction: "ignore",
      enabled: true,
    });

    await (engine as any).refresh();
    expect((api as any).events.getRegisteredEvents().find((e: any) => e.event === "demo.toggle")?.handlerCount).toBe(1);

    await storage.setEnabled("toggle-me", false);
    await (engine as any).refresh();

    let fired = false;
    (api as any).events.on("contract.event_triggered", () => { fired = true; });
    (api as any).events.emit("demo.toggle", {}, "test");
    await flush();

    expect(fired).toBe(false);
  });

  it("end-to-end with ContractEngine: event fire -> task.spawn_requested with initialVariables from the payload", async () => {
    await storage.create({
      name: "e2e-reflex",
      version: "v1",
      targetKata: "quiet-handoff-kata",
      targetKataVersion: "v1",
      parameters: {},
      triggerType: "event",
      triggerConfig: {
        type: "event",
        eventType: "rival.spotted",
        condition: { variable: "distance", operator: "<", value: 50 },
      },
      onFailureAction: "ignore",
      enabled: true,
    });

    await (engine as any).refresh();
    const contractEngine = new ContractEngine(api);
    contractEngine.start();

    let spawnRequest: any = null;
    (api as any).events.on("task.spawn_requested", (payload: any) => { spawnRequest = payload; });

    (api as any).events.emit("rival.spotted", { distance: 30, name: "Kael" }, "test");
    await flush();

    expect(spawnRequest).not.toBeNull();
    expect(spawnRequest.kataName).toBe("quiet-handoff-kata");
    expect(spawnRequest.initialVariables).toEqual({ distance: 30, name: "Kael" });

    const row = await storage.getByName("e2e-reflex");
    expect(row?.execution_count).toBe(1);
  });
});
