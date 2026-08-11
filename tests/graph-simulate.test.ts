import { describe, it, expect } from "bun:test";
import { simulateEventPropagation } from "../src/graph/simulate.js";
import type { DerivedGraph, DutyNode } from "../src/graph/types.js";

function duty(name: string, eventsIn: string[], eventsOut: string[]): DutyNode {
  return {
    id: `duty:${name}`,
    kind: "duty",
    name,
    ghost: false,
    sourceRef: { origin: "file" },
    tools: [],
    skills: [],
    ports: { eventsIn, eventsOut, beamsOut: [], queriesOut: [], queriesServed: [] },
  };
}

function graphOf(nodes: DutyNode[]): DerivedGraph {
  return { nodes, edges: [], derivedAt: Date.now() };
}

describe("simulateEventPropagation", () => {
  it("finds a direct consumer and its downstream emission", () => {
    const graph = graphOf([
      duty("a", ["start"], ["a.done"]),
      duty("b", ["a.done"], []),
    ]);
    const result = simulateEventPropagation(graph, "start");
    expect(result.steps.map((s) => s.dutyName)).toEqual(["a", "b"]);
    expect(result.steps[0].depth).toBe(0);
    expect(result.steps[1].depth).toBe(1);
    expect(result.steps[1].triggeredByEvent).toBe("a.done");
  });

  it("returns no steps when nothing consumes the starting event", () => {
    const graph = graphOf([duty("a", ["something.else"], [])]);
    const result = simulateEventPropagation(graph, "start");
    expect(result.steps).toEqual([]);
  });

  it("stops descending into a cycle rather than looping forever", () => {
    const graph = graphOf([
      duty("a", ["ping"], ["pong"]),
      duty("b", ["pong"], ["ping"]), // b re-emits the original trigger — a cycle
    ]);
    const result = simulateEventPropagation(graph, "ping", 10);
    // a fires (triggered by ping), b fires (triggered by pong) — then "ping"
    // is already visited, so the walk stops instead of re-firing a forever.
    expect(result.steps.map((s) => s.dutyName)).toEqual(["a", "b"]);
    expect(result.cyclesStoppedAt).toContain("ping");
  });

  it("does not fire the same duty twice even if reachable via two paths", () => {
    const graph = graphOf([
      duty("source", ["start"], ["x", "y"]),
      duty("sink", ["x", "y"], []),
    ]);
    const result = simulateEventPropagation(graph, "start");
    const sinkSteps = result.steps.filter((s) => s.dutyName === "sink");
    expect(sinkSteps.length).toBe(1);
  });

  it("respects maxDepth", () => {
    const graph = graphOf([
      duty("a", ["e0"], ["e1"]),
      duty("b", ["e1"], ["e2"]),
      duty("c", ["e2"], ["e3"]),
    ]);
    const result = simulateEventPropagation(graph, "e0", 1);
    // depth 0: a fires (triggered by e0). depth 1 would be b (triggered by e1),
    // but maxDepth=1 means the loop body runs for depth 0 only before the
    // depth < maxDepth check fails — so only a's step is recorded.
    expect(result.steps.map((s) => s.dutyName)).toEqual(["a"]);
  });
});
