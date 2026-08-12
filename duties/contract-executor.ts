/**
 * Contract Executor Agent — Phase 7
 *
 * Orchestrates contract and cron execution:
 * 1. Starts CronEngine (evaluates cron expressions)
 * 2. Starts ContractEngine (listens to triggers, spawns tasks)
 *
 * Flow:
 *   CronEngine (every 60s)
 *     ↓ emits contract.cron_triggered
 *   ContractEngine
 *     ↓ emits task.spawn_requested
 *   TaskExecutor
 *     ↓ creates and runs task
 */

import { BaseDuty } from "@ronin/duty/index.js";
import type { DutyAPI } from "@ronin/types/index.js";
import {
  CronEngine,
  ContractEngine,
  EventTriggerEngine,
  ContractProposalStorage,
  proposeContract,
  ContractProposeError,
} from "../src/contract/index.js";
import { ContractStorageV2 } from "../src/contract/storage-v2.js";
import { KataRegistry } from "../src/kata/registry.js";
import { toKebabCase } from "../src/duty/duty-authoring.js";
import { cronToHuman } from "../src/contract/cron.js";
import { conditionToHuman } from "../src/kata/conditions.js";
import type { TriggerConfig } from "../src/types/shared.js";
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

export default class ContractExecutorAgent extends BaseDuty {
  private cronEngine: CronEngine;
  private contractEngine: ContractEngine;
  private eventEngine: EventTriggerEngine;
  private proposalStorage: ContractProposalStorage;

  constructor(api: DutyAPI) {
    super(api);
    this.cronEngine = new CronEngine(api);
    this.contractEngine = new ContractEngine(api);
    this.eventEngine = new EventTriggerEngine(api);
    this.proposalStorage = new ContractProposalStorage(api);
    this.registerRoutes();
    this.registerTool();
  }

