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
import { KataStorage } from "../src/task/storage.js";
import { toKebabCase } from "../src/duty/duty-authoring.js";
import { cronToHuman, getNextCronRun } from "../src/contract/cron.js";
import { conditionToHuman } from "../src/kata/conditions.js";
import type { TriggerConfig, ContractV2Definition } from "../src/types/shared.js";
import { hankoTheme, getAdobeCleanFontFaceCSS, getThemeCSS, getSharedUIPrimitivesCSS, getHeaderBarCSS, getHeaderHomeIconHTML } from "../src/utils/theme.js";

/** Prefix route for /api/contracts/item/<name> and /api/contracts/item/<name>/chat
 *  — a distinct sub-path from /api/contracts/proposals* so it can never collide,
 *  dispatched manually the same way duties/workflow-manager.ts's API_PREFIX is. */
const ITEM_PREFIX = "/api/contracts/item/";

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

      console.log("[contract-executor] Contract, Cron, and Event-trigger engines started");
    } catch (error) {
      console.error(
        `[contract-executor] Failed to start contract engines: ${error instanceof Error ? error.message : String(error)}`
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
        "Draft an event- or schedule-triggered automation from a plain-English request. " +
        "Call this IMMEDIATELY, with no other tool calls first, whenever the user says anything like " +
        "\"I want a new contract\", \"create/propose/set up a contract\", \"when X happens, do Y, then notify me\", or \"every day at 9am, do Z\" — " +
        "pass their whole request as intent, verbatim. " +
        "Do NOT try to fulfill the described task live yourself first (e.g. do not call discord/telegram/other tools to actually read messages or send anything) — " +
        "drafting the contract is the entire job; the described task only ever runs later, on its own schedule/trigger, after the user approves the proposal. " +
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
    this.api.http.registerRoute(ITEM_PREFIX, this.handleContractItemRoute.bind(this));
  }

  /**
   * Manual CRUD + per-contract chat for a single contract, by name. Exact
   * routes above win first (DutyRegistry resolves exact matches before
   * trailing-slash prefix routes), so this never intercepts /proposals*.
   */
  private async handleContractItemRoute(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const rest = decodeURIComponent(url.pathname.slice(ITEM_PREFIX.length)).replace(/\/+$/, "");
    if (!rest) return new Response("Not found", { status: 404 });

    if (rest.endsWith("/chat")) {
      return this.handleContractChat(req, rest.slice(0, -"/chat".length));
    }

    const name = rest;
    if (req.method === "GET") return this.handleGetContract(name);
    if (req.method === "POST") return this.handleSaveContract(req, name);
    if (req.method === "DELETE") return this.handleDeleteContract(name);
    return new Response("Method not allowed", { status: 405 });
  }

  private async handleGetContract(name: string): Promise<Response> {
    const contractStorage = new ContractStorageV2(this.api);
    const row = await contractStorage.getByName(name);
    if (!row) return new Response("Not found", { status: 404 });
    return Response.json({
      ...row,
      trigger_config: JSON.parse(row.trigger_config),
      parameters: row.parameters ? JSON.parse(row.parameters) : {},
    });
  }

  /**
   * Manual create-or-update, no approval gate — this is the direct-authoring
   * path alongside contracts.proposeReflex's AI-drafted-then-approved one.
   * When the body includes a freshly chat-drafted kataDsl, register it first
   * (same ordering handleApproveProposal already uses below) so target_kata/
   * target_kata_version point at a real, compiled kata before the row is written.
   */
  private async handleSaveContract(req: Request, name: string): Promise<Response> {
    try {
      const body = await req.json() as {
        description?: string;
        triggerType?: "cron" | "event";
        triggerConfig?: TriggerConfig;
        targetKata?: string;
        targetKataVersion?: string;
        parameters?: Record<string, unknown>;
        onFailureAction?: "retry" | "alert" | "ignore";
        enabled?: boolean;
        kataDsl?: string;
      };

      const kebabName = toKebabCase(name);
      if (!kebabName) return Response.json({ success: false, message: "Invalid contract name" }, { status: 400 });

      if (body.triggerConfig?.type === "cron") {
        if (!getNextCronRun(body.triggerConfig.expression)) {
          return Response.json({ success: false, message: `Invalid cron expression: ${body.triggerConfig.expression}` }, { status: 400 });
        }
      } else if (body.triggerConfig?.type === "event") {
        if (!body.triggerConfig.eventType?.trim()) {
          return Response.json({ success: false, message: "Event type required" }, { status: 400 });
        }
      }

      let targetKata = body.targetKata;
      let targetKataVersion = body.targetKataVersion || "v1";
      if (body.kataDsl) {
        const registry = new KataRegistry(this.api);
        const compiled = await registry.register(body.kataDsl);
        targetKata = compiled.name;
        targetKataVersion = compiled.version;
      }

      const contractStorage = new ContractStorageV2(this.api);
      const existing = await contractStorage.getByName(kebabName);

      if (!existing) {
        if (!targetKata) return Response.json({ success: false, message: "Target kata required" }, { status: 400 });
        if (!body.triggerType || !body.triggerConfig) return Response.json({ success: false, message: "Trigger required" }, { status: 400 });
        const def: ContractV2Definition = {
          name: kebabName,
          version: "v1",
          description: body.description,
          targetKata,
          targetKataVersion,
          parameters: body.parameters ?? {},
          triggerType: body.triggerType,
          triggerConfig: body.triggerConfig,
          onFailureAction: body.onFailureAction ?? "ignore",
          enabled: body.enabled ?? true,
        };
        await contractStorage.create(def);
      } else {
        const fields: Record<string, unknown> = {};
        if (body.description !== undefined) fields.description = body.description;
        if (targetKata !== undefined) fields.target_kata = targetKata;
        if (targetKataVersion !== undefined) fields.target_kata_version = targetKataVersion;
        if (body.parameters !== undefined) fields.parameters = Object.keys(body.parameters).length > 0 ? JSON.stringify(body.parameters) : null;
        if (body.triggerType !== undefined) fields.trigger_type = body.triggerType;
        if (body.triggerConfig !== undefined) fields.trigger_config = JSON.stringify(body.triggerConfig);
        if (body.onFailureAction !== undefined) fields.on_failure_action = body.onFailureAction;
        if (body.enabled !== undefined) fields.enabled = body.enabled ? 1 : 0;
        await contractStorage.update(kebabName, fields);
      }

      return Response.json({ success: true, name: kebabName });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return Response.json({ success: false, message: msg }, { status: 400 });
    }
  }

  private async handleDeleteContract(name: string): Promise<Response> {
    const contractStorage = new ContractStorageV2(this.api);
    const existing = await contractStorage.getByName(name);
    if (!existing) return Response.json({ success: false, message: "Not found" }, { status: 404 });
    await contractStorage.delete(name);
    return Response.json({ success: true });
  }

  /**
   * One discussion turn scoped to a single contract (or "_new" for a
   * not-yet-created one, same sentinel workflow-manager.ts's chat uses).
   * Always redrafts the full contract (trigger + kata) via the same
   * proposeContract() pipeline contracts.proposeReflex uses — reuses its
   * skill catalog, retry loop, and validation untouched. Never auto-saves:
   * returns a draft for the client to apply into the form, Save is separate.
   */
  private async handleContractChat(req: Request, name: string): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const { message } = await req.json() as { message?: string };
      if (!message?.trim()) return Response.json({ error: "message required" }, { status: 400 });

      const isNew = name === "_new";
      const contractStorage = new ContractStorageV2(this.api);
      const existing = isNew ? null : await contractStorage.getByName(name);

      let intent: string;
      if (existing) {
        let triggerText = existing.trigger_type;
        try {
          const cfg = JSON.parse(existing.trigger_config) as TriggerConfig;
          if (cfg.type === "cron") triggerText = cronToHuman(cfg.expression);
          else if (cfg.type === "event") {
            triggerText = `when ${cfg.eventType} fires` + (cfg.condition ? ` and ${conditionToHuman(cfg.condition)}` : "");
          }
        } catch { /* leave as raw trigger_type */ }
        intent = `Revise this existing contract named "${existing.name}":\n  Description: ${existing.description ?? "(none)"}\n  Trigger: ${triggerText}\n  Target kata: ${existing.target_kata} v${existing.target_kata_version}\n\nUser's requested change: ${message}`;
      } else {
        intent = message;
      }

      const proposal = await proposeContract(intent, this.api);
      return Response.json({
        reply: proposal.preview,
        draft: {
          description: proposal.contract.description,
          triggerType: proposal.contract.triggerType,
          triggerConfig: proposal.contract.triggerConfig,
          targetKata: proposal.contract.targetKata,
          targetKataVersion: proposal.contract.targetKataVersion,
          kataDsl: proposal.kataDsl,
        },
      });
    } catch (error) {
      const msg = error instanceof ContractProposeError || error instanceof Error ? error.message : String(error);
      return Response.json({ reply: `Couldn't draft that: ${msg}` });
    }
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
    const kataStorage = new KataStorage(this.api);
    const [contracts, proposals, katas] = await Promise.all([
      contractStorage.list({ sort: "name" }),
      this.proposalStorage.listPending(),
      kataStorage.list(),
    ]);

    const triggerTextOf = (row: { trigger_type: string; trigger_config: string }): string => {
      try {
        const cfg = JSON.parse(row.trigger_config) as TriggerConfig;
        if (cfg.type === "cron") return cronToHuman(cfg.expression);
        if (cfg.type === "event") return `when ${cfg.eventType} fires` + (cfg.condition ? ` and ${conditionToHuman(cfg.condition)}` : "");
      } catch { /* leave as raw trigger_type */ }
      return row.trigger_type;
    };

    const contractItems = contracts.map((row) => `
      <div class="contract-item" data-name="${escapeHtml(row.name)}" onclick="selectContract('${escapeHtml(row.name)}')">
        <div class="contract-item-main">
          <strong>${escapeHtml(row.name)}</strong>
          <span class="contract-status ${row.enabled ? "enabled" : "disabled"}">${row.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <div class="contract-item-detail">${escapeHtml(triggerTextOf(row))} → runs kata '${escapeHtml(row.target_kata)}'</div>
        <div class="contract-item-meta">Executions: ${row.execution_count}${row.last_executed_at ? ` · Last: ${new Date(row.last_executed_at).toLocaleString()}` : ""}</div>
        <div class="contract-item-actions">
          <button onclick="event.stopPropagation(); toggleEnabled('${escapeHtml(row.name)}', ${row.enabled ? "true" : "false"})">${row.enabled ? "Disable" : "Enable"}</button>
          <button class="btn-delete" onclick="event.stopPropagation(); deleteContractByName('${escapeHtml(row.name)}')">Delete</button>
        </div>
      </div>`).join("\n") || `<div class="empty-state">No contracts registered yet. Click "+ New" or discuss one below.</div>`;

    const proposalCards = proposals.map((p) => `
      <div class="proposal-card" data-proposal-id="${escapeHtml(p.id)}">
        <div class="proposal-card-preview">${escapeHtml(p.preview)}</div>
        <div class="proposal-card-actions">
          <button class="proposal-card-allow" onclick="decideProposal('${escapeHtml(p.id)}','approve',this.parentElement)">Allow</button>
          <button class="proposal-card-refuse" onclick="decideProposal('${escapeHtml(p.id)}','refuse',this.parentElement)">Refuse</button>
        </div>
      </div>`).join("\n") || `<div class="empty-state">No pending proposals.</div>`;

    const kataOptions = katas.map((k) => `<option value="${escapeHtml(k.name)}">${escapeHtml(k.name)} (${escapeHtml(k.version)})</option>`).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contracts - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS(hankoTheme)}
    ${getSharedUIPrimitivesCSS(hankoTheme, { variant: "hanko" })}
    ${getHeaderBarCSS(hankoTheme)}

    body { padding: 0; margin: 0; }

    .page-content {
      max-width: 1280px;
      margin: 0 auto;
      padding: ${hankoTheme.spacing.lg};
      display: grid;
      grid-template-columns: 340px minmax(0, 1fr);
      gap: ${hankoTheme.spacing.lg};
    }

    .section-title {
      font-size: 0.9375rem;
      font-weight: 500;
      margin: 0 0 ${hankoTheme.spacing.sm};
      color: ${hankoTheme.colors.textPrimary};
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .section-title + .section-title { margin-top: ${hankoTheme.spacing.lg}; }

    .btn-new {
      font-size: 0.75rem;
      padding: 4px 10px;
      border-radius: ${hankoTheme.borderRadius.sm};
      border: 1px solid ${hankoTheme.colors.border};
      background: transparent;
      color: ${hankoTheme.colors.textPrimary};
      cursor: pointer;
    }
    .btn-new:hover { background: ${hankoTheme.colors.backgroundTertiary}; }

    .contract-item {
      padding: ${hankoTheme.spacing.sm} ${hankoTheme.spacing.md};
      border: 1px solid ${hankoTheme.colors.border};
      border-radius: ${hankoTheme.borderRadius.md};
      margin-bottom: ${hankoTheme.spacing.xs};
      background: ${hankoTheme.colors.backgroundSecondary};
      cursor: pointer;
    }
    .contract-item:hover { border-color: ${hankoTheme.colors.textTertiary}; }
    .contract-item.selected { border-color: ${hankoTheme.colors.accent}; }
    .contract-item-main { display: flex; align-items: center; gap: ${hankoTheme.spacing.sm}; margin-bottom: 2px; }
    .contract-item-detail { font-size: 0.8125rem; color: ${hankoTheme.colors.textSecondary}; }
    .contract-item-meta { font-size: 0.75rem; color: ${hankoTheme.colors.textTertiary}; margin-top: 2px; }
    .contract-item-actions { margin-top: ${hankoTheme.spacing.xs}; display: flex; gap: 6px; }
    .contract-item-actions button { font-size: 0.6875rem; padding: 2px 8px; border-radius: ${hankoTheme.borderRadius.sm}; border: 1px solid ${hankoTheme.colors.border}; background: transparent; color: ${hankoTheme.colors.textSecondary}; cursor: pointer; }
    .contract-item-actions button:hover { background: ${hankoTheme.colors.backgroundTertiary}; }
    .contract-item-actions .btn-delete { color: ${hankoTheme.colors.error}; border-color: ${hankoTheme.colors.error}; }

    .contract-status { font-size: 0.6875rem; padding: 2px 8px; border-radius: 999px; border: 1px solid; }
    .contract-status.enabled { color: ${hankoTheme.colors.success}; border-color: ${hankoTheme.colors.success}; }
    .contract-status.disabled { color: ${hankoTheme.colors.textTertiary}; border-color: ${hankoTheme.colors.border}; }

    .empty-state { color: ${hankoTheme.colors.textTertiary}; font-size: 0.8125rem; padding: ${hankoTheme.spacing.md} 0; }

    .detail-panel {
      border: 1px solid ${hankoTheme.colors.border};
      border-radius: ${hankoTheme.borderRadius.md};
      background: ${hankoTheme.colors.backgroundSecondary};
      padding: ${hankoTheme.spacing.md};
      margin-bottom: ${hankoTheme.spacing.lg};
    }
    .detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: ${hankoTheme.spacing.sm}; gap: ${hankoTheme.spacing.sm}; }
    .detail-header input { flex: 1; background: transparent; border: none; color: ${hankoTheme.colors.textPrimary}; font-size: 1rem; font-weight: 500; }
    .detail-actions { display: flex; gap: ${hankoTheme.spacing.xs}; flex-shrink: 0; }
    .detail-actions button {
      font-size: 0.75rem; padding: 5px 10px; border-radius: ${hankoTheme.borderRadius.sm};
      border: 1px solid ${hankoTheme.colors.border}; background: transparent; color: ${hankoTheme.colors.textPrimary}; cursor: pointer;
    }
    .detail-actions button:hover { background: ${hankoTheme.colors.backgroundTertiary}; }
    .detail-actions .btn-save { color: ${hankoTheme.colors.success}; border-color: ${hankoTheme.colors.success}; }
    .detail-actions .btn-delete { color: ${hankoTheme.colors.error}; border-color: ${hankoTheme.colors.error}; }

    .field-row { margin-bottom: ${hankoTheme.spacing.sm}; }
    .field-row label { display: block; font-size: 0.75rem; color: ${hankoTheme.colors.textTertiary}; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.04em; }
    .field-row input[type="text"], .field-row select, .field-row textarea {
      width: 100%; box-sizing: border-box; background: ${hankoTheme.colors.backgroundTertiary}; color: ${hankoTheme.colors.textPrimary};
      border: 1px solid ${hankoTheme.colors.border}; border-radius: ${hankoTheme.borderRadius.sm}; padding: 6px 8px; font-family: inherit; font-size: 0.8125rem;
    }
    .field-row textarea { min-height: 60px; font-family: ${hankoTheme.fonts.mono}; resize: vertical; }
    .field-row-inline { display: flex; align-items: center; gap: ${hankoTheme.spacing.xs}; }
    .field-cols { display: grid; grid-template-columns: 1fr 1fr; gap: ${hankoTheme.spacing.sm}; }

    .save-status { font-size: 0.75rem; color: ${hankoTheme.colors.textSecondary}; margin-top: ${hankoTheme.spacing.xs}; min-height: 1.1em; }

    .discuss-panel { border: 1px solid ${hankoTheme.colors.border}; border-radius: ${hankoTheme.borderRadius.md}; background: ${hankoTheme.colors.backgroundSecondary}; padding: ${hankoTheme.spacing.md}; }
    #discuss-log { max-height: 260px; overflow-y: auto; margin-bottom: ${hankoTheme.spacing.sm}; }
    .discuss-msg { font-size: 0.8125rem; line-height: 1.5; margin-bottom: ${hankoTheme.spacing.sm}; }
    .discuss-msg.user { color: ${hankoTheme.colors.textPrimary}; }
    .discuss-msg.assistant { color: ${hankoTheme.colors.textSecondary}; }
    .discuss-msg .who { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: ${hankoTheme.colors.textTertiary}; display: block; margin-bottom: 2px; }
    .discuss-draft-actions { margin-top: 4px; }
    .discuss-draft-actions button { font-size: 0.75rem; padding: 3px 9px; border-radius: ${hankoTheme.borderRadius.sm}; border: 1px solid ${hankoTheme.colors.success}; color: ${hankoTheme.colors.success}; background: transparent; cursor: pointer; }
    .discuss-input-row { display: flex; gap: ${hankoTheme.spacing.sm}; }
    .discuss-input-row textarea { flex: 1; min-height: 44px; resize: vertical; background: ${hankoTheme.colors.backgroundTertiary}; color: ${hankoTheme.colors.textPrimary}; border: 1px solid ${hankoTheme.colors.border}; border-radius: ${hankoTheme.borderRadius.sm}; padding: ${hankoTheme.spacing.xs} ${hankoTheme.spacing.sm}; font-family: inherit; font-size: 0.8125rem; }
    .discuss-input-row button { align-self: flex-end; padding: ${hankoTheme.spacing.xs} ${hankoTheme.spacing.md}; border-radius: ${hankoTheme.borderRadius.sm}; border: 1px solid ${hankoTheme.colors.border}; background: ${hankoTheme.colors.backgroundTertiary}; color: ${hankoTheme.colors.textPrimary}; cursor: pointer; }

    .proposal-card { margin-bottom: ${hankoTheme.spacing.sm}; padding: ${hankoTheme.spacing.md}; border-radius: ${hankoTheme.borderRadius.md}; background: ${hankoTheme.colors.backgroundTertiary}; border: 1px solid ${hankoTheme.colors.border}; }
    .proposal-card-preview { font-size: 0.8125rem; line-height: 1.6; color: ${hankoTheme.colors.textPrimary}; margin-bottom: ${hankoTheme.spacing.sm}; }
    .proposal-card-actions { display: flex; gap: ${hankoTheme.spacing.sm}; }
    .proposal-card-actions button { flex: 1; padding: ${hankoTheme.spacing.xs} ${hankoTheme.spacing.md}; border-radius: ${hankoTheme.borderRadius.sm}; border: 1px solid ${hankoTheme.colors.border}; background: transparent; cursor: pointer; font-size: 0.75rem; font-weight: 500; }
    .proposal-card-allow { color: ${hankoTheme.colors.success}; border-color: ${hankoTheme.colors.success} !important; }
    .proposal-card-refuse { color: ${hankoTheme.colors.error}; border-color: ${hankoTheme.colors.error} !important; }
    .proposal-card-actions button:disabled { opacity: 0.5; cursor: default; }
    .proposal-card-status { font-size: 0.75rem; color: ${hankoTheme.colors.textSecondary}; }
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
    <div>
      <div class="section-title">Active Contracts <button class="btn-new" onclick="newContract()">+ New</button></div>
      <div id="contracts">${contractItems}</div>

      <div class="section-title">Pending Proposals</div>
      <div id="proposals">${proposalCards}</div>
    </div>

    <div>
      <div class="detail-panel" id="detail-panel" style="display:none;">
        <div class="detail-header">
          <input id="detail-name" placeholder="contract-name" />
          <div class="detail-actions">
            <button class="btn-save" onclick="saveContract()">Save</button>
            <button class="btn-delete" onclick="deleteCurrentContract()">Delete</button>
          </div>
        </div>

        <div class="field-row">
          <label>Description</label>
          <input type="text" id="f-description" placeholder="What this contract does" />
        </div>

        <div class="field-cols">
          <div class="field-row">
            <label>Trigger</label>
            <select id="f-trigger-type" onchange="applyTriggerType()">
              <option value="cron">Cron (schedule)</option>
              <option value="event">Event</option>
            </select>
          </div>
          <div class="field-row">
            <label>Target Kata</label>
            <select id="f-kata">${kataOptions}</select>
          </div>
        </div>

        <div class="field-row" id="f-cron-row">
          <label>Cron expression</label>
          <input type="text" id="f-cron-expr" placeholder="0 9 * * *" />
        </div>
        <div class="field-row" id="f-event-row" style="display:none;">
          <label>Event type</label>
          <input type="text" id="f-event-type" placeholder="dot.separated.event.name" />
          <div class="field-cols" style="margin-top:${hankoTheme.spacing.xs};">
            <input type="text" id="f-cond-variable" placeholder="condition variable (optional)" />
            <input type="text" id="f-cond-operator" placeholder="== != > >= < <= in contains" />
          </div>
          <input type="text" id="f-cond-value" placeholder="condition value (optional)" style="margin-top:${hankoTheme.spacing.xs};" />
        </div>

        <div class="field-cols">
          <div class="field-row">
            <label>On Failure</label>
            <select id="f-on-failure">
              <option value="ignore">Ignore</option>
              <option value="alert">Alert</option>
              <option value="retry">Retry</option>
            </select>
          </div>
          <div class="field-row field-row-inline" style="margin-top: 20px;">
            <input type="checkbox" id="f-enabled" checked />
            <label style="margin:0;text-transform:none;">Enabled</label>
          </div>
        </div>

        <div class="field-row">
          <label>Parameters (JSON, optional)</label>
          <textarea id="f-parameters" placeholder="{}"></textarea>
        </div>

        <div class="save-status" id="save-status"></div>
      </div>
      <div class="empty-state" id="no-selection">Select a contract, or click "+ New" — or just start discussing one below.</div>

      <div class="discuss-panel">
        <div class="section-title">Discuss</div>
        <div id="discuss-log"></div>
        <div class="discuss-input-row">
          <textarea id="discuss-input" placeholder="Discuss the selected contract, or describe a new one to draft..."></textarea>
          <button onclick="sendDiscussMessage()">Send</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    function esc(v){return String(v||'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

    let selectedName = null; // null while nothing selected/new
    let pendingKataDsl = undefined; // set when a chat draft included a new kata, cleared on select/new/save

    function showDetail() {
      document.getElementById('detail-panel').style.display = '';
      document.getElementById('no-selection').style.display = 'none';
    }

    function applyTriggerType() {
      const t = document.getElementById('f-trigger-type').value;
      document.getElementById('f-cron-row').style.display = t === 'cron' ? '' : 'none';
      document.getElementById('f-event-row').style.display = t === 'event' ? '' : 'none';
    }

    function fillForm(data) {
      document.getElementById('f-description').value = data.description || '';
      document.getElementById('f-trigger-type').value = data.triggerType || 'cron';
      const cfg = data.triggerConfig || {};
      document.getElementById('f-cron-expr').value = cfg.type === 'cron' ? (cfg.expression || '') : '';
      document.getElementById('f-event-type').value = cfg.type === 'event' ? (cfg.eventType || '') : '';
      const cond = cfg.type === 'event' ? cfg.condition : null;
      document.getElementById('f-cond-variable').value = cond ? (cond.variable || '') : '';
      document.getElementById('f-cond-operator').value = cond ? (cond.operator || '') : '';
      document.getElementById('f-cond-value').value = cond && cond.value !== undefined ? String(cond.value) : '';
      applyTriggerType();
      document.getElementById('f-kata').value = data.targetKata || '';
      document.getElementById('f-on-failure').value = data.onFailureAction || 'ignore';
      document.getElementById('f-enabled').checked = data.enabled !== false;
      document.getElementById('f-parameters').value = data.parameters && Object.keys(data.parameters).length ? JSON.stringify(data.parameters, null, 2) : '';
    }

    async function selectContract(name) {
      const res = await fetch('/api/contracts/item/' + encodeURIComponent(name));
      if (!res.ok) return;
      const data = await res.json();
      selectedName = name;
      pendingKataDsl = undefined;
      showDetail();
      document.querySelectorAll('.contract-item').forEach(el => el.classList.toggle('selected', el.dataset.name === name));
      document.getElementById('detail-name').value = name;
      document.getElementById('detail-name').disabled = true;
      fillForm(data);
      document.getElementById('save-status').textContent = '';
    }

    function newContract() {
      selectedName = null;
      pendingKataDsl = undefined;
      showDetail();
      document.querySelectorAll('.contract-item').forEach(el => el.classList.remove('selected'));
      document.getElementById('detail-name').value = '';
      document.getElementById('detail-name').disabled = false;
      fillForm({ triggerType: 'cron', enabled: true });
      document.getElementById('save-status').textContent = '';
    }

    function readForm() {
      const triggerType = document.getElementById('f-trigger-type').value;
      let triggerConfig;
      if (triggerType === 'cron') {
        triggerConfig = { type: 'cron', expression: document.getElementById('f-cron-expr').value.trim() };
      } else {
        triggerConfig = { type: 'event', eventType: document.getElementById('f-event-type').value.trim() };
        const v = document.getElementById('f-cond-variable').value.trim();
        const op = document.getElementById('f-cond-operator').value.trim();
        const val = document.getElementById('f-cond-value').value.trim();
        if (v && op) {
          let parsedVal = val;
          try { parsedVal = JSON.parse(val); } catch (e) { /* keep as string */ }
          triggerConfig.condition = { variable: v, operator: op, value: parsedVal };
        }
      }
      let parameters = {};
      const rawParams = document.getElementById('f-parameters').value.trim();
      if (rawParams) {
        try { parameters = JSON.parse(rawParams); } catch (e) { throw new Error('Parameters must be valid JSON'); }
      }
      return {
        description: document.getElementById('f-description').value.trim(),
        triggerType,
        triggerConfig,
        targetKata: document.getElementById('f-kata').value,
        parameters,
        onFailureAction: document.getElementById('f-on-failure').value,
        enabled: document.getElementById('f-enabled').checked,
        kataDsl: pendingKataDsl,
      };
    }

    async function saveContract() {
      const nameField = document.getElementById('detail-name');
      const targetName = selectedName || nameField.value.trim();
      const statusEl = document.getElementById('save-status');
      if (!targetName) { statusEl.textContent = 'Name required.'; return; }
      let payload;
      try { payload = readForm(); } catch (e) { statusEl.textContent = e.message; return; }
      if (!payload.triggerConfig.expression && payload.triggerType === 'cron') { statusEl.textContent = 'Cron expression required.'; return; }
      if (!payload.triggerConfig.eventType && payload.triggerType === 'event') { statusEl.textContent = 'Event type required.'; return; }
      if (!payload.targetKata) { statusEl.textContent = 'Target kata required.'; return; }
      statusEl.textContent = 'Saving...';
      try {
        const res = await fetch('/api/contracts/item/' + encodeURIComponent(targetName), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.success) {
          statusEl.textContent = 'Saved.';
          selectedName = body.name;
          pendingKataDsl = undefined;
          nameField.value = body.name;
          nameField.disabled = true;
          await loadContractList();
          document.querySelectorAll('.contract-item').forEach(el => el.classList.toggle('selected', el.dataset.name === body.name));
        } else {
          statusEl.textContent = 'Failed: ' + (body.message || res.statusText);
        }
      } catch (e) {
        statusEl.textContent = 'Failed: network error';
      }
    }

    async function deleteContractByName(name) {
      if (!confirm('Delete contract "' + name + '"?')) return;
      const res = await fetch('/api/contracts/item/' + encodeURIComponent(name), { method: 'DELETE' });
      if (res.ok) {
        if (selectedName === name) {
          selectedName = null;
          document.getElementById('detail-panel').style.display = 'none';
          document.getElementById('no-selection').style.display = '';
        }
        await loadContractList();
      }
    }

    async function deleteCurrentContract() {
      if (!selectedName) { document.getElementById('detail-panel').style.display = 'none'; document.getElementById('no-selection').style.display = ''; return; }
      await deleteContractByName(selectedName);
    }

    async function toggleEnabled(name, currentlyEnabled) {
      await fetch('/api/contracts/item/' + encodeURIComponent(name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentlyEnabled }),
      });
      await loadContractList();
      if (selectedName === name) selectContract(name);
    }

    async function loadContractList() {
      const res = await fetch('/contracts');
      // Cheapest correct refresh given this page has no standalone list API:
      // reload for a fresh render rather than duplicating the row-template JS.
      location.reload();
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
            ? '<span class="proposal-card-status">✅ Approved' + (body.contractName ? ' — ' + esc(body.contractName) + ' is now active' : '') + '</span>'
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
        btn.textContent = 'Apply to form';
        btn.onclick = () => {
          if (!document.getElementById('detail-panel').style.display || document.getElementById('detail-panel').style.display === 'none') {
            showDetail();
            document.getElementById('detail-name').disabled = !selectedName;
          }
          fillForm(draft);
          pendingKataDsl = draft.kataDsl;
          document.getElementById('save-status').textContent = draft.kataDsl
            ? 'Draft applied (includes a new kata) — review and Save when ready.'
            : 'Draft applied — review and Save when ready.';
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
        const res = await fetch('/api/contracts/item/' + encodeURIComponent(target) + '/chat', {
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
