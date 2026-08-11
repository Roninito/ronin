/**
 * Workflow Manager — Phase: Workflows
 *
 * Owns workflows/*.md: read/write/delete (src/workflow/storage.ts), AI-drafted
 * proposals awaiting approval (src/workflow/proposal-storage.ts), the
 * workflows.propose/list/get tools Chatty (and any duty) can call, and the
 * /workflows dashboard — list + viewer/editor (direct save, no approval gate)
 * + a discussion prompt for drafting/revising a workflow conversationally.
 *
 * See docs/WORKFLOWS_PLAN.md for the full design. Mirrors
 * duties/contract-executor.ts's shape throughout (routes, proposal
 * storage/approve/refuse, tool registration).
 */

import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import {
  WorkflowStorage,
  WorkflowProposalStorage,
  proposeWorkflow,
  WorkflowProposeError,
  listWorkflows,
  loadWorkflow,
} from "../src/workflow/index.js";
import {
  dramTheme,
  getAdobeCleanFontFaceCSS,
  getThemeCSS,
  getSharedUIPrimitivesCSS,
  getHeaderBarCSS,
  getHeaderHomeIconHTML,
} from "../src/utils/theme.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const API_PREFIX = "/api/workflows/";

export default class WorkflowManagerAgent extends BaseDuty {
  private storage: WorkflowStorage;
  private proposalStorage: WorkflowProposalStorage;

  constructor(api: DutyAPI) {
    super(api);
    this.storage = new WorkflowStorage();
    this.proposalStorage = new WorkflowProposalStorage(api);
    this.registerRoutes();
    this.registerTools();
  }

