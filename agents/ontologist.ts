/**
 * Ontologist Agent — passive observer that builds the knowledge graph.
 * Listens to plan, skill, task, and lifecycle events; writes nodes and edges.
 * On startup, bootstraps the graph from existing agents, plugins, and skills.
 * Never executes tasks, never modifies execution, never selects skills.
 */

import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

const FAILURE_ARCHIVE_DAYS = 90;

export default class OntologistAgent extends BaseAgent {
  static schedule = "0 3 * * *"; // Daily at 3 AM for cleanup

  constructor(api: AgentAPI) {
    super(api);

    if (!api.ontology) {
      console.warn("[ontologist] Ontology plugin not loaded; agent will no-op.");
      return;
    }

    this.registerEventListeners();
    this.bootstrap().catch((err) =>
      console.error("[ontologist] Bootstrap error:", err)
    );

    console.log("[ontologist] Listening for events and bootstrapping graph.");
  }

  /**
   * Register all event listeners that build the knowledge graph.
   */
  private registerEventListeners(): void {
    // ── Plan lifecycle ──────────────────────────────────────────────
    this.api.events.on("PlanProposed", (data: unknown) => {
      this.handlePlanProposed(data).catch((err) =>
        console.error("[ontologist] PlanProposed:", err)
      );
    });
    this.api.events.on("PlanApproved", (data: unknown) => {
      this.handlePlanApproved(data).catch((err) =>
        console.error("[ontologist] PlanApproved:", err)
      );
    });
    this.api.events.on("PlanCompleted", (data: unknown) => {
      this.handlePlanCompleted(data).catch((err) =>
        console.error("[ontologist] PlanCompleted:", err)
      );
    });
    this.api.events.on("PlanFailed", (data: unknown) => {
      this.handlePlanFailed(data).catch((err) =>
        console.error("[ontologist] PlanFailed:", err)
      );
    });
    this.api.events.on("PlanBlocked", (data: unknown) => {
      this.handlePlanBlocked(data).catch((err) =>
        console.error("[ontologist] PlanBlocked:", err)
      );
    });
    this.api.events.on("PlanRejected", (data: unknown) => {
      this.handlePlanRejected(data).catch((err) =>
        console.error("[ontologist] PlanRejected:", err)
      );
    });

    // ── Task card events (from tasking agent) ───────────────────────
    this.api.events.on("TaskCreated", (data: unknown) => {
      this.handleTaskCreated(data).catch((err) =>
        console.error("[ontologist] TaskCreated:", err)
      );
    });
    this.api.events.on("TaskMoved", (data: unknown) => {
      this.handleTaskMoved(data).catch((err) =>
        console.error("[ontologist] TaskMoved:", err)
      );
    });

    // ── Skill events ────────────────────────────────────────────────
    this.api.events.on("new-skill", (data: unknown) => {
      this.handleNewSkill(data).catch((err) =>
        console.error("[ontologist] new-skill:", err)
      );
    });
    this.api.events.on("skill-used", (data: unknown) => {
      this.handleSkillUsed(data).catch((err) =>
        console.error("[ontologist] skill-used:", err)
      );
    });
    this.api.events.on("skill.use.failed", (data: unknown) => {
      this.handleSkillFailed(data).catch((err) =>
        console.error("[ontologist] skill.use.failed:", err)
      );
    });

    // ── Agent lifecycle / failures ──────────────────────────────────
    this.api.events.on("agent.lifecycle", (data: unknown) => {
      this.handleAgentLifecycle(data).catch((err) =>
        console.error("[ontologist] agent.lifecycle:", err)
      );
    });
    this.api.events.on("agent.task.failed", (data: unknown) => {
      this.handleTaskFailed(data).catch((err) =>
        console.error("[ontologist] agent.task.failed:", err)
      );
    });
    this.api.events.on("retry.task", (data: unknown) => {
      this.handleRetryTask(data).catch((err) =>
        console.error("[ontologist] retry.task:", err)
      );
    });

    // ── AI usage tracking ───────────────────────────────────────────
    this.api.events.on("ai.completion", (data: unknown) => {
      this.handleAICompletion(data).catch((err) =>
        console.error("[ontologist] ai.completion:", err)
      );
    });

    // ── Generic ontology record (any agent can emit nodes/edges) ─────
    this.api.events.on("ontology.record", (data: unknown) => {
      this.handleOntologyRecord(data).catch((err) =>
        console.error("[ontologist] ontology.record:", err)
      );
    });

    // ── Chat conversations (Telegram, Discord, Chatty) ─────────────
    this.api.events.on("chat.conversation", (data: unknown) => {
      this.handleChatConversation(data).catch((err) =>
        console.error("[ontologist] chat.conversation:", err)
      );
    });
  }

