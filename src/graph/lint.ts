/**
 * Lint rule set for the derived graph (design plan §2.6). E-STORAGE-SPLIT is
 * dropped (the V1/V2 contract/kata split it detected was already reconciled
 * this session). W-SIMILAR uses token-overlap (Jaccard on duty descriptions)
 * instead of Kokoro embeddings — no embeddings provider exists in Ronin today.
 *
 * Pure function: takes a DerivedGraph (+ optional live runtime event names
 * for W-DRIFT) and returns findings. No I/O, no side effects — easy to test,
 * easy to call from graph-linter's Analyze phase.
 */

import type { DerivedGraph, DutyNode, ContractNode } from "./types.js";

export type LintSeverity = "error" | "warn" | "info";

export interface LintFinding {
  code: string;
  severity: LintSeverity;
  message: string;
  nodeIds: string[];
  edgeIds: string[];
}

export interface LintOptions {
  /** Live event names currently registered on the process's event bus (api.events.getRegisteredEvents()), for W-DRIFT. Omit to skip that rule. */
  registeredEvents?: string[];
  graveyardThreshold?: number;
  similarityThreshold?: number;
}

function duties(graph: DerivedGraph): DutyNode[] {
  return graph.nodes.filter((n): n is DutyNode => n.kind === "duty");
}

function eBeamTarget(graph: DerivedGraph): LintFinding[] {
  return graph.edges
    .filter((e) => e.kind === "beam" && e.danglingTarget)
    .map((e) => ({
      code: "E-BEAM-TARGET",
      severity: "error" as const,
      message: `${e.sourceNodeId} beams to '${(e as any).targetDutyName}', which is not a registered duty`,
      nodeIds: [e.sourceNodeId],
      edgeIds: [e.id],
    }));
}

function eContractTarget(graph: DerivedGraph): LintFinding[] {
  return graph.edges
    .filter((e) => e.kind === "contract-run" && e.danglingTarget)
    .map((e) => ({
      code: "E-CONTRACT-TARGET",
      severity: "error" as const,
      message: `${e.sourceNodeId} targets '${e.targetNodeId}', which does not exist`,
      nodeIds: [e.sourceNodeId],
      edgeIds: [e.id],
    }));
}

function wNoReplier(graph: DerivedGraph): LintFinding[] {
  const ds = duties(graph);
  const servedTypes = new Set(ds.flatMap((d) => d.ports.queriesServed));
  const findings: LintFinding[] = [];
  const seen = new Set<string>();
  for (const d of ds) {
    for (const q of d.ports.queriesOut) {
      if (servedTypes.has(q.queryType) || seen.has(q.queryType)) continue;
      seen.add(q.queryType);
      const queriers = ds.filter((dd) => dd.ports.queriesOut.some((qq) => qq.queryType === q.queryType));
      findings.push({
        code: "W-NO-REPLIER",
        severity: "warn",
        message: `Query type '${q.queryType}' has no duty serving it — it will always time out`,
        nodeIds: queriers.map((dd) => dd.id),
        edgeIds: [],
      });
    }
  }
  return findings;
}

function wOrphanEvent(graph: DerivedGraph): LintFinding[] {
  const ds = duties(graph);
  const allConsumed = new Set(ds.flatMap((d) => d.ports.eventsIn));
  const findings: LintFinding[] = [];
  const seen = new Set<string>();
  for (const d of ds) {
    for (const eventName of d.ports.eventsOut) {
      const key = `${d.id}:${eventName}`;
      if (allConsumed.has(eventName) || seen.has(key)) continue;
      seen.add(key);
      findings.push({
        code: "W-ORPHAN-EVENT",
        severity: "warn",
        message: `'${eventName}' is emitted by ${d.name} but nothing consumes it`,
        nodeIds: [d.id],
        edgeIds: [],
      });
    }
  }
  return findings;
}

function wDeadDuty(graph: DerivedGraph): LintFinding[] {
  const ds = duties(graph);
  const beamTargets = new Set(ds.flatMap((d) => d.ports.beamsOut.map((b) => b.target)));
  return ds
    .filter(
      (d) =>
        !d.schedule &&
        (!d.watch || d.watch.length === 0) &&
        !d.webhook &&
        d.ports.eventsIn.length === 0 &&
        !beamTargets.has(d.name)
    )
    .map((d) => ({
      code: "W-DEAD-DUTY",
      severity: "warn" as const,
      message: `${d.name} has no trigger path — no schedule, watch, webhook, consumed events, or incoming beams`,
      nodeIds: [d.id],
      edgeIds: [],
    }));
}

function wUndeclared(graph: DerivedGraph): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const d of duties(graph)) {
    for (const b of d.ports.beamsOut) {
      if (b.derivation !== "scanned") continue;
      findings.push({
        code: "W-UNDECLARED",
        severity: "warn",
        message: `${d.name} beams to '${b.target}' (${b.eventType}) but doesn't declare it in static beams`,
        nodeIds: [d.id],
        edgeIds: [],
      });
    }
    for (const q of d.ports.queriesOut) {
      if (q.derivation !== "scanned") continue;
      findings.push({
        code: "W-UNDECLARED",
        severity: "warn",
        message: `${d.name} queries '${q.target}' (${q.queryType}) but doesn't declare it in static queries`,
        nodeIds: [d.id],
        edgeIds: [],
      });
    }
  }
  return findings;
}

