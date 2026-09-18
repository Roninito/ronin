/**
 * Duty Executor Agent
 *
 * The duty-creation counterpart to duties/contract-executor.ts: drafts a new
 * Duty's TypeScript from a plain-English request via a single, cheap
 * api.ai.complete() call, never writes it to disk or registers it directly.
 * It persists a pending proposal and returns its id plus a preview + the
 * drafted code for the chat UI to render as an approval card (see
 * /api/duties/proposals/approve|refuse below).
 *
 * On approval, this duty does NOT write proposal.code to disk itself — that
 * single-completion draft has no compile-check or self-correction loop, and
 * is treated as a reviewed starting point, not final code. Instead it emits
 * PlanProposed (creates a visible Kanban card at /todo) then PlanApproved
 * (no second approval needed — the human already approved in chat), handing
 * the real implementation to duties/coder-bot.ts, which spawns an actual
 * coding CLI (Claude Code, OpenCode, etc.) against the duties directory.
 * HotReloadService picks up whatever file that CLI writes automatically
 * (it watches the duties directories directly, independent of any event
 * this duty emits).
 */

import { join } from "path";
import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import { existsSync } from "fs";
import { proposeDuty, DutyProposeError, DutyProposalStorage } from "../src/duty/index.js";
import { validateDutyCode, toKebabCase } from "../src/duty/duty-authoring.js";
import { resolveExternalDutyDir } from "../src/cli/commands/config.js";
import { hankoTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getSharedUIPrimitivesCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default class DutyExecutorAgent extends BaseDuty {
  private proposalStorage: DutyProposalStorage;

  constructor(api: DutyAPI) {
    super(api);
    this.proposalStorage = new DutyProposalStorage(api);
    this.registerRoutes();
    this.registerTool();
  }

  async execute(): Promise<void> {
    // No standing work — this duty only responds to tool calls and routes.
  }

  /**
   * Tool Chatty can call mid-conversation to draft a brand-new duty from
   * plain English — e.g. "watches #design threads and keeps a running GDD".
   * Never writes to the duties directory or registers anything directly: it
   * drafts, persists a pending proposal, and returns its id + a preview +
   * the full generated code for the chat UI to render as an approval card.
   */
  private registerTool(): void {
    this.api.tools.register({
      name: "duties.proposeDuty",
      description:
        "Draft a brand-new Ronin duty (a scheduled, event-watching, or webhook-handling TypeScript class) from a plain-English request. " +
        "Never writes to disk or registers anything directly — it drafts a proposal and returns its id, a plain-language preview, and the full generated code for the user to approve or refuse via a card in the chat UI. " +
        "If the user asks to revise a proposal they were just shown (visible earlier in this conversation as a duty-proposal block with an \"id\" field), pass that id as reviseProposalId so the new draft supersedes it.",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            description: "The plain-English duty request, verbatim or lightly cleaned up from what the user said.",
          },
          reviseProposalId: {
            type: "string",
            description: "Optional: the id of a prior pending proposal this draft revises/replaces.",
          },
        },
        required: ["intent"],
      },
      provider: "duty-executor",
      handler: async (args: { intent: string; reviseProposalId?: string }) => {
        const callId = `duties-propose-${Date.now()}`;
        try {
          const proposal = await proposeDuty(args.intent, this.api);
          const rec = await this.proposalStorage.create({
            intent: args.intent,
            dutyName: proposal.dutyName,
            code: proposal.code,
            preview: proposal.preview,
            supersedesId: args.reviseProposalId,
          });

          return {
            success: true,
            data: { id: rec.id, preview: rec.preview, code: rec.code, dutyName: rec.dutyName },
            metadata: {
              toolName: "duties.proposeDuty",
              provider: "duty-executor",
              duration: 0,
              cached: false,
              timestamp: Date.now(),
              callId,
            },
          };
        } catch (error) {
          const msg = error instanceof DutyProposeError || error instanceof Error
            ? error.message
            : String(error);
          return {
            success: false,
            data: null,
            error: msg,
            metadata: {
              toolName: "duties.proposeDuty",
              provider: "duty-executor",
              duration: 0,
              cached: false,
              timestamp: Date.now(),
              callId,
            },
          };
        }
      },
      riskLevel: "low",
      cacheable: false,
    });
  }

  /**
   * Approve/refuse API for AI-drafted duty proposals (from Chatty's
   * duties.proposeDuty tool, or the /duties/review dashboard page). Mirrors
   * duties/contract-executor.ts's shape: flat routes, target id in the POST
   * body rather than a dynamic path segment.
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/duties/review", this.handleReviewPage.bind(this));
    this.api.http.registerRoute("/api/duties/proposals", this.handleListProposals.bind(this));
    this.api.http.registerRoute("/api/duties/proposals/approve", this.handleApproveProposal.bind(this));
    this.api.http.registerRoute("/api/duties/proposals/refuse", this.handleRefuseProposal.bind(this));
  }

  /**
   * Dashboard review page: live duties + any pending AI-drafted proposals.
   * Given a duty proposal is arbitrary generated code (not the structured,
   * pre-validated data a Contract proposal is), the full code is shown here
   * too, not just the preview line — same reasoning as the chat card.
   */
  private async handleReviewPage(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

    const [proposals] = await Promise.all([this.proposalStorage.listPending()]);
    const liveDuties = this.api.getAgents?.() ?? [];

    const dutyRows = liveDuties.map((d) => {
      const trigger = d.schedule
        ? `schedule: ${d.schedule}`
        : d.webhook
        ? `webhook: ${d.webhook}`
        : d.watch && d.watch.length > 0
        ? `watches: ${d.watch.join(", ")}`
        : "manual / event-driven";
      return `
        <div class="duty-row">
          <div class="duty-row-main"><strong>${escapeHtml(d.name)}</strong></div>
          <div class="duty-row-detail">${escapeHtml(trigger)}</div>
        </div>`;
    }).join("\n") || `<div class="empty-state">No duties loaded.</div>`;

    const proposalCards = proposals.map((p) => `
      <div class="proposal-card" data-proposal-id="${escapeHtml(p.id)}">
        <div class="proposal-card-preview">${escapeHtml(p.preview)}</div>
        <details class="proposal-card-code-details">
          <summary>View generated code</summary>
          <pre class="proposal-card-code">${escapeHtml(p.code)}</pre>
        </details>
        <div class="proposal-card-actions">
          <button class="proposal-card-allow" onclick="decideProposal('${escapeHtml(p.id)}','approve',this.parentElement)">Allow</button>
          <button class="proposal-card-refuse" onclick="decideProposal('${escapeHtml(p.id)}','refuse',this.parentElement)">Refuse</button>
        </div>
      </div>`).join("\n") || `<div class="empty-state">No pending proposals.</div>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Duties - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS(hankoTheme)}
    ${getSharedUIPrimitivesCSS(hankoTheme, { variant: "hanko" })}
    ${getHeaderBarCSS(hankoTheme)}

    body { padding: 0; margin: 0; }

    .page-content {
      max-width: 900px;
      margin: 0 auto;
      padding: ${hankoTheme.spacing.lg};
    }

    .section-title {
      font-size: 0.9375rem;
      font-weight: 500;
      margin: ${hankoTheme.spacing.lg} 0 ${hankoTheme.spacing.sm};
      color: ${hankoTheme.colors.textPrimary};
    }

    .duty-row {
      padding: ${hankoTheme.spacing.md};
      border: 1px solid ${hankoTheme.colors.border};
      border-radius: ${hankoTheme.borderRadius.md};
      margin-bottom: ${hankoTheme.spacing.sm};
      background: ${hankoTheme.colors.backgroundSecondary};
    }

    .duty-row-main { margin-bottom: ${hankoTheme.spacing.xs}; }
    .duty-row-detail { font-size: 0.8125rem; color: ${hankoTheme.colors.textSecondary}; }

    .empty-state {
      color: ${hankoTheme.colors.textTertiary};
      font-size: 0.8125rem;
      padding: ${hankoTheme.spacing.md} 0;
    }

    .proposal-card {
      margin-bottom: ${hankoTheme.spacing.sm};
      padding: ${hankoTheme.spacing.md};
      border-radius: ${hankoTheme.borderRadius.md};
      background: ${hankoTheme.colors.backgroundTertiary};
      border: 1px solid ${hankoTheme.colors.border};
    }
    .proposal-card-preview {
      font-size: 0.8125rem;
      line-height: 1.6;
      color: ${hankoTheme.colors.textPrimary};
      margin-bottom: ${hankoTheme.spacing.sm};
    }
    .proposal-card-code-details {
      margin-bottom: ${hankoTheme.spacing.sm};
    }
    .proposal-card-code-details summary {
      font-size: 0.75rem;
      color: ${hankoTheme.colors.textSecondary};
      cursor: pointer;
    }
    .proposal-card-code {
      margin-top: ${hankoTheme.spacing.xs};
      padding: ${hankoTheme.spacing.sm};
      background: ${hankoTheme.colors.background};
      border: 1px solid ${hankoTheme.colors.border};
      border-radius: ${hankoTheme.borderRadius.sm};
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.75rem;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre;
      max-height: 360px;
      overflow-y: auto;
    }
    .proposal-card-actions { display: flex; gap: ${hankoTheme.spacing.sm}; }
    .proposal-card-actions button {
      flex: 1;
      padding: ${hankoTheme.spacing.xs} ${hankoTheme.spacing.md};
      border-radius: ${hankoTheme.borderRadius.sm};
      border: 1px solid ${hankoTheme.colors.border};
      background: transparent;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .proposal-card-allow { color: ${hankoTheme.colors.success}; border-color: ${hankoTheme.colors.success} !important; }
    .proposal-card-refuse { color: ${hankoTheme.colors.error}; border-color: ${hankoTheme.colors.error} !important; }
    .proposal-card-actions button:disabled { opacity: 0.5; cursor: default; }
    .proposal-card-status { font-size: 0.75rem; color: ${hankoTheme.colors.textSecondary}; }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>🛠️ Duties</h1>
    <div class="header-meta">
      <span>Live duties + AI-drafted proposals awaiting approval</span>
    </div>
  </div>

  <div class="page-content">
    <div class="section-title">Pending Proposals</div>
    <div id="proposals">${proposalCards}</div>

    <div class="section-title">Live Duties</div>
    <div id="duties">${dutyRows}</div>
  </div>

  <script>
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    async function decideProposal(id, action, cardEl) {
      const actionsEl = cardEl.querySelector('.proposal-card-actions');
      const buttons = actionsEl.querySelectorAll('button');
      buttons.forEach(b => b.disabled = true);
      try {
        const res = await fetch('/api/duties/proposals/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.success !== false) {
          actionsEl.innerHTML = action === 'approve'
            ? '<span class="proposal-card-status">✅ Approved' + (body.dutyName ? ' — ' + escapeHtml(body.dutyName) + ' is now live' : '') + '</span>'
            : '<span class="proposal-card-status">Refused</span>';
          if (action === 'approve') setTimeout(() => location.reload(), 1200);
        } else {
          actionsEl.innerHTML = '<span class="proposal-card-status">Failed: ' + escapeHtml(body.message || res.statusText) + '</span>';
        }
      } catch (e) {
        actionsEl.innerHTML = '<span class="proposal-card-status">Failed: network error</span>';
      }
    }
  </script>
</body>
</html>`;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }

  private async handleListProposals(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    try {
      const proposals = await this.proposalStorage.listPending();
      return Response.json({ proposals });
    } catch (error) {
      console.error(`[duty-executor] Failed to list duty proposals: ${error}`);
      return new Response("Internal server error", { status: 500 });
    }
  }

  private async handleApproveProposal(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const { id, dutyName: nameOverride } = await req.json() as { id?: string; dutyName?: string };
      if (!id) return new Response("Missing id", { status: 400 });

      const proposal = await this.proposalStorage.getById(id);
      if (!proposal) return new Response("Proposal not found", { status: 404 });
      if (proposal.status !== "pending") {
        return Response.json({ success: false, message: `Proposal is already ${proposal.status}` }, { status: 409 });
      }

      // Defensive re-validation: the code was checked when drafted, but this
      // is the point where it actually gets filesystem + runtime privileges.
      const validation = validateDutyCode(proposal.code);
      if (!validation.valid) {
        return Response.json(
          { success: false, message: `Proposal failed re-validation: ${validation.errors.join("; ")}` },
          { status: 422 }
        );
      }

      // The AI-derived name is just a first guess (first few words of the
      // intent, kebab-cased) — let the human rename it at approval time,
      // since that's the only name they'll ever look it up by afterward.
      // External dir, not the project's own ./duties — an AI-drafted duty
      // approved from chat is the user's personal automation, not project
      // source. resolveExternalDutyDir() also respects RONIN_EXTERNAL_DUTY_DIR,
      // matching src/duty/propose.ts's collision check.
      const dutyDir = resolveExternalDutyDir();
      let finalDutyName = proposal.dutyName;
      if (nameOverride && nameOverride.trim()) {
        const candidate = toKebabCase(nameOverride.trim());
        if (!candidate) {
          return Response.json({ success: false, message: "Duty name can't be empty after normalizing" }, { status: 400 });
        }
        if (candidate !== proposal.dutyName && existsSync(join(dutyDir, `${candidate}.ts`))) {
          return Response.json({ success: false, message: `A duty named '${candidate}' already exists` }, { status: 409 });
        }
        finalDutyName = candidate;
      }

      await this.proposalStorage.decide(id, "approved", finalDutyName);

      // Hand off to the real coding-CLI pipeline (duties/coder-bot.ts)
      // instead of writing proposal.code directly to disk — that draft came
      // from a single api.ai.complete() call with no compile-check or
      // self-correction loop. Emitting PlanProposed first creates a visible,
      // trackable Kanban card (/todo); PlanApproved follows immediately since
      // the human already approved this in chat — no second approval needed
      // in the board itself. coder-bot.ts uses draftCode as a reviewed
      // starting point for the CLI, not as the final code.
      const now = Date.now();
      this.api.events.emit("PlanProposed", {
        id,
        title: finalDutyName,
        description: proposal.intent,
        tags: ["create", "duty"],
        source: "duty-executor",
        proposedAt: now,
      }, "duty-executor");
      this.api.events.emit("PlanApproved", {
        id,
        title: finalDutyName,
        description: proposal.intent,
        tags: ["create", "duty"],
        approvedAt: now,
        draftCode: proposal.code,
        source: "duty-executor",
      }, "duty-executor");

      this.api.events?.emit(
        "duty.proposal_approved",
        { id, dutyName: finalDutyName, timestamp: now },
        "duty-executor"
      );

      console.log(`[duty-executor] Duty proposal approved: ${finalDutyName} (${id}) — handed off to coder-bot for implementation`);
      return Response.json({
        success: true,
        dutyName: finalDutyName,
        message: "Approved — a coding agent is implementing this now. Track progress at /todo.",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[duty-executor] Failed to approve duty proposal: ${msg}`);
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

      this.api.events?.emit(
        "duty.proposal_refused",
        { id, timestamp: Date.now() },
        "duty-executor"
      );

      console.log(`[duty-executor] Duty proposal refused: ${id}`);
      return Response.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[duty-executor] Failed to refuse duty proposal: ${msg}`);
      return Response.json({ success: false, message: msg }, { status: 500 });
    }
  }
}
