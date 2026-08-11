/**
 * graph-keeper — state-authority duty for the canvas editor's derived
 * topology graph (ARCHITECTURE.md §6 rule 1: nothing else writes this store).
 *
 * Sense: file-watch on duties/, contracts/, skills/, plus proposal-lifecycle
 * events; a 5-minute static schedule as a safety-net full re-derive.
 * Analyze: src/graph/derive.ts — declared statics + source scan + registry
 * reads for duties/contracts/katas, merged with provenance tags.
 * Respond: write the graph store (src/graph/store.ts), emit graph.updated.
 *
 * Serves queries: get-graph, get-subgraph, get-node, simulate-event.
 */

import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import { deriveGraph } from "../src/graph/derive.js";
import { GraphStore } from "../src/graph/store.js";
import { simulateEventPropagation } from "../src/graph/simulate.js";
import type { DerivedGraph } from "../src/graph/types.js";

interface QueryPayload {
  requestId: string;
  [key: string]: unknown;
}

export default class GraphKeeperDuty extends BaseDuty {
  static description = "Maintains the derived topology graph of duties, contracts, and katas.";
  static schedule = "*/5 * * * *"; // safety-net full re-derive
  static events = { in: [], out: ["graph.updated"] };

  private store: GraphStore;
  private deriveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(api: DutyAPI) {
    super(api);
    this.store = new GraphStore(api);
    this.registerSensors();
    this.registerQueryHandlers();
    console.log("🗺️  Graph Keeper ready");
  }

  async execute(): Promise<void> {
    await this.deriveAndSave();
  }

  private registerSensors(): void {
    const debouncedDerive = () => {
      if (this.deriveTimer) clearTimeout(this.deriveTimer);
      this.deriveTimer = setTimeout(() => {
        this.deriveAndSave().catch((err) =>
          console.error("[graph-keeper] Derivation failed:", err)
        );
      }, 500);
    };

    // Non-recursive by design (FilesAPI.watch only recurses when the pattern
    // string itself contains "*", which a real directory path never does) —
    // acceptable for v1 since duty/contract files are flat under these dirs.
    this.api.files.watch("duties", debouncedDerive);
    this.api.files.watch("contracts", debouncedDerive);
    this.api.files.watch("skills", debouncedDerive);

    const lifecycleEvents = [
      "duty_created",
      "duty_reloaded",
      "contract.proposal_approved",
      "contract.proposal_refused",
      "duty.proposal_approved",
      "duty.proposal_refused",
      "workflow.proposal_approved",
      "workflow.proposal_refused",
    ];
    for (const event of lifecycleEvents) {
      this.api.events.on(event, debouncedDerive);
    }
  }

  private async deriveAndSave(): Promise<void> {
    await this.deriveAndSaveReturning();
  }

  /** Bypasses the cached snapshot — used for the safety-net schedule/lifecycle
   *  events, and for a canvas client that just made a change (e.g. drafted a
   *  proposal) and wants to see it immediately rather than waiting for the
   *  next event-driven re-derive. */
  private async deriveAndSaveReturning(): Promise<DerivedGraph> {
    const graph = await deriveGraph(this.api);
    await this.store.save(graph);
    this.api.events.emit(
      "graph.updated",
      { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, derivedAt: graph.derivedAt },
      "graph-keeper"
    );
    return graph;
  }

  private registerQueryHandlers(): void {
    this.api.events.on("target:graph-keeper:get-graph", async (payload: unknown) => {
      const { requestId, force } = payload as QueryPayload & { force?: boolean };
      const graph = force ? await this.deriveAndSaveReturning() : await this.getOrDeriveGraph();
      this.api.events.reply(requestId, graph);
    });

    this.api.events.on("target:graph-keeper:get-subgraph", async (payload: unknown) => {
      const { requestId, kind, nameContains } = payload as QueryPayload & {
        kind?: string;
        nameContains?: string;
      };
      const graph = await this.getOrDeriveGraph();
      const nodes = graph.nodes.filter(
        (n) => (!kind || n.kind === kind) && (!nameContains || n.name.includes(nameContains))
      );
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = graph.edges.filter(
        (e) => nodeIds.has(e.sourceNodeId) || nodeIds.has(e.targetNodeId)
      );
      this.api.events.reply(requestId, { nodes, edges, derivedAt: graph.derivedAt });
    });

    this.api.events.on("target:graph-keeper:get-node", async (payload: unknown) => {
      const { requestId, id } = payload as QueryPayload & { id?: string };
      const graph = await this.getOrDeriveGraph();
      const node = graph.nodes.find((n) => n.id === id) ?? null;
      this.api.events.reply(requestId, node);
    });

    this.api.events.on("target:graph-keeper:simulate-event", async (payload: unknown) => {
      const { requestId, eventName, maxDepth } = payload as QueryPayload & {
        eventName?: string;
        maxDepth?: number;
      };
      if (!eventName) {
        this.api.events.reply(requestId, null, "simulate-event requires eventName");
        return;
      }
      const graph = await this.getOrDeriveGraph();
      const result = simulateEventPropagation(graph, eventName, maxDepth ?? 5);
      this.api.events.reply(requestId, result);
    });
  }

  private async getOrDeriveGraph(): Promise<DerivedGraph> {
    const stored = await this.store.load();
    if (stored) return stored;
    const graph = await deriveGraph(this.api);
    await this.store.save(graph);
    return graph;
  }
}
