/**
 * Full graph derivation — the Analyze phase of graph-keeper.
 *
 * Priority-ordered sources (declared > scanned > runtime is applied per-item,
 * not as separate passes — see mergeTopology below). Pure read: never writes
 * to any duty/contract/kata table, only its own graph_snapshots row (via
 * GraphStore, called by the caller).
 */

import { readFileSync, statSync } from "fs";
import { basename, extname } from "path";
import type { DutyAPI } from "../types/index.js";
import type { DutyEventsDecl, DutyBeamDecl, DutyQueriesDecl } from "../types/duty.js";
import { DutyLoader } from "../duty/DutyLoader.js";
import { ContractStorageV2 } from "../contract/storage-v2.js";
import { ContractProposalStorage } from "../contract/proposal-storage.js";
import { KataStorage } from "../task/storage.js";
import { DutyProposalStorage } from "../duty/proposal-storage.js";
import { CronEvaluator } from "../contract/cron.js";
import { scanDutySource } from "./scanner.js";
import type {
  DerivedGraph,
  GraphNode,
  GraphEdge,
  DutyNode,
  ContractNode,
  KataNode,
  SensorNode,
  BroadcastEdge,
  BeamEdge,
  QueryEdge,
  ContractRunEdge,
  Derivation,
  CapabilityChip,
  BeamDecl,
  QueryOutDecl,
} from "./types.js";

interface DutyStatics {
  name: string;
  filePath: string;
  description?: string;
  schedule?: string;
  watch?: string[];
  webhook?: string;
  events?: DutyEventsDecl;
  beams?: DutyBeamDecl[];
  queries?: DutyQueriesDecl;
}

function extractDutyName(filePath: string): string {
  return basename(filePath).replace(/\.(ts|js)$/, "");
}

async function loadDutyStatics(filePath: string): Promise<DutyStatics | null> {
  try {
    const mtime = statSync(filePath).mtimeMs;
    const module = await import(filePath + "?t=" + mtime);
    const DutyClass = module.default;
    if (!DutyClass || typeof DutyClass !== "function") return null;
    return {
      name: extractDutyName(filePath),
      filePath,
      description: DutyClass.description,
      schedule: DutyClass.schedule,
      watch: DutyClass.watch,
      webhook: DutyClass.webhook,
      events: DutyClass.events,
      beams: DutyClass.beams,
      queries: DutyClass.queries,
    };
  } catch {
    return null;
  }
}

/** Build one DutyNode by combining declared statics with a scan of the raw source. Reusable for both real files and in-memory ghost-proposal code. */
function buildDutyNode(
  name: string,
  source: string,
  declared: { events?: DutyEventsDecl; beams?: DutyBeamDecl[]; queries?: DutyQueriesDecl; schedule?: string; watch?: string[]; webhook?: string; description?: string },
  sourceRef: DutyNode["sourceRef"],
  ghost: boolean,
  proposalId?: string
): DutyNode {
  const scanned = scanDutySource(source, name);

  const declaredIn = new Set(declared.events?.in ?? []);
  const declaredOut = new Set(declared.events?.out ?? []);
  const eventsIn = Array.from(new Set([...declaredIn, ...scanned.eventsIn]));
  const eventsOut = Array.from(new Set([...declaredOut, ...scanned.eventsOut]));

  const declaredBeamKeys = new Set((declared.beams ?? []).map((b) => `${b.target}:${b.eventType}`));
  const scannedBeamsFiltered = scanned.beamsOut.filter((b) => !declaredBeamKeys.has(`${b.target}:${b.eventType}`));
  const beamsOut: BeamDecl[] = [
    ...(declared.beams ?? []).map((b) => ({ ...b, derivation: "declared" as Derivation })),
    ...scannedBeamsFiltered.map((b) => ({ ...b, derivation: "scanned" as Derivation })),
  ];

  const declaredQueryKeys = new Set((declared.queries?.out ?? []).map((q) => `${q.target}:${q.queryType}`));
  const scannedQueriesFiltered = scanned.queriesOut.filter((q) => !declaredQueryKeys.has(`${q.target}:${q.queryType}`));
  const queriesOut: QueryOutDecl[] = [
    ...(declared.queries?.out ?? []).map((q) => ({ ...q, derivation: "declared" as Derivation })),
    ...scannedQueriesFiltered.map((q) => ({ ...q, timeoutMs: 5000, derivation: "scanned" as Derivation })),
  ];

  const queriesServed = Array.from(new Set([...(declared.queries?.served ?? []), ...scanned.queriesServed]));

  const tools: CapabilityChip[] = scanned.tools.map((t) => ({ name: t, derivation: "scanned" }));
  const skills: CapabilityChip[] = scanned.skills.map((s) => ({ name: s, derivation: "scanned" }));

  return {
    id: `duty:${name}`,
    kind: "duty",
    name,
    description: declared.description,
    ghost,
    proposalId,
    sourceRef,
    schedule: declared.schedule,
    watch: declared.watch,
    webhook: declared.webhook,
    tools,
    skills,
    ports: { eventsIn, eventsOut, beamsOut, queriesOut, queriesServed },
  };
}