  /**
   * Apply nodes and edges to the graph. Single path for ontology.record and
   * deciphered domain events. Normalizes metadata to string; logs per-item errors.
   */
  private async applyRecord(
    nodes: Array<{
      id: string;
      type: string;
      name?: string | null;
      summary?: string | null;
      metadata?: string | Record<string, unknown> | null;
      domain?: string;
      confidence?: number;
      sensitivity?: string;
    }>,
    edges: Array<{
      id: string;
      from_id: string;
      to_id: string;
      relation: string;
      metadata?: string | Record<string, unknown> | null;
      confidence?: number;
    }>
  ): Promise<void> {
    if (!this.api.ontology) return;
    const onto = this.api.ontology;
    for (const n of nodes) {
      try {
        const meta = n.metadata == null ? undefined : typeof n.metadata === "string" ? n.metadata : JSON.stringify(n.metadata);
        await onto.setNode({
          id: n.id,
          type: n.type,
          name: n.name ?? undefined,
          summary: n.summary ?? undefined,
          metadata: meta,
          domain: n.domain ?? "system",
          confidence: n.confidence ?? 1,
          sensitivity: n.sensitivity ?? "internal",
        });
      } catch (err) {
        console.error("[ontologist] applyRecord node failed:", n.id, err);
      }
    }
    for (const e of edges) {
      try {
        const meta = e.metadata == null ? undefined : typeof e.metadata === "string" ? e.metadata : JSON.stringify(e.metadata);
        await onto.setEdge({
          id: e.id,
          from_id: e.from_id,
          to_id: e.to_id,
          relation: e.relation,
          metadata: meta,
          confidence: e.confidence ?? 1,
        });
      } catch (err) {
        console.error("[ontologist] applyRecord edge failed:", e.id, err);
      }
    }
  }

  private async handleOntologyRecord(data: unknown): Promise<void> {
    const payload = data as { nodes?: unknown[]; edges?: unknown[]; source?: string };
    const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
    const edges = Array.isArray(payload?.edges) ? payload.edges : [];
    if (nodes.length === 0 && edges.length === 0) return;
    const normalizedNodes = nodes.map((n: unknown) => {
      const o = n as Record<string, unknown>;
      return {
        id: String(o?.id ?? ""),
        type: String(o?.type ?? "Event"),
        name: o?.name != null ? String(o.name) : null,
        summary: o?.summary != null ? String(o.summary) : null,
        metadata: o?.metadata,
        domain: o?.domain != null ? String(o.domain) : undefined,
        confidence: o?.confidence != null ? Number(o.confidence) : undefined,
        sensitivity: o?.sensitivity != null ? String(o.sensitivity) : undefined,
      };
    }).filter((n) => n.id && n.type);
    const normalizedEdges = edges.map((e: unknown) => {
      const o = e as Record<string, unknown>;
      return {
        id: String(o?.id ?? `edge-${o?.from_id}-${o?.to_id}-${Date.now()}`),
        from_id: String(o?.from_id ?? ""),
        to_id: String(o?.to_id ?? ""),
        relation: String(o?.relation ?? "related_to"),
        metadata: o?.metadata,
        confidence: o?.confidence != null ? Number(o.confidence) : undefined,
      };
    }).filter((e) => e.from_id && e.to_id);
    await this.applyRecord(normalizedNodes, normalizedEdges);
  }

  private async handleChatConversation(data: unknown): Promise<void> {
    const payload = data as {
      source?: string;
      sourceChannel?: string;
      sourceUser?: string;
      userMessage?: string;
      assistantReply?: string;
      timestamp?: number;
    };
    const source = payload?.source ?? "chat";
    const userMsg = (payload?.userMessage ?? "").slice(0, 200);
    const assistantMsg = (payload?.assistantReply ?? "").slice(0, 200);
    const ts = payload?.timestamp ?? Date.now();
    const channelOrId = (payload?.sourceChannel ?? "").trim() || (source === "chatty" ? `chatty-${ts}` : String(ts));
    const conversationId = `Conversation-${source}-${channelOrId}-${ts}`;
    const agentName = source === "chatty" ? "chatty" : "intent-ingress";
    const summary = `User: ${userMsg}${userMsg.length >= 200 ? "..." : ""} → ${assistantMsg}${assistantMsg.length >= 200 ? "..." : ""}`;
    const name = source === "telegram" ? "Telegram chat" : source === "discord" ? "Discord chat" : "Chatty";
    const node = {
      id: conversationId,
      type: "Conversation",
      name,
      summary,
      metadata: JSON.stringify({
        source,
        sourceChannel: payload?.sourceChannel,
        sourceUser: payload?.sourceUser,
        timestamp: ts,
      }),
      domain: "chat",
    };
    const edge = {
      id: `edge-${conversationId}-Agent-${agentName}`,
      from_id: conversationId,
      to_id: `Agent-${agentName}`,
      relation: "handled_by",
    };
    await this.applyRecord([node], [edge]);
  }

