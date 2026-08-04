import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";

/**
 * Registers this Ronin instance with the EXTERNAL MNGR orchestrator (not
 * Ronin's own internal "MNGR" Duty concept — see plugins/mngr.ts's header
 * note) and exposes the /api/agent/tasks contract MNGR's existing
 * RemoteAgentClient already dispatches to for AI_AGENT workers (the same
 * protocol built for the sibling "sar-coder" app — nothing new on MNGR's
 * side, per mngr/design/sar-coder-integration.md §8):
 *
 *   POST /api/agent/tasks        -> { agentTaskId, status: "queued" }
 *   GET  /api/agent/tasks/:id    -> { agentTaskId, mngrTaskId, status, summary?, artifacts?, error? }
 *
 * A task is treated as ENVOY-targeted when its `context` contains an
 * `envoyProjectId` (JSON `{"envoyProjectId":"prj_..."}` or a bare
 * `envoyProjectId: prj_...` line) — the one convention this duty and MNGR's
 * task-authoring side (human or LLM) need to agree on. Anything else fails
 * clearly rather than guessing (spec I-6's spirit, extended to this channel).
 */

interface AgentTaskRow {
  agent_task_id: string;
  mngr_task_id: string;
  status: "queued" | "running" | "done" | "failed";
  summary: string | null;
  artifacts_json: string;
  error: string | null;
  created_at: number;
  updated_at: number;
}

interface RemoteTaskPayload {
  mngrTaskId?: string;
  title: string;
  description?: string;
  context?: string;
  priority?: string;
}

const ATTENTION_WAR_DOCTRINE = `You are drafting for ENVOY, a lifecycle-marketing platform, under The Attention War doctrine:
- No hook, no reach: the opening line must earn the rest of the read. Never bury the point.
- Match the register to the funnel stage, never blast one message to everyone:
  aware/considering -> give value, build trust, no hard sell; ready -> a clear direct offer;
  customer -> service, tips, occasional upsell; advocate -> referral/review asks; lapsing -> one honest win-back, direct.
- Evergreen recycling: when asked to recycle a past item, write a NEW hook for the same underlying payload — never just repeat it verbatim.
- Keep visual/voice identity consistent with the project's existing voice.
- You draft; you never approve. Every draft you create lands in review — say so is unnecessary, it's structural.
Write only the requested copy. Be direct and specific — no filler, no hedging, no "I'd be happy to".`;

export default class MngrWorkerDuty extends BaseDuty {
  // Hourly heartbeat/re-registration — idempotent, self-heals if MNGR's db was reseeded.
  // (CronScheduler's granularity is 60s; MNGR's own BT tick is every 5 minutes, so hourly is plenty.)
  static schedule = "0 * * * *";

  constructor(api: DutyAPI) {
    super(api);
    void this.initializeDatabase();
    this.registerRoutes();
    void this.registerWithMngr();
    console.log("🤝 MNGR worker duty ready — /api/agent/tasks online");
  }

  async execute(): Promise<void> {
    await this.registerWithMngr();
  }

  // ── Setup ──────────────────────────────────────────────────────────────