async function deriveDutyNodes(api: DutyAPI, dutyDir: string): Promise<DutyNode[]> {
  const loader = new DutyLoader(dutyDir);
  const files = await loader.discoverDuties();
  const nodes: DutyNode[] = [];

  for (const filePath of files) {
    const statics = await loadDutyStatics(filePath);
    if (!statics) continue;
    let source = "";
    try {
      source = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    nodes.push(
      buildDutyNode(
        statics.name,
        source,
        statics,
        { origin: "file", path: filePath },
        false
      )
    );
  }

  // Ghost duty nodes from pending proposals — scan the proposed code directly,
  // since it isn't on disk yet. Note: this means ghosts only ever get
  // "scanned" topology, never "declared" — static events/beams/queries can
  // only be read via a real dynamic import (loadDutyStatics above), which
  // needs a real file on disk. Once approved and written, the next
  // derivation picks up the full declared data — confirmed via smoke test.
  const proposalStorage = new DutyProposalStorage(api);
  await proposalStorage.init();
  const pending = await proposalStorage.listPending();
  for (const p of pending) {
    nodes.push(
      buildDutyNode(p.dutyName, p.code, {}, { origin: "proposal" }, true, p.id)
    );
  }

  return nodes;
}

async function deriveContractAndSensorNodes(
  api: DutyAPI
): Promise<{ contracts: ContractNode[]; sensors: SensorNode[] }> {
  const storage = new ContractStorageV2(api);
  await storage.init();
  const rows = await storage.list();

  const proposalStorage = new ContractProposalStorage(api);
  await proposalStorage.init();
  const pending = await proposalStorage.listPending();

  const contracts: ContractNode[] = [];
  const sensors: SensorNode[] = [];

  for (const row of rows) {
    let cfg: any = {};
    try {
      cfg = JSON.parse(row.trigger_config);
    } catch {
      /* leave empty */
    }
    const triggerType = (row.trigger_type as ContractNode["triggerType"]) ?? "cron";
    let nextExecutions: string[] | undefined;
    if (triggerType === "cron" && cfg.expression) {
      try {
        nextExecutions = CronEvaluator.getNextExecutions(cfg.expression, 5).map((d: Date) =>
          d.toISOString()
        );
      } catch {
        /* leave undefined on unparsable expression */
      }
      sensors.push({
        id: `sensor:cron:${row.name}`,
        kind: "sensor",
        name: `${row.name}-cron`,
        ghost: false,
        sourceRef: { origin: "registry", registryId: row.name },
        sensorType: "cron",
        config: { expression: cfg.expression },
      });
    }

    contracts.push({
      id: `contract:${row.name}`,
      kind: "contract",
      name: row.name,
      description: row.description ?? undefined,
      ghost: false,
      sourceRef: { origin: "registry", registryId: String(row.id) },
      version: row.version,
      triggerType,
      cronExpression: triggerType === "cron" ? cfg.expression : undefined,
      eventName: triggerType === "event" ? cfg.eventType : undefined,
      webhookPath: triggerType === "webhook" ? cfg.path : undefined,
      nextExecutions,
      targetKind: "kata",
      targetName: row.target_kata,
      targetVersion: row.target_kata_version,
      active: !!row.enabled,
      approvalStatus: "live",
    });
  }

  for (const p of pending) {
    contracts.push({
      id: `contract:${p.contract.name}`,
      kind: "contract",
      name: p.contract.name,
      description: p.contract.description,
      ghost: true,
      proposalId: p.id,
      sourceRef: { origin: "proposal" },
      version: p.contract.version,
      triggerType: p.contract.triggerType as ContractNode["triggerType"],
      cronExpression: p.contract.triggerConfig.type === "cron" ? p.contract.triggerConfig.expression : undefined,
      eventName: p.contract.triggerConfig.type === "event" ? p.contract.triggerConfig.eventType : undefined,
      targetKind: "kata",
      targetName: p.contract.targetKata,
      targetVersion: p.contract.targetKataVersion,
      active: false,
      approvalStatus: "pending",
    });
  }

  return { contracts, sensors };
}

async function deriveKataNodes(api: DutyAPI): Promise<KataNode[]> {
  const storage = new KataStorage(api);
  await storage.init();
  const list = await storage.list();

  const nodes: KataNode[] = [];
  for (const k of list) {
    const row = await storage.getByVersion(k.name, k.version);
    let phases: KataNode["phases"] = [];
    if (row?.compiledGraph) {
      try {
        phases = Object.values(row.compiledGraph.phases ?? {}).map((p: any) => ({
          name: p.name,
          skill: p.action?.type === "run" ? p.action.skill : undefined,
          next: p.next,
        }));
      } catch {
        /* leave empty on malformed compiled graph */
      }
    }
    nodes.push({
      id: `kata:${k.name}@${k.version}`,
      kind: "kata",
      name: k.name,
      ghost: false,
      sourceRef: { origin: "registry", registryId: `${k.name}@${k.version}` },
      version: k.version,
      phases,
    });
  }
  return nodes;
}

function deriveDutySensorNodes(duties: DutyNode[]): SensorNode[] {
  const sensors: SensorNode[] = [];
  for (const d of duties) {
    if (d.schedule) {
      sensors.push({
        id: `sensor:cron:${d.name}`,
        kind: "sensor",
        name: `${d.name}-schedule`,
        ghost: d.ghost,
        sourceRef: d.sourceRef,
        sensorType: "cron",
        config: { expression: d.schedule },
      });
    }
    if (d.watch && d.watch.length > 0) {
      sensors.push({
        id: `sensor:watch:${d.name}`,
        kind: "sensor",
        name: `${d.name}-watch`,
        ghost: d.ghost,
        sourceRef: d.sourceRef,
        sensorType: "file-watch",
        config: { patterns: d.watch.join(", ") },
      });
    }
    if (d.webhook) {
      sensors.push({
        id: `sensor:webhook:${d.name}`,
        kind: "sensor",
        name: `${d.name}-webhook`,
        ghost: d.ghost,
        sourceRef: d.sourceRef,
        sensorType: "webhook",
        config: { path: d.webhook },
      });
    }
  }
  return sensors;
}

function deriveEdges(nodes: GraphNode[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const duties = nodes.filter((n): n is DutyNode => n.kind === "duty");
  const dutyById = new Map(duties.map((d) => [d.id, d]));
  const nodeIds = new Set(nodes.map((n) => n.id));
  let edgeCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${edgeCounter++}`;

  // Broadcast edges: match eventsOut on one duty to eventsIn on another.
  for (const source of duties) {
    for (const eventName of source.ports.eventsOut) {
      for (const target of duties) {
        if (target.id === source.id) continue;
        if (!target.ports.eventsIn.includes(eventName)) continue;
        edges.push({
          id: nextId("broadcast"),
          kind: "broadcast",
          sourceNodeId: source.id,
          targetNodeId: target.id,
          ghost: source.ghost || target.ghost,
          proposalId: source.proposalId ?? target.proposalId,
          derivation: "scanned",
          danglingTarget: false,
          eventName,
        } as BroadcastEdge);
      }
    }
  }

  // Beam edges: from each duty's declared/scanned beamsOut.
  for (const source of duties) {
    for (const beam of source.ports.beamsOut) {
      const targetId = `duty:${beam.target}`;
      const target = dutyById.get(targetId);
      edges.push({
        id: nextId("beam"),
        kind: "beam",
        sourceNodeId: source.id,
        targetNodeId: targetId,
        ghost: source.ghost || !!target?.ghost,
        proposalId: source.proposalId,
        derivation: beam.derivation,
        danglingTarget: !nodeIds.has(targetId),
        eventType: beam.eventType,
        targetDutyName: beam.target,
      } as BeamEdge);
    }
  }

  // Query edges: from each duty's declared/scanned queriesOut.
  for (const source of duties) {
    for (const q of source.ports.queriesOut) {
      const targetId = `duty:${q.target}`;
      const target = dutyById.get(targetId);
      edges.push({
        id: nextId("query"),
        kind: "query",
        sourceNodeId: source.id,
        targetNodeId: targetId,
        ghost: source.ghost || !!target?.ghost,
        proposalId: source.proposalId,
        derivation: q.derivation,
        danglingTarget: !nodeIds.has(targetId),
        queryType: q.queryType,
        targetDutyName: q.target,
        timeoutMs: q.timeoutMs ?? 5000,
      } as QueryEdge);
    }
  }

  // Contract-run edges: contract -> its target kata.
  for (const node of nodes) {
    if (node.kind !== "contract") continue;
    const targetId = `kata:${node.targetName}@${node.targetVersion ?? "v1"}`;
    edges.push({
      id: nextId("run"),
      kind: "contract-run",
      sourceNodeId: node.id,
      targetNodeId: targetId,
      ghost: node.ghost,
      proposalId: node.proposalId,
      derivation: "declared",
      danglingTarget: !nodeIds.has(targetId),
    } as ContractRunEdge);
  }

  return edges;
}

export async function deriveGraph(api: DutyAPI, options: { dutyDir?: string } = {}): Promise<DerivedGraph> {
  const duties = await deriveDutyNodes(api, options.dutyDir ?? "duties");
  const { contracts, sensors: contractSensors } = await deriveContractAndSensorNodes(api);
  const katas = await deriveKataNodes(api);
  const dutySensors = deriveDutySensorNodes(duties);

  const nodes: GraphNode[] = [...duties, ...contracts, ...katas, ...contractSensors, ...dutySensors];
  const edges = deriveEdges(nodes);

  return { nodes, edges, derivedAt: Date.now() };
}
