import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DutyAPI } from "@ronin/types/index.js";
import { runEngineMigrations } from "../src/database/migrations.js";
import { getNodeSource } from "../src/graph/source.js";
import { DutyProposalStorage } from "../src/duty/proposal-storage.js";
import { ContractProposalStorage } from "../src/contract/proposal-storage.js";
import { KataStorage } from "../src/task/storage.js";
import type { DutyNode, ContractNode, KataNode, SensorNode } from "../src/graph/types.js";
import type { ContractV2Definition } from "../src/types/shared.js";

function createMockAPI(): DutyAPI {
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
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as DutyAPI;
}

describe("getNodeSource", () => {
  let scratchDir: string;
  let api: DutyAPI;

  afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  });

  it("reads a real duty file from disk", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-source-"));
    api = createMockAPI();
    const filePath = join(scratchDir, "example.ts");
    writeFileSync(filePath, "export default class Example {}\n");

    const node: DutyNode = {
      id: "duty:example", kind: "duty", name: "example", ghost: false,
      sourceRef: { origin: "file", path: filePath },
      tools: [], skills: [],
      ports: { eventsIn: [], eventsOut: [], beamsOut: [], queriesOut: [], queriesServed: [] },
    };
    const source = await getNodeSource(node, api);
    expect(source).toEqual({ code: "export default class Example {}\n", language: "typescript" });
  });

  it("returns a pending duty proposal's drafted code for a ghost node", async () => {
    api = createMockAPI();
    await runEngineMigrations((api as any).db);
    const storage = new DutyProposalStorage(api);
    const rec = await storage.create({ intent: "x", dutyName: "ghost-duty", code: "export default class Ghost {}", preview: "p" });

    const node: DutyNode = {
      id: "duty:ghost-duty", kind: "duty", name: "ghost-duty", ghost: true, proposalId: rec.id,
      sourceRef: { origin: "proposal" },
      tools: [], skills: [],
      ports: { eventsIn: [], eventsOut: [], beamsOut: [], queriesOut: [], queriesServed: [] },
    };
    const source = await getNodeSource(node, api);
    expect(source).toEqual({ code: "export default class Ghost {}", language: "typescript" });
  });

  it("returns a pending contract proposal's drafted DSL for a ghost node", async () => {
    api = createMockAPI();
    await runEngineMigrations((api as any).db);
    const contract: ContractV2Definition = {
      name: "ghost-contract", version: "v1", description: "test",
      targetKata: "some.kata", targetKataVersion: "v1", parameters: {},
      triggerType: "cron", triggerConfig: { type: "cron", expression: "0 9 * * *" },
      onFailureAction: "ignore", enabled: true,
    };
    const storage = new ContractProposalStorage(api);
    const rec = await storage.create({ intent: "x", contract, preview: "p" });

    const node: ContractNode = {
      id: "contract:ghost-contract", kind: "contract", name: "ghost-contract", ghost: true, proposalId: rec.id,
      sourceRef: { origin: "proposal" }, version: "v1", triggerType: "cron", cronExpression: "0 9 * * *",
      targetKind: "kata", targetName: "some.kata", targetVersion: "v1", active: false, approvalStatus: "pending",
    };
    const source = await getNodeSource(node, api);
    expect(source!.language).toBe("dsl");
    expect(source!.code).toContain("contract ghost-contract v1");
    expect(source!.code).toContain('trigger cron "0 9 * * *"');
    expect(source!.code).toContain("target kata some.kata v1");
  });

  it("reconstructs DSL from stored fields for a real contract with no backing file", async () => {
    api = createMockAPI();
    const node: ContractNode = {
      id: "contract:no-file", kind: "contract", name: "no-file", ghost: false,
      sourceRef: { origin: "registry", registryId: "1" }, version: "v1", triggerType: "event", eventName: "trust.changed",
      targetKind: "kata", targetName: "handoff", targetVersion: "v1", active: true, approvalStatus: "live",
    };
    const source = await getNodeSource(node, api);
    expect(source!.reconstructed).toBe(true);
    expect(source!.code).toContain('trigger event "trust.changed"');
  });

  it("returns a kata's real DSL source", async () => {
    api = createMockAPI();
    const storage = new KataStorage(api);
    await storage.init();
    await storage.save("k_v1", "k", "v1", "kata k v1\n  initial start\n\n  phase start\n    complete\n", { name: "k", version: "v1", requires: [], initial: "start", phases: {} }, "chk");

    const node: KataNode = {
      id: "kata:k@v1", kind: "kata", name: "k", ghost: false,
      sourceRef: { origin: "registry" }, version: "v1", phases: [],
    };
    const source = await getNodeSource(node, api);
    expect(source).toEqual({ code: "kata k v1\n  initial start\n\n  phase start\n    complete\n", language: "dsl" });
  });

  it("returns a synthesized description for a sensor node", async () => {
    api = createMockAPI();
    const node: SensorNode = {
      id: "sensor:cron:x", kind: "sensor", name: "x-cron", ghost: false,
      sourceRef: { origin: "registry", registryId: "x" }, sensorType: "cron", config: { expression: "0 9 * * *" },
    };
    const source = await getNodeSource(node, api);
    expect(source!.reconstructed).toBe(true);
    expect(source!.code).toContain("0 9 * * *");
  });
});