  // ── Bootstrap: seed graph from existing system state ──────────────

  /**
   * On startup, scan existing agents, plugins, and skills to create
   * foundational nodes so the graph isn't empty until events fire.
   */
  private async bootstrap(): Promise<void> {
    if (!this.api.ontology) return;
    const onto = this.api.ontology;

    // Seed the Ronin system node
    await onto.setNode({
      id: "System-ronin",
      type: "System",
      name: "Ronin",
      summary: "The Ronin agent framework",
      domain: "system",
    });

    // Seed loaded plugins
    const pluginNames = this.api.plugins.list();
    for (const name of pluginNames) {
      await onto.setNode({
        id: `Plugin-${name}`,
        type: "Plugin",
        name,
        domain: "system",
      });
      await onto.setEdge({
        id: `edge-System-ronin-Plugin-${name}`,
        from_id: "System-ronin",
        to_id: `Plugin-${name}`,
        relation: "has_plugin",
      });
    }

    // Seed known skills
    if (this.api.skills) {
      try {
        const skills = await this.api.skills.discoverSkills("");
        if (Array.isArray(skills)) {
          for (const skill of skills) {
            const skillName = typeof skill === "string" ? skill : (skill as any)?.name ?? (skill as any)?.skill_name;
            if (!skillName) continue;
            await onto.setNode({
              id: `Skill-${skillName}`,
              type: "Skill",
              name: skillName,
              summary: (skill as any)?.description ?? undefined,
              domain: "skills",
            });
          }
        }
      } catch {
        // Skills plugin may not support discoverSkills with empty string
      }
    }

    // Seed registered HTTP routes as nodes
    try {
      const routes = this.api.http.getRoutes?.();
      if (Array.isArray(routes)) {
        for (const route of routes) {
          const path = typeof route === "string" ? route : (route as any)?.path;
          if (!path) continue;
          await onto.setNode({
            id: `Route-${path}`,
            type: "Route",
            name: path,
            domain: "system",
          });
        }
      }
    } catch {
      // getRoutes may not exist
    }

    const stats = await onto.stats();
    const nodeCount = Object.values(stats.nodes).reduce((a, b) => a + b, 0);
    const edgeCount = Object.values(stats.edges).reduce((a, b) => a + b, 0);
    console.log(`[ontologist] Bootstrap complete: ${nodeCount} nodes, ${edgeCount} edges`);
  }

  async execute(): Promise<void> {
    if (!this.api.ontology) return;
    await this.runCleanup();
  }

  // ── Event handlers ────────────────────────────────────────────────

  private async handlePlanProposed(data: unknown): Promise<void> {
    const payload = data as { id: string; title?: string; description?: string; tags?: string[]; source?: string };
    if (!payload?.id) return;
    await this.api.ontology!.setNode({
      id: `Task-${payload.id}`,
      type: "Task",
      name: payload.title ?? payload.id,
      summary: payload.description ?? undefined,
      metadata: JSON.stringify({ status: "proposed", tags: payload.tags ?? [], source: payload.source }),
    });
    // Link task to its source agent/plugin if known
    if (payload.source) {
      await this.api.ontology!.setEdge({
        id: `edge-Task-${payload.id}-source-${payload.source}`,
        from_id: `Task-${payload.id}`,
        to_id: `Plugin-${payload.source}`,
        relation: "originated_from",
        confidence: 0.8,
      });
    }
  }

  private async handlePlanApproved(data: unknown): Promise<void> {
    const payload = data as { id: string };
    if (!payload?.id) return;
    const existing = await this.api.ontology!.lookup(`Task-${payload.id}`);
    if (!existing) return;
    const meta = existing.metadata ? JSON.parse(existing.metadata) : {};
    meta.status = "approved";
    await this.api.ontology!.setNode({
      id: `Task-${payload.id}`,
      type: "Task",
      name: existing.name ?? payload.id,
      metadata: JSON.stringify(meta),
    });
  }