  private async initializeDatabase(): Promise<void> {
    await this.api.db.execute(`
      CREATE TABLE IF NOT EXISTS mngr_agent_tasks (
        agent_task_id TEXT PRIMARY KEY,
        mngr_task_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued',
        summary TEXT,
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  private registerRoutes(): void {
    this.api.http.registerRoute("/api/agent/tasks", this.handleTasksCollection.bind(this));
    // Trailing-slash prefix match for /api/agent/tasks/:id (same convention as portfolio.ts's dynamic routes).
    this.api.http.registerRoute("/api/agent/tasks/", this.handleTaskDetail.bind(this));
  }

  private async registerWithMngr(): Promise<void> {
    const roninEndpoint =
      (this.api.config.get("mngr.roninEndpointUrl") as string) || `http://localhost:${(this.api.config.get("system.webhookPort") as number) || 3000}`;
    const result = await this.api.plugins.call("mngr", "register", "Ronin Agent", roninEndpoint) as { ok: boolean; error?: string };
    if (!result.ok) {
      console.warn(`[mngr-worker] registration skipped/failed: ${result.error ?? "unknown error"}`);
    }
  }

  // ── Auth ───────────────────────────────────────────────────────────────

  private isAuthorized(req: Request): boolean {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const expected = (this.api.config.get("mngr.inboundToken") as string) || "";
    return !!expected && token === expected;
  }

  // ── Routes ─────────────────────────────────────────────────────────────

  private async handleTasksCollection(req: Request): Promise<Response> {
    if (!this.isAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as RemoteTaskPayload | null;
      if (!body?.title) return Response.json({ error: "title is required" }, { status: 400 });

      const agentTaskId = crypto.randomUUID();
      const now = Date.now();
      await this.api.db.execute(
        `INSERT INTO mngr_agent_tasks (agent_task_id, mngr_task_id, status, artifacts_json, created_at, updated_at) VALUES (?, ?, 'queued', '[]', ?, ?)`,
        [agentTaskId, body.mngrTaskId ?? "", now, now],
      );

      // Respond immediately (MNGR's client has a 15s timeout on this POST) — execute async.
      void this.executeTask(agentTaskId, body).catch((e) => this.markFailed(agentTaskId, e instanceof Error ? e.message : String(e)));

      return Response.json({ agentTaskId, status: "queued" });
    }

    if (req.method === "GET") {
      const rows = await this.api.db.query<AgentTaskRow>("SELECT * FROM mngr_agent_tasks ORDER BY created_at DESC LIMIT 50");
      return Response.json(rows.map((r) => this.toStatusPayload(r)));
    }

    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  private async handleTaskDetail(req: Request): Promise<Response> {
    if (!this.isAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const agentTaskId = url.pathname.replace("/api/agent/tasks/", "").split("/")[0];
    if (!agentTaskId) return Response.json({ error: "Not found" }, { status: 404 });

    const rows = await this.api.db.query<AgentTaskRow>("SELECT * FROM mngr_agent_tasks WHERE agent_task_id = ?", [agentTaskId]);
    const row = rows[0];
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(this.toStatusPayload(row));
  }

  private toStatusPayload(row: AgentTaskRow) {
    return {
      agentTaskId: row.agent_task_id,
      mngrTaskId: row.mngr_task_id,
      status: row.status,
      summary: row.summary ?? undefined,
      artifacts: JSON.parse(row.artifacts_json || "[]"),
      error: row.error ?? undefined,
      startedAt: row.created_at,
      completedAt: row.status === "done" || row.status === "failed" ? row.updated_at : undefined,
    };
  }

  // ── Execution ──────────────────────────────────────────────────────────

  private async setStatus(agentTaskId: string, status: AgentTaskRow["status"], fields: { summary?: string; artifacts?: unknown[]; error?: string } = {}): Promise<void> {
    await this.api.db.execute(
      `UPDATE mngr_agent_tasks SET status = ?, summary = ?, artifacts_json = ?, error = ?, updated_at = ? WHERE agent_task_id = ?`,
      [status, fields.summary ?? null, JSON.stringify(fields.artifacts ?? []), fields.error ?? null, Date.now(), agentTaskId],
    );
  }

  private async markFailed(agentTaskId: string, error: string): Promise<void> {
    await this.setStatus(agentTaskId, "failed", { error });
  }

  private parseEnvoyProjectId(context?: string): string | null {
    if (!context) return null;
    try {
      const parsed = JSON.parse(context) as { envoyProjectId?: string };
      if (parsed.envoyProjectId) return parsed.envoyProjectId;
    } catch {
      // not JSON — fall through to a plain-text match
    }
    const match = context.match(/envoyProjectId["\s:=]+([\w-]+)/i);
    return match?.[1] ?? null;
  }

  private async executeTask(agentTaskId: string, task: RemoteTaskPayload): Promise<void> {
    await this.setStatus(agentTaskId, "running");

    const envoyProjectId = this.parseEnvoyProjectId(task.context) ?? this.parseEnvoyProjectId(task.description);
    if (!envoyProjectId) {
      await this.markFailed(agentTaskId, "No handler for this task type — expected an envoyProjectId in context/description.");
      return;
    }

    try {
      const stageCounts = await this.api.plugins.call("envoy", "getStages", envoyProjectId) as Record<string, number>;

      const reply = await this.api.ai.chat([
        { role: "system", content: ATTENTION_WAR_DOCTRINE },
        {
          role: "user",
          content: `Task: ${task.title}\n${task.description ?? ""}\n\nCurrent stage counts for this project: ${JSON.stringify(stageCounts)}\n\nWrite the email copy for this task. Output only the copy, no preamble.`,
        },
      ]);

      const copy = reply.content.trim();
      const created = await this.api.plugins.call("envoy", "createDraftItem", envoyProjectId, {
        copy,
        channel: "email",
        audience: { kind: "all" },
        sourceRef: `ronin:${task.mngrTaskId || agentTaskId}`,
      }) as { id: string; state: string };

      await this.api.plugins.call("envoy", "submitItem", envoyProjectId, created.id);

      await this.setStatus(agentTaskId, "done", {
        summary: `Drafted and submitted ENVOY item ${created.id} for project ${envoyProjectId} (now in review).`,
        artifacts: [{ path: `envoy:item:${created.id}`, type: "EnvoyItem" }],
      });
    } catch (e) {
      await this.markFailed(agentTaskId, e instanceof Error ? e.message : String(e));
    }
  }
}
