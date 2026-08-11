import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { DutyAPI } from "@ronin/types/index.js";
import { runEngineMigrations } from "../src/database/migrations.js";
import { deriveGraph } from "../src/graph/derive.js";
import { ContractStorageV2 } from "../src/contract/storage-v2.js";
import { KataStorage } from "../src/task/storage.js";
import type { ContractV2Definition } from "../src/types/shared.js";
import type { ContractNode, DutyNode, KataNode, SensorNode } from "../src/graph/types.js";

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
    events: { emit: () => {}, on: () => {}, off: () => {}, beam: () => {}, query: async () => undefined, reply: () => {}, getRegisteredEvents: () => [] },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as DutyAPI;
}

const SAMPLE_CONTRACT: ContractV2Definition = {
  name: "daily-audit",
  version: "v1",
  description: "test contract",
  targetKata: "finance.audit",
  targetKataVersion: "v1",
  parameters: {},
  triggerType: "cron",
  triggerConfig: { type: "cron", expression: "0 9 * * *" },
  onFailureAction: "ignore",
  enabled: true,
};

describe("deriveGraph", () => {
  let scratchDir: string;
  let api: DutyAPI;

  afterEach(() => {
    if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  });

  it("derives duty nodes with declared + scanned topology, and matches a broadcast edge across two duties", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-graph-derive-"));
    api = createMockAPI();
    await runEngineMigrations((api as any).db);

    writeFileSync(
      join(scratchDir, "emitter.ts"),
      `
      import { BaseDuty } from "${process.cwd()}/src/duty/index.js";
      export default class Emitter extends BaseDuty {
        static events = { out: ["finance.audit.completed"] };
        async execute() {}
      }
      `
    );
    writeFileSync(
      join(scratchDir, "listener.ts"),
      `
      import { BaseDuty } from "${process.cwd()}/src/duty/index.js";
      export default class Listener extends BaseDuty {
        async execute() {
          this.api.events.on("finance.audit.completed", () => {});
        }
      }
      `
    );

    const graph = await deriveGraph(api, { dutyDir: scratchDir });

    const dutyNodes = graph.nodes.filter((n): n is DutyNode => n.kind === "duty");
    expect(dutyNodes.map((d) => d.name).sort()).toEqual(["emitter", "listener"]);

    const emitter = dutyNodes.find((d) => d.name === "emitter")!;
    expect(emitter.ports.eventsOut).toEqual(["finance.audit.completed"]);

    const listener = dutyNodes.find((d) => d.name === "listener")!;
    expect(listener.ports.eventsIn).toEqual(["finance.audit.completed"]);

    const broadcastEdge = graph.edges.find(
      (e) => e.kind === "broadcast" && e.sourceNodeId === "duty:emitter" && e.targetNodeId === "duty:listener"
    );
    expect(broadcastEdge).toBeDefined();
    expect(broadcastEdge!.danglingTarget).toBe(false);
  });

  it("flags a beam to a nonexistent duty as a dangling edge", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-graph-derive-"));
    api = createMockAPI();
    await runEngineMigrations((api as any).db);

    writeFileSync(
      join(scratchDir, "beamer.ts"),
      `
      import { BaseDuty } from "${process.cwd()}/src/duty/index.js";
      export default class Beamer extends BaseDuty {
        static beams = [{ target: "does-not-exist", eventType: "ping" }];
        async execute() {}
      }
      `
    );

    const graph = await deriveGraph(api, { dutyDir: scratchDir });
    const beamEdge = graph.edges.find((e) => e.kind === "beam");
    expect(beamEdge).toBeDefined();
    expect(beamEdge!.danglingTarget).toBe(true);
    expect((beamEdge as any).targetDutyName).toBe("does-not-exist");
    expect(beamEdge!.derivation).toBe("declared");
  });

  it("derives a live contract node with next executions and a cron sensor, and resolves a contract-run edge to a real kata", async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "ronin-graph-derive-"));
    api = createMockAPI();
    await runEngineMigrations((api as any).db);

    const contractStorage = new ContractStorageV2(api);
    await contractStorage.create(SAMPLE_CONTRACT);

    const kataStorage = new KataStorage(api);
    await kataStorage.init();
    await kataStorage.save(
      "finance.audit_v1",
      "finance.audit",
      "v1",
      "kata finance.audit v1\n  requires skill finance.extract\n\n  initial check\n\n  phase check\n    run skill finance.extract\n    complete\n",
      {
        name: "finance.audit",
        version: "v1",
        requires: [],
        initial: "check",
        phases: { check: { name: "check", action: { type: "run", skill: "finance.extract" } } },
        requiredSkills: ["finance.extract"],
      },
      "checksum123"
    );

    const graph = await deriveGraph(api, { dutyDir: scratchDir });

    const contractNode = graph.nodes.find((n): n is ContractNode => n.kind === "contract" && n.name === "daily-audit");
    expect(contractNode).toBeDefined();
    expect(contractNode!.ghost).toBe(false);
    expect(contractNode!.approvalStatus).toBe("live");
    expect(contractNode!.triggerType).toBe("cron");
    expect(contractNode!.nextExecutions?.length).toBe(5);

    const cronSensor = graph.nodes.find((n): n is SensorNode => n.kind === "sensor" && n.id === "sensor:cron:daily-audit");
    expect(cronSensor).toBeDefined();
    expect(cronSensor!.config.expression).toBe("0 9 * * *");

    const kataNode = graph.nodes.find((n): n is KataNode => n.kind === "kata" && n.name === "finance.audit");
    expect(kataNode).toBeDefined();
    expect(kataNode!.phases).toEqual([{ name: "check", skill: "finance.extract", next: undefined }]);

    const runEdge = graph.edges.find((e) => e.kind === "contract-run");
    expect(runEdge).toBeDefined();
    expect(runEdge!.targetNodeId).toBe("kata:finance.audit@v1");
    expect(runEdge!.danglingTarget).toBe(false);
  });
});