  private async handlePlanCompleted(data: unknown): Promise<void> {
    const payload = data as { id: string; result?: string };
    if (!payload?.id) return;
    await this.api.ontology!.setNode({
      id: `Task-${payload.id}`,
      type: "Task",
      metadata: JSON.stringify({ status: "completed", result: payload.result }),
    });
  }

  private async handlePlanFailed(data: unknown): Promise<void> {
    const payload = data as { id: string; error?: string };
    if (!payload?.id) return;
    const taskId = `Task-${payload.id}`;
    const failureId = `Failure-${payload.id}-${Date.now()}`;
    await this.api.ontology!.setNode({
      id: failureId,
      type: "Failure",
      name: payload.error ?? "Unknown",
      summary: payload.error ?? undefined,
      metadata: JSON.stringify({ taskId: payload.id }),
    });
    await this.api.ontology!.setEdge({
      id: `edge-${taskId}-${failureId}`,
      from_id: taskId,
      to_id: failureId,
      relation: "failed_due_to",
    });
  }

  private async handlePlanBlocked(data: unknown): Promise<void> {
    const payload = data as { id: string; reason?: string };
    if (!payload?.id) return;
    const existing = await this.api.ontology!.lookup(`Task-${payload.id}`);
    if (!existing) return;
    const meta = existing.metadata ? JSON.parse(existing.metadata) : {};
    meta.status = "blocked";
    meta.blockedReason = payload.reason;
    await this.api.ontology!.setNode({
      id: `Task-${payload.id}`,
      type: "Task",
      name: existing.name ?? payload.id,
      metadata: JSON.stringify(meta),
    });
  }

  private async handlePlanRejected(data: unknown): Promise<void> {
    const payload = data as { id: string; reason?: string };
    if (!payload?.id) return;
    const existing = await this.api.ontology!.lookup(`Task-${payload.id}`);
    if (!existing) return;
    const meta = existing.metadata ? JSON.parse(existing.metadata) : {};
    meta.status = "rejected";
    meta.rejectedReason = payload.reason;
    await this.api.ontology!.setNode({
      id: `Task-${payload.id}`,
      type: "Task",
      name: existing.name ?? payload.id,
      metadata: JSON.stringify(meta),
    });
  }

  private async handleTaskCreated(data: unknown): Promise<void> {
    const payload = data as { planId?: string; cardId?: string; title?: string; column?: string };
    if (!payload?.cardId) return;
    // Ensure the task node exists (may already exist from PlanProposed)
    const nodeId = payload.planId ? `Task-${payload.planId}` : `Card-${payload.cardId}`;
    await this.api.ontology!.setNode({
      id: nodeId,
      type: "Task",
      name: payload.title ?? payload.cardId,
      metadata: JSON.stringify({ cardId: payload.cardId, column: payload.column ?? "To Do" }),
    });
  }

  private async handleTaskMoved(data: unknown): Promise<void> {
    const payload = data as { planId?: string; cardId?: string; from?: string; to?: string; title?: string };
    if (!payload?.cardId) return;
    const nodeId = payload.planId ? `Task-${payload.planId}` : `Card-${payload.cardId}`;
    const existing = await this.api.ontology!.lookup(nodeId);
    const meta = existing?.metadata ? JSON.parse(existing.metadata) : {};
    meta.column = payload.to;
    meta.previousColumn = payload.from;
    meta.movedAt = Date.now();
    await this.api.ontology!.setNode({
      id: nodeId,
      type: "Task",
      name: existing?.name ?? payload.title ?? payload.cardId,
      metadata: JSON.stringify(meta),
    });
  }

  private async handleNewSkill(data: unknown): Promise<void> {
    const payload = data as { name: string; reason?: string; taskId?: string; path?: string };
    if (!payload?.name) return;
    await this.api.ontology!.setNode({
      id: `Skill-${payload.name}`,
      type: "Skill",
      name: payload.name,
      summary: payload.reason ?? undefined,
      metadata: JSON.stringify({ path: payload.path }),
      domain: "skills",
    });
    if (payload.taskId) {
      await this.api.ontology!.setEdge({
        id: `edge-Skill-${payload.name}-Task-${payload.taskId}`,
        from_id: `Skill-${payload.name}`,
        to_id: `Task-${payload.taskId}`,
        relation: "created_from",
      });
    }
  }