  async execute(): Promise<void> {
    try {
      await this.proposalStorage.init();
    } catch (error) {
      console.error(`[workflow-manager] Failed to init proposal storage: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ─── Tools ─────────────────────────────────────────────────────────────

  private registerTools(): void {
    this.api.tools.register({
      name: "workflows.propose",
      description:
        "Draft a Workflow — a markdown Standard Operating Procedure describing a repeatable category of work (purpose, standards, rough steps) — from a plain-English description, e.g. \"formalize how we launch and market a shipped app\". " +
        "Never writes to workflows/ directly — it drafts a proposal and returns its id plus a plain-language preview for the user to approve or refuse via a card in the chat UI. " +
        "Reach for this when a conversation reveals a repeatable process worth formalizing so it can guide future work automatically. " +
        "If revising a proposal shown earlier in this conversation (a workflow-proposal block with an \"id\" field), pass that id as reviseProposalId.",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            description: "Plain-English description of the work to formalize, verbatim or lightly cleaned up from what the user said.",
          },
          reviseProposalId: {
            type: "string",
            description: "Optional: id of a prior pending proposal this draft supersedes.",
          },
        },
        required: ["intent"],
      },
      provider: "workflow-manager",
      handler: async (args: { intent: string; reviseProposalId?: string }) => {
        const callId = `workflows-propose-${Date.now()}`;
        try {
          const proposal = await proposeWorkflow(args.intent, this.api);
          const rec = await this.proposalStorage.create({
            intent: args.intent,
            name: proposal.name,
            content: proposal.content,
            preview: proposal.preview,
            supersedesId: args.reviseProposalId,
          });

          return {
            success: true,
            data: { id: rec.id, preview: rec.preview, workflowName: proposal.name },
            metadata: { toolName: "workflows.propose", provider: "workflow-manager", duration: 0, cached: false, timestamp: Date.now(), callId },
          };
        } catch (error) {
          const msg = error instanceof WorkflowProposeError || error instanceof Error ? error.message : String(error);
          return {
            success: false,
            data: null,
            error: msg,
            metadata: { toolName: "workflows.propose", provider: "workflow-manager", duration: 0, cached: false, timestamp: Date.now(), callId },
          };
        }
      },
      riskLevel: "low",
      cacheable: false,
    });

    this.api.tools.register({
      name: "workflows.list",
      description: "List all known Workflows (name, description, tags, status) — the markdown guidance docs in workflows/.",
      parameters: { type: "object", properties: {} },
      provider: "workflow-manager",
      handler: async () => {
        const callId = `workflows-list-${Date.now()}`;
        return {
          success: true,
          data: listWorkflows(),
          metadata: { toolName: "workflows.list", provider: "workflow-manager", duration: 0, cached: false, timestamp: Date.now(), callId },
        };
      },
      riskLevel: "low",
      cacheable: false,
    });

    this.api.tools.register({
      name: "workflows.get",
      description: "Get the full markdown content of a named Workflow.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Workflow name (matches its filename in workflows/, without .md)." } },
        required: ["name"],
      },
      provider: "workflow-manager",
      handler: async (args: { name: string }) => {
        const callId = `workflows-get-${Date.now()}`;
        const doc = loadWorkflow(args.name);
        if (!doc) {
          return {
            success: false,
            data: null,
            error: `No workflow named "${args.name}"`,
            metadata: { toolName: "workflows.get", provider: "workflow-manager", duration: 0, cached: false, timestamp: Date.now(), callId },
          };
        }
        return {
          success: true,
          data: { name: doc.frontmatter.name, description: doc.frontmatter.description, tags: doc.frontmatter.tags, status: doc.frontmatter.status, body: doc.body },
          metadata: { toolName: "workflows.get", provider: "workflow-manager", duration: 0, cached: false, timestamp: Date.now(), callId },
        };
      },
      riskLevel: "low",
      cacheable: false,
    });
  }

  // ─── Routes ────────────────────────────────────────────────────────────

  private registerRoutes(): void {
    this.api.http.registerRoute("/workflows", this.handleWorkflowsPage.bind(this));
    this.api.http.registerRoute("/api/workflows", this.handleListWorkflows.bind(this));
    this.api.http.registerRoute("/api/workflows/proposals", this.handleListProposals.bind(this));
    this.api.http.registerRoute("/api/workflows/proposals/approve", this.handleApproveProposal.bind(this));
    this.api.http.registerRoute("/api/workflows/proposals/refuse", this.handleRefuseProposal.bind(this));
    // Prefix route (trailing slash) for /api/workflows/<name> and
    // /api/workflows/<name>/chat — exact matches above win first, per
    // DutyRegistry's routing (see src/duty/DutyRegistry.ts fetch handler).
    this.api.http.registerRoute(API_PREFIX, this.handleWorkflowItemRoute.bind(this));
  }

  private async handleListWorkflows(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    return Response.json({ workflows: this.storage.list() });
  }

  private async handleWorkflowItemRoute(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const rest = decodeURIComponent(url.pathname.slice(API_PREFIX.length)).replace(/\/+$/, "");
    if (!rest || rest === "proposals") return new Response("Not found", { status: 404 });

    if (rest.endsWith("/chat")) {
      return this.handleWorkflowChat(req, rest.slice(0, -"/chat".length));
    }

    const name = rest;
    if (req.method === "GET") return this.handleGetWorkflow(name);
    if (req.method === "POST") return this.handleSaveWorkflow(req, name);
    if (req.method === "DELETE") return this.handleDeleteWorkflow(name);
    return new Response("Method not allowed", { status: 405 });
  }

  private async handleGetWorkflow(name: string): Promise<Response> {
    const content = await this.storage.readRaw(name);
    if (content === null) return new Response("Not found", { status: 404 });
    return Response.json({ name, content });
  }

  /** Direct save from the /workflows editor — no approval gate (see docs/WORKFLOWS_PLAN.md §8.1). */
  private async handleSaveWorkflow(req: Request, name: string): Promise<Response> {
    try {
      const content = await req.text();
      if (!content.trim()) return Response.json({ success: false, message: "Content required" }, { status: 400 });
      const saved = await this.storage.save(name, content);
      return Response.json({ success: true, name: saved });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return Response.json({ success: false, message: msg }, { status: 400 });
    }
  }

  private async handleDeleteWorkflow(name: string): Promise<Response> {
    const deleted = await this.storage.delete(name);
    if (!deleted) return Response.json({ success: false, message: "Not found" }, { status: 404 });
    return Response.json({ success: true });
  }

  /**
   * One discussion turn for the /workflows page's embedded prompt. Returns a
   * conversational reply plus, when the model has concrete content to
   * propose, a `draft` (full markdown) for the client's "Insert into editor"
   * action — which never auto-saves; the user still hits Save (§8.1).
   */
  private async handleWorkflowChat(req: Request, name: string): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const { message } = await req.json() as { message?: string };
      if (!message?.trim()) return Response.json({ error: "message required" }, { status: 400 });

      const isNew = name === "_new";
      const existing = isNew ? null : await this.storage.readRaw(name);

      const contextLine = existing
        ? `Current file content for "${name}":\n\n${existing}`
        : isNew
          ? "The user is starting a brand new workflow from scratch."
          : `No workflow named "${name}" exists yet — treat this as drafting a new one (use "${name}" as the name unless the user says otherwise).`;

      const systemPrompt = `You are helping the user author or revise a Ronin "Workflow" — a markdown Standard Operating Procedure with YAML frontmatter (name, description, tags, status, skills) followed by ## Purpose, ## When to use, ## Standards & expectations, ## Steps, ## Notes sections. It is guidance an AI Duty consults, not executable code.

Discuss it with the user conversationally. Only when you have concrete file content to propose, include it as a fenced block (nothing else inside the fence):

\`\`\`draft-workflow
<full markdown file content, frontmatter included>
\`\`\`

${contextLine}`;

      const response = await this.api.ai.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        { maxTokens: 1500, temperature: 0.6 }
      );

      const raw = response.content || "";
      const draftMatch = raw.match(/```draft-workflow\n([\s\S]*?)\n```/);
      const draftText = draftMatch?.[1];
      const draft = draftText ? draftText.trim() : undefined;
      const reply = draftMatch ? raw.replace(draftMatch[0], "").trim() : raw.trim();

      return Response.json({ reply: reply || (draft ? "Here's a draft — check the editor." : "..."), draft });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
    }
  }

