/**
 * Ronin Canvas Editor — derived graph data model.
 *
 * Corrected against the real codebase (see design plan): no "budget"/"persona"/
 * trust-tier fields (none exist on BaseDuty), event-hub is a render-only
 * concept (not modeled here — the spec itself says so), ContractStorageV2 not
 * ContractRegistry, real CronEvaluator for next-execution times.
 */

export type NodeKind = "duty" | "contract" | "kata" | "sensor";
export type Derivation = "declared" | "scanned" | "runtime";

export interface SourceRef {
  origin: "file" | "registry" | "proposal";
  path?: string;
  registryId?: string;
}

export interface BaseNode {
  id: string; // `${kind}:${name}` (+ `@${version}` where versioned)
  kind: NodeKind;
  name: string;
  description?: string;
  ghost: boolean;
  proposalId?: string;
  sourceRef: SourceRef;
}

export interface CapabilityChip {
  name: string;
  derivation: Derivation;
}

export interface BeamDecl {
  target: string;
  eventType: string;
  derivation: Derivation;
}

export interface QueryOutDecl {
  target: string;
  queryType: string;
  timeoutMs?: number;
  derivation: Derivation;
}

export interface DutyNode extends BaseNode {
  kind: "duty";
  maxTokens?: number;
  tools: CapabilityChip[];
  skills: CapabilityChip[];
  schedule?: string;
  watch?: string[];
  webhook?: string;
  ports: {
    eventsIn: string[];
    eventsOut: string[];
    beamsOut: BeamDecl[];
    queriesOut: QueryOutDecl[];
    queriesServed: string[];
  };
}

export interface ContractNode extends BaseNode {
  kind: "contract";
  version: string;
  triggerType: "cron" | "event" | "webhook";
  cronExpression?: string;
  eventName?: string;
  webhookPath?: string;
  nextExecutions?: string[]; // ISO strings, cron triggers only
  /** Always "kata" today — the real schema (contracts_v2) has no target-duty column. */
  targetKind: "kata";
  targetName: string;
  targetVersion?: string;
  active: boolean;
  approvalStatus: "live" | "pending";
}

export interface KataNode extends BaseNode {
  kind: "kata";
  version: string;
  phases: Array<{ name: string; skill?: string; next?: string }>;
}

export interface SensorNode extends BaseNode {
  kind: "sensor";
  sensorType: "cron" | "file-watch" | "webhook";
  config: Record<string, string>;
}

export type GraphNode = DutyNode | ContractNode | KataNode | SensorNode;

export type EdgeKind = "broadcast" | "beam" | "query" | "contract-run";

export interface BaseEdge {
  id: string;
  kind: EdgeKind;
  sourceNodeId: string;
  targetNodeId: string;
  ghost: boolean;
  proposalId?: string;
  derivation: Derivation;
  /** True when targetNodeId does not resolve to a real node in this graph — surfaced for lint, never silently dropped. */
  danglingTarget: boolean;
}

export interface BroadcastEdge extends BaseEdge {
  kind: "broadcast";
  eventName: string;
}

export interface BeamEdge extends BaseEdge {
  kind: "beam";
  eventType: string;
  targetDutyName: string;
}

export interface QueryEdge extends BaseEdge {
  kind: "query";
  queryType: string;
  targetDutyName: string;
  timeoutMs: number;
}

export interface ContractRunEdge extends BaseEdge {
  kind: "contract-run";
}

export type GraphEdge = BroadcastEdge | BeamEdge | QueryEdge | ContractRunEdge;

export interface DerivedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  derivedAt: number;
}

/** Result of scanning one duty's source text for imperative event/tool usage. */
export interface ScannedDutyTopology {
  eventsIn: string[];
  eventsOut: string[];
  beamsOut: Array<{ target: string; eventType: string }>;
  queriesOut: Array<{ target: string; queryType: string }>;
  queriesServed: string[];
  tools: string[];
  skills: string[];
}
