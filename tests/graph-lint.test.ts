import { describe, it, expect } from "bun:test";
import { lintGraph } from "../src/graph/lint.js";
import type { DerivedGraph, DutyNode, ContractNode, BeamEdge, ContractRunEdge, BroadcastEdge } from "../src/graph/types.js";

function duty(overrides: Partial<DutyNode>): DutyNode {
  return {
    id: `duty:${overrides.name}`,
    kind: "duty",
    name: "d",
    ghost: false,
    sourceRef: { origin: "file" },
    tools: [],
    skills: [],
    ports: { eventsIn: [], eventsOut: [], beamsOut: [], queriesOut: [], queriesServed: [] },
    ...overrides,
  } as DutyNode;
}

function emptyGraph(): DerivedGraph {
  return { nodes: [], edges: [], derivedAt: Date.now() };
}

describe("lintGraph", () => {
  it("E-BEAM-TARGET: flags a beam edge with a dangling target", () => {
    const graph = emptyGraph();
    graph.nodes.push(duty({ name: "a" }));
    const edge: BeamEdge = {
      id: "e1", kind: "beam", sourceNodeId: "duty:a", targetNodeId: "duty:missing",
      ghost: false, derivation: "declared", danglingTarget: true,
      eventType: "ping", targetDutyName: "missing",
    };
    graph.edges.push(edge);
    const findings = lintGraph(graph);
    expect(findings.some((f) => f.code === "E-BEAM-TARGET")).toBe(true);
  });

  it("E-CONTRACT-TARGET: flags a contract-run edge with a dangling target", () => {
    const graph = emptyGraph();
    const edge: ContractRunEdge = {
      id: "e1", kind: "contract-run", sourceNodeId: "contract:x", targetNodeId: "kata:missing@v1",
      ghost: false, derivation: "declared", danglingTarget: true,
    };
    graph.edges.push(edge);
    const findings = lintGraph(graph);
    expect(findings.some((f) => f.code === "E-CONTRACT-TARGET")).toBe(true);
  });

  it("W-NO-REPLIER: flags a queried type nobody serves", () => {
    const graph = emptyGraph();
    graph.nodes.push(
      duty({
        name: "querier",
        ports: { eventsIn: [], eventsOut: [], beamsOut: [], queriesOut: [{ target: "x", queryType: "get-thing", derivation: "declared" }], queriesServed: [] },
      })
    );
    const findings = lintGraph(graph);
    expect(findings.some((f) => f.code === "W-NO-REPLIER" && f.message.includes("get-thing"))).toBe(true);
  });

  it("W-NO-REPLIER: does not flag when a duty serves the query type", () => {
    const graph = emptyGraph();
    graph.nodes.push(
      duty({ name: "querier", ports: { eventsIn: [], eventsOut: [], beamsOut: [], queriesOut: [{ target: "x", queryType: "get-thing", derivation: "declared" }], queriesServed: [] } }),
      duty({ name: "server", ports: { eventsIn: [], eventsOut: [], beamsOut: [], queriesOut: [], queriesServed: ["get-thing"] } })
    );
    const findings = lintGraph(graph);
    expect(findings.some((f) => f.code === "W-NO-REPLIER")).toBe(false);
  });

  it("W-ORPHAN-EVENT: flags an emitted event with zero consumers", () => {
    const graph = emptyGraph();
    graph.nodes.push(duty({ name: "a", ports: { eventsIn: [], eventsOut: ["lonely.event"], beamsOut: [], queriesOut: [], queriesServed: [] } }));
    const findings = lintGraph(graph);
    expect(findings.some((f) => f.code === "W-ORPHAN-EVENT" && f.message.includes("lonely.event"))).toBe(true);
  });

  it("W-DEAD-DUTY: flags a duty with no trigger path at all", () => {
    const graph = emptyGraph();
    graph.nodes.push(duty({ name: "isolated" }));
    const findings = lintGraph(graph);
    expect(findings.some((f) => f.code === "W-DEAD-DUTY")).toBe(true);
  });

  it("W-DEAD-DUTY: does not flag a duty with a schedule", () => {
    const graph = emptyGraph();
    graph.nodes.push(duty({ name: "scheduled", schedule: "0 9 * * *" }));
    const findings = lintGraph(graph);
    expect(findings.some((f) => f.code === "W-DEAD-DUTY")).toBe(false);
  });

  it("W-UNDECLARED: flags a scanned-only beam", () => {
    const graph = emptyGraph();
    graph.nodes.push(
      duty({
        name: "a",
        ports: { eventsIn: [], eventsOut: [], beamsOut: [{ target: "b", eventType: "x", derivation: "scanned" }], queriesOut: [], queriesServed: [] },
      })
    );
    const findings = lintGraph(graph);
    expect(findings.some((f) => f.code === "W-UNDECLARED")).toBe(true);
  });

  it("W-DRIFT: flags a live-registered event that no duty declares or has scanned", () => {
    const graph = emptyGraph();
    graph.nodes.push(duty({ name: "a" }));
    const findings = lintGraph(graph, { registeredEvents: ["mystery.event"] });
    expect(findings.some((f) => f.code === "W-DRIFT" && f.message.includes("mystery.event"))).toBe(true);
  });

  it("W-CYCLE: detects a two-node event cycle", () => {
    const graph = emptyGraph();
    graph.nodes.push(duty({ name: "a" }), duty({ name: "b" }));
    const e1: BroadcastEdge = { id: "e1", kind: "broadcast", sourceNodeId: "duty:a", targetNodeId: "duty:b", ghost: false, derivation: "scanned", danglingTarget: false, eventName: "ping" };
    const e2: BroadcastEdge = { id: "e2", kind: "broadcast", sourceNodeId: "duty:b", targetNodeId: "duty:a", ghost: false, derivation: "scanned", danglingTarget: false, eventName: "pong" };
    graph.edges.push(e1, e2);
    const findings = lintGraph(graph);
    expect(findings.some((f) => f.code === "W-CYCLE")).toBe(true);
  });

  it("W-CRON-COLLIDE: flags two contracts sharing an exact cron expression", () => {
    const graph = emptyGraph();
    const mk = (name: string): ContractNode => ({
      id: `contract:${name}`, kind: "contract", name, ghost: false, sourceRef: { origin: "registry" },
      version: "v1", triggerType: "cron", cronExpression: "0 9 * * *", targetKind: "kata", targetName: "x", active: true, approvalStatus: "live",
    });
    graph.nodes.push(mk("a"), mk("b"));
    const findings = lintGraph(graph);
    expect(findings.some((f) => f.code === "W-CRON-COLLIDE")).toBe(true);
  });

  it("W-GRAVEYARD: flags when ghost node count exceeds threshold", () => {
    const graph = emptyGraph();
    for (let i = 0; i < 12; i++) {
      graph.nodes.push(duty({ name: `ghost${i}`, ghost: true, proposalId: `p${i}` }));
    }
    const findings = lintGraph(graph, { graveyardThreshold: 10 });
    expect(findings.some((f) => f.code === "W-GRAVEYARD")).toBe(true);
  });

  it("no false positives on a clean, fully-wired graph", () => {
    const graph = emptyGraph();
    graph.nodes.push(
      duty({ name: "sensor-owner", schedule: "0 9 * * *", ports: { eventsIn: [], eventsOut: ["x.done"], beamsOut: [], queriesOut: [], queriesServed: [] } }),
      duty({ name: "consumer", ports: { eventsIn: ["x.done"], eventsOut: [], beamsOut: [], queriesOut: [], queriesServed: [] } })
    );
    const findings = lintGraph(graph);
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(findings.some((f) => f.code === "W-DEAD-DUTY")).toBe(false);
    expect(findings.some((f) => f.code === "W-ORPHAN-EVENT")).toBe(false);
  });
});