  async execute(): Promise<void> {
    try {
      // Start contract engines
      this.cronEngine.start();
      this.contractEngine.start();
      this.eventEngine.start();

      this.logger.info("Contract, Cron, and Event-trigger engines started");
    } catch (error) {
      this.logger.error(
        `Failed to start contract engines: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Tool Chatty can call mid-conversation to draft an event/cron-triggered
   * automation ("reflex") from plain English — e.g. "when trust drops below
   * 40, do a quiet handoff, then notify me". Never registers anything
   * directly: it drafts, persists a pending proposal, and returns its id +
   * a deterministic plain-language preview for the chat UI to render as an
   * approval card (see /api/contracts/proposals/approve|refuse below).
   */
  private registerTool(): void {
    this.api.tools.register({
      name: "contracts.proposeReflex",
      description:
        "Draft an event- or schedule-triggered automation from a plain-English request (e.g. \"when X happens, do Y, then notify me\", \"every day at 9am, do Z\"). " +
        "Never registers anything directly — it drafts a proposal and returns its id plus a plain-language preview for the user to approve or refuse via a card in the chat UI. " +
        "If the user asks to revise a proposal they were just shown (visible earlier in this conversation as a contract-proposal block with an \"id\" field), pass that id as reviseProposalId so the new draft supersedes it.",
      parameters: {
        type: "object",
        properties: {
          intent: {
            type: "string",
            description: "The plain-English automation request, verbatim or lightly cleaned up from what the user said.",
          },
          reviseProposalId: {
            type: "string",
            description: "Optional: the id of a prior pending proposal this draft revises/replaces.",
          },
        },
        required: ["intent"],
      },
      provider: "contract-executor",
      handler: async (args: { intent: string; reviseProposalId?: string }) => {
        const callId = `contracts-propose-${Date.now()}`;
        try {
          const proposal = await proposeContract(args.intent, this.api);
          const rec = await this.proposalStorage.create({
            intent: args.intent,
            contract: proposal.contract,
            kataDsl: proposal.kataDsl,
            preview: proposal.preview,
            supersedesId: args.reviseProposalId,
          });

          return {
            success: true,
            data: { id: rec.id, preview: rec.preview, contractName: proposal.contract.name },
            metadata: {
              toolName: "contracts.proposeReflex",
              provider: "contract-executor",
              duration: 0,
              cached: false,
              timestamp: Date.now(),
              callId,
            },
          };
        } catch (error) {
          const msg = error instanceof ContractProposeError || error instanceof Error
            ? error.message
            : String(error);
          return {
            success: false,
            data: null,
            error: msg,
            metadata: {
              toolName: "contracts.proposeReflex",
              provider: "contract-executor",
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
   * Approve/refuse API for AI-drafted contract proposals (from Chatty's
   * contracts.proposeReflex tool, or the /contracts dashboard review page).
   * Mirrors duties/manual-approval.ts's shape: flat routes, target id in the
   * POST body rather than a dynamic path segment (registerRoute doesn't
   * support path params here).
   */
  private registerRoutes(): void {
    this.api.http.registerRoute("/contracts", this.handleContractsPage.bind(this));
    this.api.http.registerRoute("/api/contracts/proposals", this.handleListProposals.bind(this));
    this.api.http.registerRoute("/api/contracts/proposals/approve", this.handleApproveProposal.bind(this));
    this.api.http.registerRoute("/api/contracts/proposals/refuse", this.handleRefuseProposal.bind(this));
  }

  /**
   * Dashboard review page: active contracts + any pending AI-drafted proposals,
   * both rendered with the same deterministic trigger/condition formatters used
   * by the chat approval card (never raw JSON) so there's one review surface
   * whether or not the user is mid-conversation.
   */
  private async handleContractsPage(req: Request): Promise<Response> {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });

    const contractStorage = new ContractStorageV2(this.api);
    const [contracts, proposals] = await Promise.all([
      contractStorage.list({ sort: "name" }),
      this.proposalStorage.listPending(),
    ]);

    const contractRows = contracts.map((row) => {
      let triggerText = row.trigger_type;
      try {
        const cfg = JSON.parse(row.trigger_config) as TriggerConfig;
        if (cfg.type === "cron") triggerText = cronToHuman(cfg.expression);
        else if (cfg.type === "event") {
          triggerText = `when ${cfg.eventType} fires` + (cfg.condition ? ` and ${conditionToHuman(cfg.condition)}` : "");
        }
      } catch { /* leave as raw trigger_type */ }

      return `
        <div class="contract-row">
          <div class="contract-row-main">
            <strong>${escapeHtml(row.name)}</strong>
            <span class="contract-status ${row.enabled ? "enabled" : "disabled"}">${row.enabled ? "Enabled" : "Disabled"}</span>
          </div>
          <div class="contract-row-detail">${escapeHtml(triggerText)} → runs kata '${escapeHtml(row.target_kata)}'</div>
          <div class="contract-row-meta">Executions: ${row.execution_count}${row.last_executed_at ? ` · Last: ${new Date(row.last_executed_at).toLocaleString()}` : ""}</div>
        </div>`;
    }).join("\n") || `<div class="empty-state">No contracts registered yet.</div>`;

    const proposalCards = proposals.map((p) => `
      <div class="proposal-card" data-proposal-id="${escapeHtml(p.id)}">
        <div class="proposal-card-preview">${escapeHtml(p.preview)}</div>
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
  <title>Contracts - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS(dramTheme)}
    ${getSharedUIPrimitivesCSS(dramTheme, { variant: "dram" })}
    ${getHeaderBarCSS(dramTheme)}

    body { padding: 0; margin: 0; }

    .page-content {
      max-width: 900px;
      margin: 0 auto;
      padding: ${dramTheme.spacing.lg};
    }

    .section-title {
      font-size: 0.9375rem;
      font-weight: 500;
      margin: ${dramTheme.spacing.lg} 0 ${dramTheme.spacing.sm};
      color: ${dramTheme.colors.textPrimary};
    }

    .contract-row {
      padding: ${dramTheme.spacing.md};
      border: 1px solid ${dramTheme.colors.border};
      border-radius: ${dramTheme.borderRadius.md};
      margin-bottom: ${dramTheme.spacing.sm};
      background: ${dramTheme.colors.backgroundSecondary};
    }

    .contract-row-main {
      display: flex;
      align-items: center;
      gap: ${dramTheme.spacing.sm};
      margin-bottom: ${dramTheme.spacing.xs};
    }

    .contract-status {
      font-size: 0.6875rem;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid;
    }
    .contract-status.enabled { color: ${dramTheme.colors.success}; border-color: ${dramTheme.colors.success}; }
    .contract-status.disabled { color: ${dramTheme.colors.textTertiary}; border-color: ${dramTheme.colors.border}; }

    .contract-row-detail {
      font-size: 0.8125rem;
      color: ${dramTheme.colors.textSecondary};
    }

    .contract-row-meta {
      font-size: 0.75rem;
      color: ${dramTheme.colors.textTertiary};
      margin-top: ${dramTheme.spacing.xs};
    }

    .empty-state {
      color: ${dramTheme.colors.textTertiary};
      font-size: 0.8125rem;
      padding: ${dramTheme.spacing.md} 0;
    }

    .proposal-card {
      margin-bottom: ${dramTheme.spacing.sm};
      padding: ${dramTheme.spacing.md};
      border-radius: ${dramTheme.borderRadius.md};
      background: ${dramTheme.colors.backgroundTertiary};
      border: 1px solid ${dramTheme.colors.border};
    }
    .proposal-card-preview {
      font-size: 0.8125rem;
      line-height: 1.6;
      color: ${dramTheme.colors.textPrimary};
      margin-bottom: ${dramTheme.spacing.sm};
    }
    .proposal-card-actions { display: flex; gap: ${dramTheme.spacing.sm}; }
    .proposal-card-actions button {
      flex: 1;
      padding: ${dramTheme.spacing.xs} ${dramTheme.spacing.md};
      border-radius: ${dramTheme.borderRadius.sm};
      border: 1px solid ${dramTheme.colors.border};
      background: transparent;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .proposal-card-allow { color: ${dramTheme.colors.success}; border-color: ${dramTheme.colors.success} !important; }
    .proposal-card-refuse { color: ${dramTheme.colors.error}; border-color: ${dramTheme.colors.error} !important; }
    .proposal-card-actions button:disabled { opacity: 0.5; cursor: default; }
    .proposal-card-status { font-size: 0.75rem; color: ${dramTheme.colors.textSecondary}; }
  </style>
</head>
<body>
  <div class="header">
    ${getHeaderHomeIconHTML()}
    <h1>📜 Contracts</h1>
    <div class="header-meta">
      <span>Event/schedule-triggered automations</span>
    </div>
  </div>

  <div class="page-content">
    <div class="section-title">Pending Proposals</div>
    <div id="proposals">${proposalCards}</div>

    <div class="section-title">Active Contracts</div>
    <div id="contracts">${contractRows}</div>
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
        const res = await fetch('/api/contracts/proposals/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.success !== false) {
          actionsEl.innerHTML = action === 'approve'
            ? '<span class="proposal-card-status">✅ Approved' + (body.contractName ? ' — ' + escapeHtml(body.contractName) + ' is now active' : '') + '</span>'
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
      console.error(`[contract-executor] Failed to list contract proposals: ${error}`);
      return new Response("Internal server error", { status: 500 });
    }
  }

  private async handleApproveProposal(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const { id, name: nameOverride } = await req.json() as { id?: string; name?: string };
      if (!id) return new Response("Missing id", { status: 400 });

      const proposal = await this.proposalStorage.getById(id);
      if (!proposal) return new Response("Proposal not found", { status: 404 });
      if (proposal.status !== "pending") {
        return Response.json({ success: false, message: `Proposal is already ${proposal.status}` }, { status: 409 });
      }

      if (proposal.kataDsl) {
        const registry = new KataRegistry(this.api);
        await registry.register(proposal.kataDsl);
      }

      const contractStorage = new ContractStorageV2(this.api);

      // The AI-derived name is just a first guess — let the human rename it
      // at approval time, since that's the only name they'll look it up by.
      let finalName = proposal.contract.name;
      if (nameOverride && nameOverride.trim()) {
        const candidate = toKebabCase(nameOverride.trim());
        if (!candidate) {
          return Response.json({ success: false, message: "Contract name can't be empty after normalizing" }, { status: 400 });
        }
        if (candidate !== proposal.contract.name && (await contractStorage.getByName(candidate))) {
          return Response.json({ success: false, message: `A contract named '${candidate}' already exists` }, { status: 409 });
        }
        finalName = candidate;
      }

      await contractStorage.create({ ...proposal.contract, name: finalName, enabled: true });
      await this.proposalStorage.decide(id, "approved", finalName);

      this.api.events?.emit(
        "contract.proposal_approved",
        { id, contractName: finalName, timestamp: Date.now() },
        "contract-executor"
      );

      console.log(`[contract-executor] Contract proposal approved: ${finalName} (${id})`);
      return Response.json({ success: true, contractName: finalName });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[contract-executor] Failed to approve contract proposal: ${msg}`);
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
        "contract.proposal_refused",
        { id, timestamp: Date.now() },
        "contract-executor"
      );

      console.log(`[contract-executor] Contract proposal refused: ${id}`);
      return Response.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[contract-executor] Failed to refuse contract proposal: ${msg}`);
      return Response.json({ success: false, message: msg }, { status: 500 });
    }
  }
}