function wDrift(graph: DerivedGraph, registeredEvents?: string[]): LintFinding[] {
  if (!registeredEvents) return [];
  const ds = duties(graph);
  const declaredOrScanned = new Set(ds.flatMap((d) => [...d.ports.eventsIn, ...d.ports.eventsOut]));
  const registered = new Set(registeredEvents);
  const findings: LintFinding[] = [];

  for (const name of registered) {
    if (!declaredOrScanned.has(name)) {
      findings.push({
        code: "W-DRIFT",
        severity: "warn",
        message: `'${name}' is registered live but not declared or scanned in any duty (registered but never declared)`,
        nodeIds: [],
        edgeIds: [],
      });
    }
  }
  for (const name of ds.flatMap((d) => d.ports.eventsIn)) {
    if (!registered.has(name)) {
      findings.push({
        code: "W-DRIFT",
        severity: "warn",
        message: `'${name}' is declared/scanned as consumed but has no live handler registered right now (declared but never registered)`,
        nodeIds: [],
        edgeIds: [],
      });
    }
  }
  return findings;
}

function wCycle(graph: DerivedGraph): LintFinding[] {
  const adjacency = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind !== "broadcast") continue;
    if (!adjacency.has(e.sourceNodeId)) adjacency.set(e.sourceNodeId, new Set());
    adjacency.get(e.sourceNodeId)!.add(e.targetNodeId);
  }

  const findings: LintFinding[] = [];
  const reportedCycles = new Set<string>();
  const visited = new Set<string>();

  function dfs(start: string, node: string, path: string[], onStack: Set<string>) {
    onStack.add(node);
    path.push(node);
    for (const next of adjacency.get(node) ?? []) {
      if (next === start && path.length > 0) {
        const key = [...path].sort().join(",");
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          findings.push({
            code: "W-CYCLE",
            severity: "warn",
            message: `Event cycle: ${[...path, start].join(" → ")}`,
            nodeIds: [...path],
            edgeIds: [],
          });
        }
      } else if (!onStack.has(next) && path.length < 8) {
        dfs(start, next, path, onStack);
      }
    }
    path.pop();
    onStack.delete(node);
  }

  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;
    visited.add(node);
    dfs(node, node, [], new Set());
  }

  return findings;
}

function wCronCollide(graph: DerivedGraph): LintFinding[] {
  const contracts = graph.nodes.filter((n): n is ContractNode => n.kind === "contract" && n.triggerType === "cron" && !!n.cronExpression);
  const byExpr = new Map<string, ContractNode[]>();
  for (const c of contracts) {
    const key = c.cronExpression!;
    if (!byExpr.has(key)) byExpr.set(key, []);
    byExpr.get(key)!.push(c);
  }
  const findings: LintFinding[] = [];
  for (const [expr, group] of byExpr) {
    if (group.length < 2) continue;
    findings.push({
      code: "W-CRON-COLLIDE",
      severity: "info",
      message: `${group.length} contracts share the schedule '${expr}': ${group.map((c) => c.name).join(", ")}`,
      nodeIds: group.map((c) => c.id),
      edgeIds: [],
    });
  }
  return findings;
}

/** Jaccard token-overlap similarity — cheap, dependency-free stand-in for embeddings. */
function jaccard(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const tb = new Set(b.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function wSimilar(graph: DerivedGraph, threshold: number): LintFinding[] {
  const ds = duties(graph).filter((d) => d.description);
  const findings: LintFinding[] = [];
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i]!;
      const b = ds[j]!;
      const sharesEvent = a.ports.eventsIn.some((e) => b.ports.eventsIn.includes(e));
      if (!sharesEvent) continue;
      const score = jaccard(a.description!, b.description!);
      if (score > threshold) {
        findings.push({
          code: "W-SIMILAR",
          severity: "info",
          message: `${a.name} and ${b.name} consume the same event and have similar descriptions (${(score * 100).toFixed(0)}% token overlap) — possible duplication`,
          nodeIds: [a.id, b.id],
          edgeIds: [],
        });
      }
    }
  }
  return findings;
}

function wGraveyard(graph: DerivedGraph, threshold: number): LintFinding[] {
  const ghosts = graph.nodes.filter((n) => n.ghost);
  if (ghosts.length <= threshold) return [];
  return [
    {
      code: "W-GRAVEYARD",
      severity: "info",
      message: `${ghosts.length} open proposals exceed the graveyard threshold (${threshold})`,
      nodeIds: ghosts.map((g) => g.id),
      edgeIds: [],
    },
  ];
}

export function lintGraph(graph: DerivedGraph, options: LintOptions = {}): LintFinding[] {
  return [
    ...eBeamTarget(graph),
    ...eContractTarget(graph),
    ...wNoReplier(graph),
    ...wOrphanEvent(graph),
    ...wDeadDuty(graph),
    ...wUndeclared(graph),
    ...wDrift(graph, options.registeredEvents),
    ...wCycle(graph),
    ...wCronCollide(graph),
    ...wSimilar(graph, options.similarityThreshold ?? 0.7),
    ...wGraveyard(graph, options.graveyardThreshold ?? 10),
  ];
}
