/**
 * Simulated dry-run (design plan §2.7/§7.3): pure registry-walk propagation
 * from the already-derived graph — no side effects, no tools actually run,
 * no AI calls. This is deliberately a simplification, not a real execution
 * trace: it assumes every duty that consumes an event goes on to emit
 * everything in its own declared/scanned eventsOut, which isn't how real
 * conditional duty logic works. It answers "what's reachable from here,"
 * not "what will actually happen" — the real event-monitor capture stream
 * (execution overlay, a separate feature) is the source of truth for that.
 */

import type { DerivedGraph, DutyNode } from "./types.js";

export interface SimulationStep {
  depth: number;
  dutyId: string;
  dutyName: string;
  triggeredByEvent: string;
  emits: string[];
}

export interface SimulationResult {
  startEvent: string;
  steps: SimulationStep[];
  /** Event names that were reached more than once — the walk stops re-descending into them, consistent with W-CYCLE. */
  cyclesStoppedAt: string[];
}

export function simulateEventPropagation(
  graph: DerivedGraph,
  startEventName: string,
  maxDepth = 5
): SimulationResult {
  const duties = graph.nodes.filter((n): n is DutyNode => n.kind === "duty");
  const steps: SimulationStep[] = [];
  const cyclesStoppedAt: string[] = [];
  const visitedEvents = new Set<string>([startEventName]);
  const visitedDuties = new Set<string>();

  let frontier = [startEventName];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    const nextFrontier: string[] = [];

    for (const eventName of frontier) {
      const consumers = duties.filter((d) => d.ports.eventsIn.includes(eventName));
      for (const duty of consumers) {
        // A duty that's already fired in this simulation doesn't fire again
        // for the same walk — prevents infinite loops on real event cycles
        // (see W-CYCLE) while still letting the same duty appear once.
        if (visitedDuties.has(duty.id)) continue;
        visitedDuties.add(duty.id);

        const emits = duty.ports.eventsOut;
        steps.push({ depth, dutyId: duty.id, dutyName: duty.name, triggeredByEvent: eventName, emits });

        for (const emitted of emits) {
          if (visitedEvents.has(emitted)) {
            cyclesStoppedAt.push(emitted);
            continue;
          }
          visitedEvents.add(emitted);
          nextFrontier.push(emitted);
        }
      }
    }

    frontier = nextFrontier;
    depth++;
  }

  return { startEvent: startEventName, steps, cyclesStoppedAt };
}