  private async handleListProposals(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    try {
      const proposals = await this.proposalStorage.listPending();
      return Response.json({ proposals });
    } catch (error) {
      console.error(`[workflow-manager] Failed to list workflow proposals: ${error}`);
      return new Response("Internal server error", { status: 500 });
    }
  }

  private async handleApproveProposal(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const { id } = await req.json() as { id?: string };
      if (!id) return new Response("Missing id", { status: 400 });

      const proposal = await this.proposalStorage.getById(id);
      if (!proposal) return new Response("Proposal not found", { status: 404 });
      if (proposal.status !== "pending") {
        return Response.json({ success: false, message: `Proposal is already ${proposal.status}` }, { status: 409 });
      }

      const savedName = await this.storage.save(proposal.name, proposal.content);
      await this.proposalStorage.decide(id, "approved");

      this.api.events?.emit(
        "workflow.proposal_approved",
        { id, workflowName: savedName, timestamp: Date.now() },
        "workflow-manager"
      );

      console.log(`[workflow-manager] Workflow proposal approved: ${savedName} (${id})`);
      return Response.json({ success: true, workflowName: savedName });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[workflow-manager] Failed to approve workflow proposal: ${msg}`);
      return Response.json({ success: false, message: msg }, { status: 500 });
    }
  }

  private async handleRefuseProposal(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const { id } = await req.json() as { id?: string };
      if (!id) return new Response("Missing id", { status: 400 });

      const proposal = await this.proposalStorage.getById(id);
      if (!proposal) return new Response("Proposal not found", { status: 404 });
      if (proposal.status !== "pending") {
        return Response.json({ success: false, message: `Proposal is already ${proposal.status}` }, { status: 409 });
      }

      await this.proposalStorage.decide(id, "refused");

      this.api.events?.emit("workflow.proposal_refused", { id, timestamp: Date.now() }, "workflow-manager");

      console.log(`[workflow-manager] Workflow proposal refused: ${id}`);
      return Response.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[workflow-manager] Failed to refuse workflow proposal: ${msg}`);
      return Response.json({ success: false, message: msg }, { status: 500 });
    }
  }

  // ─── Dashboard page ────────────────────────────────────────────────────

  private async handleWorkflowsPage(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

    const [workflows, proposals] = await Promise.all([
      Promise.resolve(this.storage.list()),
      this.proposalStorage.listPending(),
    ]);

    const listItems = workflows.map((w) => `
      <div class="workflow-item" data-name="${escapeHtml(w.name)}" onclick="selectWorkflow('${escapeHtml(w.name)}')">
        <div class="workflow-item-main">
          <strong>${escapeHtml(w.name)}</strong>
          <span class="workflow-status ${escapeHtml(w.status)}">${escapeHtml(w.status)}</span>
        </div>
        <div class="workflow-item-desc">${escapeHtml(w.description || "(no description)")}</div>
        ${w.tags.length ? `<div class="workflow-item-tags">${w.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      </div>`).join("\n") || `<div class="empty-state">No workflows yet. Click "+ New" or discuss one below.</div>`;

    const proposalCards = proposals.map((p) => `
      <div class="proposal-card" data-proposal-id="${escapeHtml(p.id)}">
        <div class="proposal-card-preview">${escapeHtml(p.preview)}</div>
        <div class="proposal-card-actions">
          <button class="proposal-card-allow" onclick="decideProposal('${escapeHtml(p.id)}','approve',this.parentElement)">Allow</button>
          <button class="proposal-card-refuse" onclick="decideProposal('${escapeHtml(p.id)}','refuse',this.parentElement)">Refuse</button>
        </div>
      </div>`).join("\n");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Workflows - Ronin</title>
  <script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS(dramTheme)}
    ${getSharedUIPrimitivesCSS(dramTheme, { variant: "dram" })}
    ${getHeaderBarCSS(dramTheme)}

    body { padding: 0; margin: 0; }

    .page-content {
      max-width: 1280px;
      margin: 0 auto;
      padding: ${dramTheme.spacing.lg};
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      gap: ${dramTheme.spacing.lg};
    }

    .section-title {
      font-size: 0.9375rem;
      font-weight: 500;
      margin: 0 0 ${dramTheme.spacing.sm};
      color: ${dramTheme.colors.textPrimary};
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .btn-new {
      font-size: 0.75rem;
      padding: 4px 10px;
      border-radius: ${dramTheme.borderRadius.sm};
      border: 1px solid ${dramTheme.colors.border};
      background: transparent;
      color: ${dramTheme.colors.textPrimary};
      cursor: pointer;
    }
    .btn-new:hover { background: ${dramTheme.colors.backgroundTertiary}; }

    .workflow-item {
      padding: ${dramTheme.spacing.sm} ${dramTheme.spacing.md};
      border: 1px solid ${dramTheme.colors.border};
      border-radius: ${dramTheme.borderRadius.md};
      margin-bottom: ${dramTheme.spacing.xs};
      background: ${dramTheme.colors.backgroundSecondary};
      cursor: pointer;
    }
    .workflow-item:hover { border-color: ${dramTheme.colors.textTertiary}; }
    .workflow-item.selected { border-color: ${dramTheme.colors.success}; }
    .workflow-item-main { display: flex; align-items: center; justify-content: space-between; gap: ${dramTheme.spacing.sm}; }
    .workflow-status { font-size: 0.625rem; padding: 1px 7px; border-radius: 999px; border: 1px solid; text-transform: uppercase; letter-spacing: 0.04em; }
    .workflow-status.draft { color: ${dramTheme.colors.textTertiary}; border-color: ${dramTheme.colors.border}; }
    .workflow-status.active { color: ${dramTheme.colors.success}; border-color: ${dramTheme.colors.success}; }
    .workflow-status.deprecated { color: ${dramTheme.colors.error}; border-color: ${dramTheme.colors.error}; }
    .workflow-item-desc { font-size: 0.75rem; color: ${dramTheme.colors.textSecondary}; margin-top: 2px; }
    .workflow-item-tags { margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap; }
    .tag { font-size: 0.625rem; padding: 1px 6px; border-radius: 999px; background: ${dramTheme.colors.backgroundTertiary}; color: ${dramTheme.colors.textTertiary}; }

    .empty-state { color: ${dramTheme.colors.textTertiary}; font-size: 0.8125rem; padding: ${dramTheme.spacing.md} 0; }

    .detail-panel {
      border: 1px solid ${dramTheme.colors.border};
      border-radius: ${dramTheme.borderRadius.md};
      background: ${dramTheme.colors.backgroundSecondary};
      padding: ${dramTheme.spacing.md};
      min-height: 240px;
    }
    .detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: ${dramTheme.spacing.sm}; gap: ${dramTheme.spacing.sm}; }
    .detail-header input { flex: 1; background: transparent; border: none; color: ${dramTheme.colors.textPrimary}; font-size: 1rem; font-weight: 500; }
    .detail-actions { display: flex; gap: ${dramTheme.spacing.xs}; flex-shrink: 0; }
    .detail-actions button {
      font-size: 0.75rem; padding: 5px 10px; border-radius: ${dramTheme.borderRadius.sm};
      border: 1px solid ${dramTheme.colors.border}; background: transparent; color: ${dramTheme.colors.textPrimary}; cursor: pointer;
    }
    .detail-actions button:hover { background: ${dramTheme.colors.backgroundTertiary}; }
    .detail-actions .btn-save { color: ${dramTheme.colors.success}; border-color: ${dramTheme.colors.success}; }
    .detail-actions .btn-delete { color: ${dramTheme.colors.error}; border-color: ${dramTheme.colors.error}; }

    #workflow-preview { font-size: 0.8125rem; line-height: 1.6; color: ${dramTheme.colors.textPrimary}; }
    #workflow-preview h1, #workflow-preview h2 { font-size: 1rem; margin: 0.9em 0 0.4em; }
    #workflow-preview code { background: ${dramTheme.colors.backgroundTertiary}; padding: 1px 4px; border-radius: 3px; }
    #workflow-editor {
      width: 100%; min-height: 360px; box-sizing: border-box;
      background: ${dramTheme.colors.backgroundTertiary}; color: ${dramTheme.colors.textPrimary};
      border: 1px solid ${dramTheme.colors.border}; border-radius: ${dramTheme.borderRadius.sm};
      padding: ${dramTheme.spacing.sm}; font-family: 'Agave', monospace; font-size: 0.8125rem; line-height: 1.5;
      resize: vertical; display: none;
    }
    .save-status { font-size: 0.75rem; color: ${dramTheme.colors.textSecondary}; margin-top: ${dramTheme.spacing.xs}; min-height: 1.1em; }

    .discuss-panel { margin-top: ${dramTheme.spacing.lg}; border: 1px solid ${dramTheme.colors.border}; border-radius: ${dramTheme.borderRadius.md}; background: ${dramTheme.colors.backgroundSecondary}; padding: ${dramTheme.spacing.md}; }
    #discuss-log { max-height: 260px; overflow-y: auto; margin-bottom: ${dramTheme.spacing.sm}; }
    .discuss-msg { font-size: 0.8125rem; line-height: 1.5; margin-bottom: ${dramTheme.spacing.sm}; }
    .discuss-msg.user { color: ${dramTheme.colors.textPrimary}; }
    .discuss-msg.assistant { color: ${dramTheme.colors.textSecondary}; }
    .discuss-msg .who { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: ${dramTheme.colors.textTertiary}; display: block; margin-bottom: 2px; }
    .discuss-draft-actions { margin-top: 4px; }
    .discuss-draft-actions button { font-size: 0.75rem; padding: 3px 9px; border-radius: ${dramTheme.borderRadius.sm}; border: 1px solid ${dramTheme.colors.success}; color: ${dramTheme.colors.success}; background: transparent; cursor: pointer; }
    .discuss-input-row { display: flex; gap: ${dramTheme.spacing.sm}; }
    .discuss-input-row textarea { flex: 1; min-height: 44px; resize: vertical; background: ${dramTheme.colors.backgroundTertiary}; color: ${dramTheme.colors.textPrimary}; border: 1px solid ${dramTheme.colors.border}; border-radius: ${dramTheme.borderRadius.sm}; padding: ${dramTheme.spacing.xs} ${dramTheme.spacing.sm}; font-family: inherit; font-size: 0.8125rem; }
    .discuss-input-row button { align-self: flex-end; padding: ${dramTheme.spacing.xs} ${dramTheme.spacing.md}; border-radius: ${dramTheme.borderRadius.sm}; border: 1px solid ${dramTheme.colors.border}; background: ${dramTheme.colors.backgroundTertiary}; color: ${dramTheme.colors.textPrimary}; cursor: pointer; }

    .proposal-card { margin-bottom: ${dramTheme.spacing.sm}; padding: ${dramTheme.spacing.md}; border-radius: ${dramTheme.borderRadius.md}; background: ${dramTheme.colors.backgroundTertiary}; border: 1px solid ${dramTheme.colors.border}; }
    .proposal-card-preview { font-size: 0.8125rem; line-height: 1.6; color: ${dramTheme.colors.textPrimary}; margin-bottom: ${dramTheme.spacing.sm}; }
    .proposal-card-actions { display: flex; gap: ${dramTheme.spacing.sm}; }
    .proposal-card-actions button { flex: 1; padding: ${dramTheme.spacing.xs} ${dramTheme.spacing.md}; border-radius: ${dramTheme.borderRadius.sm}; border: 1px solid ${dramTheme.colors.border}; background: transparent; cursor: pointer; font-size: 0.75rem; font-weight: 500; }
    .proposal-card-allow { color: ${dramTheme.colors.success}; border-color: ${dramTheme.colors.success} !important; }
    .proposal-card-refuse { color: ${dramTheme.colors.error}; border-color: ${dramTheme.colors.error} !important; }
    .proposal-card-actions button:disabled { opacity: 0.5; cursor: default; }
    .proposal-card-status { font-size: 0.75rem; color: ${dramTheme.colors.textSecondary}; }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>🗂️ Workflows</h1>
    <div class="header-meta"><span>Markdown SOPs — guidance, not code</span></div>
  </div>

  <div class="page-content">
    <div>
      <div class="section-title">Workflows <button class="btn-new" onclick="newWorkflow()">+ New</button></div>
      <div id="workflow-list">${listItems}</div>

      ${proposalCards ? `<div class="section-title" style="margin-top:${dramTheme.spacing.lg}">Pending Proposals</div><div id="proposals">${proposalCards}</div>` : ""}
    </div>

    <div>
      <div class="detail-panel" id="detail-panel" style="display:none;">
        <div class="detail-header">
          <input id="detail-name" placeholder="workflow-name" />
          <div class="detail-actions">
            <button id="btn-toggle-edit" onclick="toggleEdit()">Edit</button>
            <button class="btn-save" onclick="saveWorkflow()">Save</button>
            <button class="btn-delete" onclick="deleteCurrentWorkflow()">Delete</button>
          </div>
        </div>
        <div id="workflow-preview"></div>
        <textarea id="workflow-editor" spellcheck="false"></textarea>
        <div class="save-status" id="save-status"></div>
      </div>
      <div class="empty-state" id="no-selection">Select a workflow, or click "+ New" — or just start discussing one below.</div>

      <div class="discuss-panel">
        <div class="section-title">Discuss</div>
        <div id="discuss-log"></div>
        <div class="discuss-input-row">
          <textarea id="discuss-input" placeholder="Discuss the selected workflow, or describe a new one to draft..."></textarea>
          <button onclick="sendDiscussMessage()">Send</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    function esc(v){return String(v||'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

    let selectedName = null; // null while nothing selected/new
    let editMode = false;

    function showDetail() {
      document.getElementById('detail-panel').style.display = '';
      document.getElementById('no-selection').style.display = 'none';
    }

    async function selectWorkflow(name) {
      const res = await fetch('/api/workflows/' + encodeURIComponent(name));
      if (!res.ok) return;
      const data = await res.json();
      selectedName = name;
      editMode = false;
      showDetail();
      document.querySelectorAll('.workflow-item').forEach(el => el.classList.toggle('selected', el.dataset.name === name));
      document.getElementById('detail-name').value = name;
      document.getElementById('detail-name').disabled = true;
      setEditorContent(data.content);
      renderPreview();
      document.getElementById('save-status').textContent = '';
    }

    function newWorkflow() {
      selectedName = null;
      editMode = true;
      showDetail();
      document.querySelectorAll('.workflow-item').forEach(el => el.classList.remove('selected'));
      document.getElementById('detail-name').value = '';
      document.getElementById('detail-name').disabled = false;
      setEditorContent('---\\nname: \\ndescription: \\ntags: []\\nstatus: draft\\nskills: []\\n---\\n\\n# Title\\n\\n## Purpose\\n\\n## When to use\\n\\n## Standards & expectations\\n\\n## Steps\\n1. \\n\\n## Notes\\n');
      applyEditMode();
      document.getElementById('save-status').textContent = '';
    }

    function setEditorContent(content) {
      document.getElementById('workflow-editor').value = content || '';
    }

    function renderPreview() {
      const content = document.getElementById('workflow-editor').value;
      const body = content.replace(/^---[\\s\\S]*?---\\s*/, '');
      const preview = document.getElementById('workflow-preview');
      if (typeof marked !== 'undefined' && marked && marked.parse) {
        try { preview.innerHTML = marked.parse(body); return; } catch (e) { /* fall through */ }
      }
      preview.textContent = body;
    }

    function applyEditMode() {
      document.getElementById('workflow-preview').style.display = editMode ? 'none' : '';
      document.getElementById('workflow-editor').style.display = editMode ? '' : 'none';
      document.getElementById('btn-toggle-edit').textContent = editMode ? 'Preview' : 'Edit';
      if (!editMode) renderPreview();
    }

    function toggleEdit() {
      editMode = !editMode;
      applyEditMode();
    }

    function extractFrontmatterName(content) {
      const m = content.match(/^name:\\s*(.+)$/m);
      return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
    }

    async function saveWorkflow() {
      const content = document.getElementById('workflow-editor').value;
      const nameField = document.getElementById('detail-name');
      const targetName = selectedName || nameField.value.trim() || extractFrontmatterName(content);
      const statusEl = document.getElementById('save-status');
      if (!targetName) { statusEl.textContent = 'Name required (in the name field or frontmatter).'; return; }
      statusEl.textContent = 'Saving...';
      try {
        const res = await fetch('/api/workflows/' + encodeURIComponent(targetName), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: content,
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.success) {
          statusEl.textContent = 'Saved.';
          selectedName = body.name;
          nameField.value = body.name;
          nameField.disabled = true;
          editMode = false;
          applyEditMode();
          await loadWorkflowList();
        } else {
          statusEl.textContent = 'Failed: ' + (body.message || res.statusText);
        }
      } catch (e) {
        statusEl.textContent = 'Failed: network error';
      }
    }

    async function deleteCurrentWorkflow() {
      if (!selectedName) { document.getElementById('detail-panel').style.display = 'none'; document.getElementById('no-selection').style.display = ''; return; }
      if (!confirm('Delete workflow "' + selectedName + '"?')) return;
      const res = await fetch('/api/workflows/' + encodeURIComponent(selectedName), { method: 'DELETE' });
      if (res.ok) {
        selectedName = null;
        document.getElementById('detail-panel').style.display = 'none';
        document.getElementById('no-selection').style.display = '';
        await loadWorkflowList();
      }
    }

    async function loadWorkflowList() {
      const res = await fetch('/api/workflows');
      const data = await res.json();
      const list = document.getElementById('workflow-list');
      const workflows = data.workflows || [];
      if (workflows.length === 0) {
        list.innerHTML = '<div class="empty-state">No workflows yet. Click "+ New" or discuss one below.</div>';
        return;
      }
      list.innerHTML = workflows.map(w => \`
        <div class="workflow-item\${w.name === selectedName ? ' selected' : ''}" data-name="\${esc(w.name)}" onclick="selectWorkflow('\${esc(w.name)}')">
          <div class="workflow-item-main"><strong>\${esc(w.name)}</strong><span class="workflow-status \${esc(w.status)}">\${esc(w.status)}</span></div>
          <div class="workflow-item-desc">\${esc(w.description || '(no description)')}</div>
          \${w.tags.length ? '<div class="workflow-item-tags">' + w.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : ''}
        </div>\`).join('');
    }

    async function decideProposal(id, action, cardEl) {
      const actionsEl = cardEl.querySelector('.proposal-card-actions');
      const buttons = actionsEl.querySelectorAll('button');
      buttons.forEach(b => b.disabled = true);
      try {
        const res = await fetch('/api/workflows/proposals/' + action, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.success !== false) {
          actionsEl.innerHTML = action === 'approve'
            ? '<span class="proposal-card-status">✅ Approved' + (body.workflowName ? ' — ' + esc(body.workflowName) + ' saved' : '') + '</span>'
            : '<span class="proposal-card-status">Refused</span>';
          if (action === 'approve') setTimeout(() => location.reload(), 1200);
        } else {
          actionsEl.innerHTML = '<span class="proposal-card-status">Failed: ' + esc(body.message || res.statusText) + '</span>';
        }
      } catch (e) {
        actionsEl.innerHTML = '<span class="proposal-card-status">Failed: network error</span>';
      }
    }

    function appendDiscussMsg(who, text, draft) {
      const log = document.getElementById('discuss-log');
      const el = document.createElement('div');
      el.className = 'discuss-msg ' + who;
      el.innerHTML = '<span class="who">' + (who === 'user' ? 'You' : 'Ronin') + '</span>' + esc(text).replace(/\\n/g, '<br>');
      if (draft) {
        const actions = document.createElement('div');
        actions.className = 'discuss-draft-actions';
        const btn = document.createElement('button');
        btn.textContent = 'Insert into editor';
        btn.onclick = () => {
          if (!document.getElementById('detail-panel').style.display || document.getElementById('detail-panel').style.display === 'none') {
            showDetail();
            document.getElementById('detail-name').disabled = !selectedName;
          }
          setEditorContent(draft);
          editMode = true;
          applyEditMode();
          document.getElementById('save-status').textContent = 'Draft inserted — review and Save when ready.';
        };
        actions.appendChild(btn);
        el.appendChild(actions);
      }
      log.appendChild(el);
      log.scrollTop = log.scrollHeight;
    }

    async function sendDiscussMessage() {
      const input = document.getElementById('discuss-input');
      const message = input.value.trim();
      if (!message) return;
      input.value = '';
      appendDiscussMsg('user', message);
      const target = selectedName || '_new';
      try {
        const res = await fetch('/api/workflows/' + encodeURIComponent(target) + '/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          appendDiscussMsg('assistant', body.reply || '...', body.draft);
        } else {
          appendDiscussMsg('assistant', 'Error: ' + (body.error || res.statusText));
        }
      } catch (e) {
        appendDiscussMsg('assistant', 'Network error.');
      }
    }

    document.getElementById('discuss-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDiscussMessage(); }
    });
  </script>
</body>
</html>`;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
}