  private async handleSkillUsed(data: unknown): Promise<void> {
    const payload = data as { skill_name: string; ability?: string; pipeline?: string[] };
    if (!payload?.skill_name) return;
    await this.api.ontology!.setNode({
      id: `Skill-${payload.skill_name}`,
      type: "Skill",
      name: payload.skill_name,
      metadata: JSON.stringify({ lastUsed: Date.now(), ability: payload.ability }),
      domain: "skills",
    });
  }

  private async handleSkillFailed(data: unknown): Promise<void> {
    const payload = data as { skill_name: string; error?: string };
    if (!payload?.skill_name) return;
    const failureId = `Failure-skill-${payload.skill_name}-${Date.now()}`;
    await this.api.ontology!.setNode({
      id: failureId,
      type: "Failure",
      name: payload.error ?? payload.skill_name,
      summary: payload.error,
      metadata: JSON.stringify({ skill: payload.skill_name }),
    });
    await this.api.ontology!.setEdge({
      id: `edge-Skill-${payload.skill_name}-${failureId}`,
      from_id: `Skill-${payload.skill_name}`,
      to_id: failureId,
      relation: "failed_due_to",
    });
  }

  private async handleAgentLifecycle(data: unknown): Promise<void> {
    const payload = data as { agent: string; status: string; timestamp?: number };
    if (!payload?.agent) return;
    await this.api.ontology!.setNode({
      id: `Agent-${payload.agent}`,
      type: "Agent",
      name: payload.agent,
      metadata: JSON.stringify({ status: payload.status, lastSeen: payload.timestamp ?? Date.now() }),
      domain: "system",
    });
    await this.api.ontology!.setEdge({
      id: `edge-System-ronin-Agent-${payload.agent}`,
      from_id: "System-ronin",
      to_id: `Agent-${payload.agent}`,
      relation: "runs_agent",
    });
  }

  private async handleTaskFailed(data: unknown): Promise<void> {
    const payload = data as { taskId: string; error?: string; agent?: string };
    if (!payload?.taskId) return;
    const taskId = `Task-${payload.taskId}`;
    const failureId = `Failure-${payload.taskId}-${Date.now()}`;
    await this.api.ontology!.setNode({
      id: failureId,
      type: "Failure",
      name: payload.error ?? "Unknown",
      summary: payload.error,
      metadata: JSON.stringify({ agent: payload.agent, taskId: payload.taskId }),
    });
    await this.api.ontology!.setEdge({
      id: `edge-${taskId}-${failureId}`,
      from_id: taskId,
      to_id: failureId,
      relation: "failed_due_to",
    });
    // Link failure to agent if known
    if (payload.agent) {
      await this.api.ontology!.setEdge({
        id: `edge-${failureId}-Agent-${payload.agent}`,
        from_id: failureId,
        to_id: `Agent-${payload.agent}`,
        relation: "occurred_in",
        confidence: 0.9,
      });
    }
  }

  private async handleRetryTask(data: unknown): Promise<void> {
    const payload = data as { taskId: string };
    if (!payload?.taskId) return;
    const taskId = `Task-${payload.taskId}`;
    const retryId = `Retry-${payload.taskId}-${Date.now()}`;
    await this.api.ontology!.setNode({
      id: retryId,
      type: "Event",
      name: "retry",
      metadata: JSON.stringify({ taskId: payload.taskId }),
    });
    await this.api.ontology!.setEdge({
      id: `edge-${taskId}-${retryId}`,
      from_id: taskId,
      to_id: retryId,
      relation: "retried_after",
    });
  }

  private async handleAICompletion(data: unknown): Promise<void> {
    const payload = data as { type?: string; model?: string; duration?: number; success?: boolean };
    if (!payload?.model) return;
    // Track AI model usage as a node (upsert so we just update lastUsed)
    await this.api.ontology!.setNode({
      id: `Model-${payload.model}`,
      type: "Model",
      name: payload.model,
      metadata: JSON.stringify({
        lastUsed: Date.now(),
        lastType: payload.type,
        lastDuration: payload.duration,
        lastSuccess: payload.success,
      }),
      domain: "ai",
    });
  }

  // ── Cleanup (runs on schedule) ────────────────────────────────────

  private async runCleanup(): Promise<void> {
    if (!this.api.ontology) return;
    const cutoff = Date.now() - FAILURE_ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
    try {
      // Find old failure nodes via ontology search
      const oldFailures = await this.api.ontology.search({ type: "Failure", limit: 50 });
      for (const node of oldFailures) {
        if (node.updated_at < cutoff) {
          await this.api.ontology.removeNode(node.id);
        }
      }
      console.log("[ontologist] Cleanup complete");
    } catch (err) {
      console.error("[ontologist] Cleanup error:", err);
    }
  }
}
