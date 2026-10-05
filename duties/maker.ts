/**
 * Maker Duty — the one capability-authoring flow.
 *
 * Merges three former duties:
 * - duty-executor: chat-reachable `duties.proposeDuty` tool + pending
 *   proposals + /duties/review approve-refuse gate. Approval never writes
 *   the draft to disk itself; it emits PlanProposed → PlanApproved and
 *   hands the real implementation to coder-bot (single-completion drafts
 *   have no compile-check loop).
 * - skill-maker: SAR-chain skill generator (`skill_maker.*` tools,
 *   create-skill / agent.task.failed events, `new-skill` emit).
 * - agent-creator-orchestrator: `create_agent` / `cancel_creation` events.
 *   The LangGraph path is deprecated — create_agent now drafts through the
 *   same proposeDuty pipeline above instead of shelling to a graph that
 *   writes agent files directly.
 */

import path from "path";
import { rmSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";
import type { ToolDefinition, ToolResult, ToolContext } from "../src/tools/types.js";
import { standardSAR } from "../src/chains/templates.js";
import type { ChainContext } from "../src/chain/types.js";
import { proposeDuty, DutyProposeError, DutyProposalStorage } from "../src/duty/index.js";
import { validateDutyCode, toKebabCase } from "../src/duty/duty-authoring.js";
import { resolveExternalDutyDir } from "../src/cli/commands/config.js";
import { kiosaTheme } from "../src/utils/theme.js";
import { getKiosaTopbarHTML, getKiosaFooterHTML, getKiosaAccentForPath, getKiosaStylesheetLink } from "../src/utils/kiosa.js";

const SOURCE = "maker";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SKILL_MAKER_ONTOLOGY_SKILLS = [
  "skill_maker.set_slug",
  "skill_maker.ensure_dir",
  "skill_maker.write_file",
  "skill_maker.list_dir",
  "skill_maker.finish",
  "local.memory.search",
  "mcp_brave-search_brave_web_search",
  "scrape_scrape_to_markdown",
];

function getSkillsDir(api: DutyAPI): string {
  const system = api.config.getSystem();
  return system.skillsDir ?? join(homedir(), ".ronin", "skills");
}

interface FailurePayload {
  taskId?: string;
  error?: string;
  agent?: string;
  failureNotes?: string;
  request?: string;
  description?: string;
  timestamp?: number;
  telegramChatId?: string | number;
  sourceChannel?: string;
  sourceUser?: string;
}

interface CreateSkillPayload {
  request: string;
  telegramChatId?: string | number;
  sourceChannel?: string;
  sourceUser?: string;
  source?: string;
}

function createSkillMakerTools(
  api: DutyAPI,
  slugMap: Map<string, string>,
  finishStatusMap: Map<string, "success" | "abort">
): ToolDefinition[] {
  const baseMeta = (name: string, duration: number) => ({
    toolName: name,
    provider: "skill_maker",
    duration,
    cached: false,
    timestamp: Date.now(),
    callId: `skill_maker-${Date.now()}`,
  });

  return [
    {
      name: "skill_maker.set_slug",
      description:
        "Set the skill slug (directory name) for this run. Call this first with a lowercase hyphenated name (e.g. log-monitor). All subsequent ensure_dir and write_file paths are relative to skills/<slug>.",
      parameters: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: "Lowercase hyphenated slug (e.g. log-monitor)",
          },
        },
        required: ["slug"],
      },
      provider: "skill_maker",
      handler: async (
        args: { slug: string },
        ctx: ToolContext
      ): Promise<ToolResult> => {
        const start = Date.now();
        const slug = (args.slug ?? "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        if (!slug) {
          return {
            success: false,
            data: null,
            error: "slug must be non-empty after normalizing",
            metadata: baseMeta("skill_maker.set_slug", Date.now() - start),
          };
        }
        slugMap.set(ctx.conversationId, slug);
        return {
          success: true,
          data: { slug },
          metadata: baseMeta("skill_maker.set_slug", Date.now() - start),
        };
      },
      riskLevel: "low",
      cacheable: false,
    },
    {
      name: "skill_maker.ensure_dir",
      description:
        "Create a directory under the current skill (e.g. '.' for skill root, 'scripts' for scripts/). Call set_slug first.",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "Path relative to skill root (e.g. . or scripts)",
          },
        },
        required: ["relativePath"],
      },
      provider: "skill_maker",
      handler: async (
        args: { relativePath: string },
        ctx: ToolContext
      ): Promise<ToolResult> => {
        const start = Date.now();
        let slug = slugMap.get(ctx.conversationId);
        if (!slug) {
          slug = `generated-${Date.now()}`;
          slugMap.set(ctx.conversationId, slug);
        }
        const skillsDir = getSkillsDir(api);
        const fullPath = join(skillsDir, slug, args.relativePath ?? ".");
        try {
          await api.files.ensureDir(fullPath);
          return {
            success: true,
            data: { path: fullPath },
            metadata: baseMeta("skill_maker.ensure_dir", Date.now() - start),
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "ensure_dir failed",
            metadata: baseMeta("skill_maker.ensure_dir", Date.now() - start),
          };
        }
      },
      riskLevel: "low",
      cacheable: false,
    },
    {
      name: "skill_maker.write_file",
      description:
        "Write content to a file under the current skill. Path is relative to skill root (e.g. skill.md, scripts/run.ts). Call set_slug first.",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "File path relative to skill root (e.g. skill.md or scripts/run.ts)",
          },
          content: { type: "string", description: "Full file content" },
        },
        required: ["relativePath", "content"],
      },
      provider: "skill_maker",
      handler: async (
        args: { relativePath: string; content: string },
        ctx: ToolContext
      ): Promise<ToolResult> => {
        const start = Date.now();
        let slug = slugMap.get(ctx.conversationId);
        if (!slug) {
          slug = `generated-${Date.now()}`;
          slugMap.set(ctx.conversationId, slug);
        }
        const skillsDir = getSkillsDir(api);
        const fullPath = join(skillsDir, slug, args.relativePath ?? "");
        try {
          await api.files.ensureDir(path.dirname(fullPath));
          await api.files.write(fullPath, args.content ?? "");
          return {
            success: true,
            data: { path: fullPath },
            metadata: baseMeta("skill_maker.write_file", Date.now() - start),
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "write failed",
            metadata: baseMeta("skill_maker.write_file", Date.now() - start),
          };
        }
      },
      riskLevel: "medium",
      cacheable: false,
    },
    {
      name: "skill_maker.list_dir",
      description:
        "List entries in a directory under the current skill. Path is relative to skill root (default '.'). Call set_slug first.",
      parameters: {
        type: "object",
        properties: {
          relativePath: {
            type: "string",
            description: "Directory path relative to skill root (optional, default '.')",
          },
        },
        required: [],
      },
      provider: "skill_maker",
      handler: async (
        args: { relativePath?: string },
        ctx: ToolContext
      ): Promise<ToolResult> => {
        const start = Date.now();
        let slug = slugMap.get(ctx.conversationId);
        if (!slug) {
          slug = `generated-${Date.now()}`;
          slugMap.set(ctx.conversationId, slug);
        }
        const skillsDir = getSkillsDir(api);
        const fullPath = join(skillsDir, slug, args.relativePath ?? ".");
        try {
          const entries = await api.files.list(fullPath);
          return {
            success: true,
            data: { path: fullPath, entries },
            metadata: baseMeta("skill_maker.list_dir", Date.now() - start),
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "list failed",
            metadata: baseMeta("skill_maker.list_dir", Date.now() - start),
          };
        }
      },
      riskLevel: "low",
      cacheable: false,
    },
    {
      name: "skill_maker.finish",
      description:
        "Signal that you are done with this skill-creation run. Call with status 'success' after you have written skill.md and all scripts (so we validate and complete). Call with status 'abort' if you cannot complete (e.g. you are replying with text only, hit an error, or need to give up). Do not leave the run without calling finish; otherwise we may assume failure from missing tool calls.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["success", "abort"],
            description: "success = I wrote all files. abort = I cannot complete, treat as aborted.",
          },
          message: {
            type: "string",
            description: "Optional short reason (e.g. for abort: why you could not complete).",
          },
        },
        required: ["status"],
      },
      provider: "skill_maker",
      handler: async (
        args: { status: "success" | "abort"; message?: string },
        ctx: ToolContext
      ): Promise<ToolResult> => {
        const start = Date.now();
        const status = args.status === "abort" ? "abort" : "success";
        finishStatusMap.set(ctx.conversationId, status);
        if (args.message && !process.env.RONIN_QUIET) {
          console.log(`[maker] skill finish(${status}): ${args.message}`);
        }
        return {
          success: true,
          data: { status, message: args.message },
          metadata: baseMeta("skill_maker.finish", Date.now() - start),
        };
      },
      riskLevel: "low",
      cacheable: false,
    },
  ];
}

/**
 * Extract script paths referenced in skill.md (e.g. from "Run: bun run scripts/run.ts").
 * Returns relative paths like ["scripts/run.ts", "scripts/discover.ts"].
 */
function getReferencedScriptPaths(skillMdContent: string): string[] {
  const paths: string[] = [];
  const runRegex = /Run:\s*(.+?)(?=\n|$)/gim;
  const scriptPathRegex = /scripts\/[^\s'"\n)]+\.(ts|js|mjs|cjs)/gi;
  let runMatch: RegExpExecArray | null;
  while ((runMatch = runRegex.exec(skillMdContent)) !== null) {
    const line = runMatch[1]!; // (.+?) requires >=1 char, so group 1 is always captured
    let pathMatch: RegExpExecArray | null;
    const pathRegex = /scripts\/[^\s'"\n)]+\.(ts|js|mjs|cjs)/gi;
    while ((pathMatch = pathRegex.exec(line)) !== null) {
      const rel = pathMatch[0];
      if (!paths.includes(rel)) paths.push(rel);
    }
  }
  return paths;
}

/**
 * Parse assistant text output for legacy skill format (NAME:, ---SKILL.MD---, ---SCRIPTS---)
 * or frontmatter + markdown/code blocks. requestHint used to derive slug when not found in text.
 */
function parseSkillFromText(
  raw: string,
  requestHint?: string
): {
  slug: string;
  skillMdContent: string;
  scripts: Array<{ path: string; content: string }>;
} | null {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.trim();

  let slug: string | null = null;
  const nameMatch = text.match(/\bNAME:\s*(\S+)/i) ?? text.match(/\bname:\s*(\S+)/);
  if (nameMatch) {
    slug = nameMatch[1]!.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }
  if (!slug) {
    const frontmatterMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const nameInYaml = frontmatterMatch[1]!.match(/\bname:\s*["']?([a-z0-9-]+)["']?/i);
      if (nameInYaml) slug = nameInYaml[1]!.trim().toLowerCase();
    }
  }
  if (!slug && requestHint) {
    slug = requestHint
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 50) || "generated-skill";
  }
  if (!slug) return null;

  let skillMdContent: string | null =
    text.match(/---SKILL\.MD---\s*([\s\S]*?)---END\s*SKILL\.MD---/i)?.[1]?.trim() ??
    text.match(/```(?:markdown|md)\s*([\s\S]*?)```/)?.[1]?.trim() ??
    null;
  if (!skillMdContent && text.startsWith("---")) {
    const scriptsStart = text.indexOf("---SCRIPTS---");
    const endMd = text.indexOf("---END SKILL.MD---");
    const sliceEnd = scriptsStart >= 0 ? scriptsStart : endMd >= 0 ? endMd : text.length;
    const candidate = text.slice(0, sliceEnd).trim();
    if (candidate.length > 80 && (candidate.includes("##") || candidate.includes("\ndescription:"))) {
      skillMdContent = candidate;
    }
  }
  // Fallback: slug from request + any markdown that looks like a skill (frontmatter or ## Abilities)
  if (!skillMdContent && slug) {
    const scriptsMarker = text.indexOf("---SCRIPTS---");
    const bodyEnd = scriptsMarker >= 0 ? scriptsMarker : text.length;
    const candidate = text.slice(0, bodyEnd).trim();
    const hasStructure =
      (candidate.includes("---") && candidate.includes("description:")) ||
      candidate.includes("## Abilities") ||
      (candidate.includes("### ") && (candidate.includes("Run:") || candidate.includes("Input:")));
    if (candidate.length > 100 && hasStructure) {
      skillMdContent = candidate;
    }
  }
  // Last resort: model returned no tool calls but sent prose + code block — build minimal skill from request + code
  if (!skillMdContent && slug) {
    const tsBlock = text.match(/```(?:ts|typescript)\s*\n([\s\S]*?)```/);
    if (tsBlock?.[1]?.trim()) {
      const name = slug.replace(/-/g, " ");
      const desc = requestHint?.slice(0, 120).trim() || `Skill: ${name}`;
      skillMdContent = `---
name: ${slug}
description: ${desc}
---

# ${name}

${requestHint?.slice(0, 300).trim() || ""}

## Abilities

### run
Run: bun run scripts/run.ts
`;
    }
  }
  if (!skillMdContent) return null;

  const scriptsSection = text.match(/---SCRIPTS---\s*([\s\S]*?)---END\s*SCRIPTS---/i)?.[1] ?? "";
  const scriptBlocks = scriptsSection.split(/---END\s*SCRIPT---/i).filter(Boolean);
  const scripts: Array<{ path: string; content: string }> = [];
  for (const block of scriptBlocks) {
    const fnMatch = block.match(/FILENAME:\s*(\S+)/i);
    const contentMatch = block.match(/CONTENT:\s*([\s\S]*?)(?=---END\s*SCRIPT|---FILENAME:|\z)/i);
    if (fnMatch?.[1]) {
      const relPath = fnMatch[1].replace(/^scripts\//, "");
      const content = (contentMatch?.[1] ?? "// no content").trim();
      scripts.push({ path: `scripts/${relPath}`, content });
    }
  }
  if (scripts.length === 0) {
    const tsBlock = text.match(/```(?:ts|typescript)\s*\n([\s\S]*?)```/);
    if (tsBlock?.[1]?.trim()) {
      scripts.push({ path: "scripts/run.ts", content: tsBlock[1].trim() });
    }
  }

  return { slug, skillMdContent, scripts };
}

export default class MakerDuty extends BaseDuty {
  private proposalStorage: DutyProposalStorage;
  private skillSlugByConversation = new Map<string, string>();
  private finishStatusByConversation = new Map<string, "success" | "abort">();

  constructor(api: DutyAPI) {
    super(api);
    this.proposalStorage = new DutyProposalStorage(api);
    this.registerRoutes();
    this.registerDutyTool();
    for (const tool of createSkillMakerTools(
      api,
      this.skillSlugByConversation,
      this.finishStatusByConversation
    )) {
      api.tools.register(tool);
    }
    this.api.events.on("agent.task.failed", (data: unknown) => {
      this.handleFailure(data as FailurePayload).catch((err) =>
        console.error("[maker] handleFailure:", err)
      );
    });
    this.api.events.on("create-skill", (data: unknown) => {
      this.handleCreateSkill(data as CreateSkillPayload).catch((err) =>
        console.error("[maker] handleCreateSkill:", err)
      );
    });
    // Former agent-creator-orchestrator events. The LangGraph path is
    // deprecated: create_agent now drafts through the same proposeDuty
    // pipeline as chat requests instead of writing agent files directly.
    this.api.events.on("create_agent", (data: unknown) => {
      const payload = data as { task?: string };
      if (!payload?.task) {
        console.warn("[maker] create_agent event had empty task");
        return;
      }
      console.log("[maker] create_agent received — drafting via proposeDuty pipeline (LangGraph path retired)");
      this.draftDutyProposal(payload.task).catch((err) =>
        console.error("[maker] create_agent draft failed:", err)
      );
    });
    this.api.events.on("cancel_creation", (data: unknown) => {
      // Nothing long-running left to cancel (LangGraph retired; SAR runs
      // complete inside their own handler). Kept so `ronin cancel` CLI
      // invocations don't hit a dead event.
      console.log("[maker] cancel_creation received — no active creation to cancel", data);
    });
    console.log("🔨 Maker ready. Duty proposals, skill generation, and agent creation in one flow.");
  }

  async execute(): Promise<void> {
    // Event/tool/route-driven only.
  }

  // ── Duty pipeline (from duty-executor) ──────────────────────────────────

  /**
   * Tool Chatty can call mid-conversation to draft a brand-new duty from
   * plain English — e.g. "watches #design threads and keeps a running GDD".
   * Never writes to the duties directory or registers anything directly: it
   * drafts, persists a pending proposal, and returns its id + a preview +
   * the full generated code for the chat UI to render as an approval card.
   */
  private registerDutyTool(): void {
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
      provider: "maker",
      handler: async (args: { intent: string; reviseProposalId?: string }) => {
        const callId = `duties-propose-${Date.now()}`;
        try {
          const rec = await this.draftDutyProposal(args.intent, args.reviseProposalId);

          return {
            success: true,
            data: { id: rec.id, preview: rec.preview, code: rec.code, dutyName: rec.dutyName },
            metadata: {
              toolName: "duties.proposeDuty",
              provider: "maker",
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
              provider: "maker",
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

  /** Draft + persist a duty proposal (shared by the tool and create_agent). */
  private async draftDutyProposal(intent: string, reviseProposalId?: string) {
    const proposal = await proposeDuty(intent, this.api);
    return this.proposalStorage.create({
      intent,
      dutyName: proposal.dutyName,
      code: proposal.code,
      preview: proposal.preview,
      supersedesId: reviseProposalId,
    });
  }

  /**
   * Approve/refuse API for AI-drafted duty proposals (from Chatty's
   * duties.proposeDuty tool, or the /duties/review dashboard page). Flat
   * routes, target id in the POST body rather than a dynamic path segment.
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

    const accent = getKiosaAccentForPath("/duties/review");
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Duties - Ronin</title>
  ${getKiosaStylesheetLink(accent)}
<style>

    body { padding: 0; margin: 0; }

    .page-content {
      max-width: 900px;
      margin: 0 auto;
      padding: ${kiosaTheme.spacing.lg};
    }

    .section-title {
      font-size: 0.9375rem;
      font-weight: 500;
      margin: ${kiosaTheme.spacing.lg} 0 ${kiosaTheme.spacing.sm};
      color: ${kiosaTheme.colors.textPrimary};
    }

    .duty-row {
      padding: ${kiosaTheme.spacing.md};
      border: 1px solid ${kiosaTheme.colors.border};
      border-radius: ${kiosaTheme.borderRadius.md};
      margin-bottom: ${kiosaTheme.spacing.sm};
      background: ${kiosaTheme.colors.backgroundSecondary};
    }

    .duty-row-main { margin-bottom: ${kiosaTheme.spacing.xs}; }
    .duty-row-detail { font-size: 0.8125rem; color: ${kiosaTheme.colors.textSecondary}; }

    .empty-state {
      color: ${kiosaTheme.colors.textTertiary};
      font-size: 0.8125rem;
      padding: ${kiosaTheme.spacing.md} 0;
    }

    .proposal-card {
      margin-bottom: ${kiosaTheme.spacing.sm};
      padding: ${kiosaTheme.spacing.md};
      border-radius: ${kiosaTheme.borderRadius.md};
      background: ${kiosaTheme.colors.backgroundTertiary};
      border: 1px solid ${kiosaTheme.colors.border};
    }
    .proposal-card-preview {
      font-size: 0.8125rem;
      line-height: 1.6;
      color: ${kiosaTheme.colors.textPrimary};
      margin-bottom: ${kiosaTheme.spacing.sm};
    }
    .proposal-card-code-details {
      margin-bottom: ${kiosaTheme.spacing.sm};
    }
    .proposal-card-code-details summary {
      font-size: 0.75rem;
      color: ${kiosaTheme.colors.textSecondary};
      cursor: pointer;
    }
    .proposal-card-code {
      margin-top: ${kiosaTheme.spacing.xs};
      padding: ${kiosaTheme.spacing.sm};
      background: ${kiosaTheme.colors.background};
      border: 1px solid ${kiosaTheme.colors.border};
      border-radius: ${kiosaTheme.borderRadius.sm};
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.75rem;
      line-height: 1.5;
      overflow-x: auto;
      white-space: pre;
      max-height: 360px;
      overflow-y: auto;
    }
    .proposal-card-actions { display: flex; gap: ${kiosaTheme.spacing.sm}; }
    .proposal-card-actions button {
      flex: 1;
      padding: ${kiosaTheme.spacing.xs} ${kiosaTheme.spacing.md};
      border-radius: ${kiosaTheme.borderRadius.sm};
      border: 1px solid ${kiosaTheme.colors.border};
      background: transparent;
      cursor: pointer;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .proposal-card-allow { color: ${kiosaTheme.colors.success}; border-color: ${kiosaTheme.colors.success} !important; }
    .proposal-card-refuse { color: ${kiosaTheme.colors.error}; border-color: ${kiosaTheme.colors.error} !important; }
    .proposal-card-actions button:disabled { opacity: 0.5; cursor: default; }
    .proposal-card-status { font-size: 0.75rem; color: ${kiosaTheme.colors.textSecondary}; }
  </style>
</head>
<body>
  ${getKiosaTopbarHTML({ title: "RONIN", subtitle: "DUTIES", chips: [], tabs: [] })}
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
      console.error(`[maker] Failed to list duty proposals: ${error}`);
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
      // self-correction loop. Emitting PlanProposed first keeps the
      // manual-approval gate working; PlanApproved follows immediately since
      // the human already approved this in chat — no second approval needed.
      // coder-bot.ts uses draftCode as a reviewed starting point for the
      // CLI, not as the final code.
      const now = Date.now();
      this.api.events.emit("PlanProposed", {
        id,
        title: finalDutyName,
        description: proposal.intent,
        tags: ["create", "duty"],
        source: SOURCE,
        proposedAt: now,
      }, SOURCE);
      this.api.events.emit("PlanApproved", {
        id,
        title: finalDutyName,
        description: proposal.intent,
        tags: ["create", "duty"],
        approvedAt: now,
        draftCode: proposal.code,
        source: SOURCE,
      }, SOURCE);

      this.api.events?.emit(
        "duty.proposal_approved",
        { id, dutyName: finalDutyName, timestamp: now },
        SOURCE
      );

      console.log(`[maker] Duty proposal approved: ${finalDutyName} (${id}) — handed off to coder-bot for implementation`);
      return Response.json({
        success: true,
        dutyName: finalDutyName,
        message: "Approved — a coding agent is implementing this now.",
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[maker] Failed to approve duty proposal: ${msg}`);
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
        SOURCE
      );

      console.log(`[maker] Duty proposal refused: ${id}`);
      return Response.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[maker] Failed to refuse duty proposal: ${msg}`);
      return Response.json({ success: false, message: msg }, { status: 500 });
    }
  }

  // ── Skill pipeline (from skill-maker) ───────────────────────────────────

  private async handleFailure(payload: FailurePayload): Promise<void> {
    const request =
      payload.request ?? payload.description ?? payload.error ?? "Task failed";
    const failureNotes = payload.failureNotes ?? payload.error ?? "";
    await this.generateAndWriteSkill({
      request: `${request}. ${failureNotes}`.trim(),
      reason: "Failed task inspired creation",
      taskId: payload.taskId,
      telegramChatId: payload.telegramChatId,
      sourceChannel: payload.sourceChannel,
      sourceUser: payload.sourceUser,
    });
  }

  private async handleCreateSkill(payload: CreateSkillPayload): Promise<void> {
    const request = payload.request ?? "";
    if (!request.trim()) {
      console.warn("[maker] create-skill event had empty request");
      return;
    }
    await this.generateAndWriteSkill({
      request,
      reason: "User request",
      telegramChatId: payload.telegramChatId,
      sourceChannel: payload.sourceChannel,
      sourceUser: payload.sourceUser,
    });
  }

  /** Public entry for CLI: create a skill from a request string (no event). */
  async createSkillFromRequest(request: string): Promise<void> {
    if (!request.trim()) {
      console.warn("[maker] createSkillFromRequest had empty request");
      return;
    }
    await this.generateAndWriteSkill({
      request,
      reason: "User request",
    });
  }

  private async generateAndWriteSkill(options: {
    request: string;
    reason: string;
    taskId?: string;
    telegramChatId?: string | number;
    sourceChannel?: string;
    sourceUser?: string;
  }): Promise<void> {
    const { request, reason, taskId, telegramChatId, sourceChannel, sourceUser } = options;
    const conversationId = `skill-maker-${Date.now()}`;

    const emitCompletionMessage = (text: string, isError = false): void => {
      if (telegramChatId == null) return;
      (this.api.events as { emit(event: string, data: unknown, source: string): void }).emit(
        "SendTelegramMessage",
        {
          text,
          chatId: telegramChatId,
          parseMode: "HTML",
          source: SOURCE,
        },
        SOURCE
      );
    };

    const systemContent = `You are creating a Ronin AgentSkill. You MUST use the tools to write real files. Do not output only text.

Research phase (when unsure): If you are not sure how the service, API, or technology works, research first. (1) Use Brave search: call mcp_brave-search_brave_web_search with a query (e.g. "X API documentation", "how does X work") to find official docs or tutorials. (2) Use our scraping tools: call scrape_scrape_to_markdown with a url (e.g. a doc URL from the search results) to fetch the page and get clean markdown — use this to read how the service actually works. (3) You can also call local.memory.search for internal docs (refdoc-*, tool-* notes). Use the combined results to implement the skill correctly, then proceed with set_slug, write_file, finish.

How tool calling works: You must respond with tool calls (each tool has a name and arguments). If you reply with only prose, no tool runs. The system executes your tool calls, appends the results, and gives you another turn. Use that next turn to call more tools (e.g. write_file again) or call skill_maker.finish. If you cannot complete the skill, call skill_maker.finish with status "abort" so we know you are intentionally giving up — do not leave the run without calling finish. When you have written skill.md and scripts/run.ts, call skill_maker.finish with status "success".

Scripts must accept input via argv: All generated scripts MUST take input from command-line arguments (e.g. --input=, --path=, --query=). The Run: line in skill.md must use placeholders, e.g. Run: bun run scripts/run.ts --input={input}. The script must parse process.argv for these flags. Do not assume input files (e.g. input.txt) exist — the caller (skills.run) passes params as argv. If the user explicitly wants file-based input, the skill can optionally read a file path from argv (e.g. --file=path) but must not require a hardcoded filename.

Required tool sequence: (1) If unsure, research (Brave search mcp_brave-search_brave_web_search, then scrape_scrape_to_markdown to read doc URLs; or local.memory.search). (2) skill_maker.set_slug with a lowercase hyphenated slug. (3) skill_maker.ensure_dir for "." and "scripts". (4) skill_maker.write_file for skill.md (full content: YAML frontmatter name + description, then ## Abilities, ### run with Input:, Output:, Run: bun run scripts/run.ts --input={input} or similar placeholders). (5) skill_maker.write_file for scripts/run.ts with actual TypeScript that parses argv (e.g. --input=) and implements the behavior — not a stub. (6) skill_maker.finish with status "success". If you cannot implement, call skill_maker.finish with status "abort".

You MUST call skill_maker.finish before ending: "success" after writing all files, or "abort" if you cannot complete. Do not leave the run without calling finish. Do not reply with only a prose description.`;

    const userContent = `Create a skill that: ${request}`;

    console.log(`[maker] Creating skill: "${request.slice(0, 80)}${request.length > 80 ? "…" : ""}"`);

    const stack = standardSAR({ maxTokens: 8192 });

    const ctx: ChainContext = {
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
      ontology: {
        domain: "skill_maker",
        relevantSkills: SKILL_MAKER_ONTOLOGY_SKILLS,
      },
      budget: {
        max: 8192,
        current: 0,
        reservedForResponse: 512,
      },
      conversationId,
      model: "smart",
    };

    const runChainOnce = async (): Promise<void> => {
      const chain = this.createChain("skill-maker");
      chain.useMiddlewareStack(stack);
      chain.withContext(ctx);
      await chain.run();
    };

    let chainError: Error | null = null;
    try {
      console.log("[maker] Running skill chain…");
      await runChainOnce();

      const slugAfterFirstRun = this.skillSlugByConversation.get(conversationId);
      const finishStatusAfterRun = this.finishStatusByConversation.get(conversationId);
      const lastMsg = ctx.messages[ctx.messages.length - 1];
      const lastRoundHadNoToolCalls = lastMsg?.role === "assistant";

      if (!slugAfterFirstRun && lastRoundHadNoToolCalls) {
        console.log("[maker] Model replied without tool calls; injecting retry instruction and running again.");
        ctx.messages.push({
          role: "user",
          content:
            "You must use the tools. Call skill_maker.set_slug with a slug (e.g. mermaid-diagram), skill_maker.ensure_dir for '.' and 'scripts', skill_maker.write_file for skill.md and script(s), then skill_maker.finish with status 'success'. If you cannot complete, call skill_maker.finish with status 'abort'. Do not reply with only text.",
        });
        await runChainOnce();
      } else if (slugAfterFirstRun && !finishStatusAfterRun && lastRoundHadNoToolCalls) {
        console.log("[maker] Model created dirs but did not call write_file or finish; prompting for finish or write.");
        ctx.messages.push({
          role: "user",
          content:
            "You created the skill directory but did not call skill_maker.write_file or skill_maker.finish. You must either: (1) Call skill_maker.write_file for skill.md (full markdown with frontmatter and ## Abilities ### run Run: bun run scripts/run.ts) and for scripts/run.ts (real implementation, not a stub), then skill_maker.finish with status 'success', or (2) Call skill_maker.finish with status 'abort' if you cannot complete. Reply with tool calls only.",
        });
        await runChainOnce();
      }
      // Third chance: if we still have no write_file calls (folder will be empty), try one more explicit nudge
      const slugAfterSecond = this.skillSlugByConversation.get(conversationId);
      const finishAfterSecond = this.finishStatusByConversation.get(conversationId);
      const lastMsg2 = ctx.messages[ctx.messages.length - 1];
      const lastRound2NoTools = lastMsg2?.role === "assistant";
      if (slugAfterSecond && !finishAfterSecond && lastRound2NoTools) {
        const hasWriteFile = ctx.messages.some(
          (m) => m.role === "tool" && (m as { name?: string }).name === "skill_maker.write_file"
        );
        if (!hasWriteFile) {
          console.log("[maker] Still no write_file after second prompt; third chance with concrete example.");
          ctx.messages.push({
            role: "user",
            content: `Call skill_maker.write_file twice now: (1) relativePath "skill.md" with full content (frontmatter name/description, ## Abilities, ### run with Run: bun run scripts/run.ts). (2) relativePath "scripts/run.ts" with real TypeScript that implements: ${request.slice(0, 200)}. No stubs — the script must perform the actual behavior. Then call skill_maker.finish with status "success".`,
          });
          await runChainOnce();
        }
      }
    } catch (err) {
      chainError = err instanceof Error ? err : new Error(String(err));
      console.error("[maker] Skill chain run failed:", chainError);
      emitCompletionMessage(
        `❌ <b>Skill creation failed</b>\n\n${escapeHtml(chainError.message)}\n\nNo skill was written.`,
        true
      );
      return;
    } finally {
      // allow cleanup of slug map below
    }

    let slug = this.skillSlugByConversation.get(conversationId);
    this.skillSlugByConversation.delete(conversationId);
    const finishStatus = this.finishStatusByConversation.get(conversationId);
    this.finishStatusByConversation.delete(conversationId);

    const skillsDir = getSkillsDir(this.api);

    if (finishStatus === "abort") {
      if (slug) {
        const skillDir = join(skillsDir, slug);
        try {
          rmSync(skillDir, { recursive: true });
          console.log("[maker] Removed skill directory after abort:", skillDir);
        } catch (e) {
          console.warn("[maker] Could not remove skill dir after abort:", (e as Error).message);
        }
      }
      emitCompletionMessage(
        "🛑 <b>Skill creation aborted</b>\n\nThe model reported it could not complete the skill. Any empty folder was removed. Try again or use the CLI: <code>ronin skills create \"your description\"</code>.",
        true
      );
      return;
    }

    if (!slug) {
      const assistantContent = ctx.messages
        .filter((m) => m.role === "assistant")
        .map((m) => m.content)
        .join("\n\n");
      const parsed = parseSkillFromText(assistantContent, request);
      if (parsed) {
        console.log("[maker] No tool calls; parsed skill from assistant text.");
        slug = parsed.slug;
        const skillDir = join(skillsDir, slug);
        try {
          await this.api.files.ensureDir(skillDir);
          await this.api.files.ensureDir(join(skillDir, "scripts"));
          await this.api.files.write(join(skillDir, "skill.md"), parsed.skillMdContent);
          for (const { path: relPath, content } of parsed.scripts) {
            const fullPath = join(skillDir, relPath);
            await this.api.files.ensureDir(path.dirname(fullPath));
            await this.api.files.write(fullPath, content);
          }
        } catch (writeErr) {
          console.error("[maker] Failed to write parsed skill:", writeErr);
          slug = undefined;
        }
      }
    }

    if (slug) {
      console.log(`[maker] Resolved slug: ${slug}`);
    }
    if (!slug) {
      console.warn("[maker] No slug set during chain run; skill may be incomplete.");
      emitCompletionMessage(
        "⚠️ <b>Skill creation finished with no slug</b>\n\nThe model did not call the skill-making tools. You may find partial files under <code>~/.ronin/skills/generated-*</code>. Try again or use the CLI: <code>ronin skills create \"your description\"</code>.",
        true
      );
      return;
    }

    const skillDir = join(skillsDir, slug);

    // Ensure we actually have content: model may have called set_slug + ensure_dir but never write_file.
    // Also verify any script files referenced in skill.md (e.g. Run: bun run scripts/run.ts) exist.
    const skillMdPath = join(skillDir, "skill.md");
    const skillMdAltPath = join(skillDir, "SKILL.md");
    let skillDirHasContent = false;
    try {
      const entries = await this.api.files.list(skillDir);
      const hasSkillMd = entries.some(
        (p) => p.endsWith("skill.md") || p.endsWith("SKILL.md")
      );
      if (hasSkillMd) {
        let content: string;
        try {
          content = await this.api.files.read(skillMdPath);
        } catch {
          content = await this.api.files.read(skillMdAltPath);
        }
        const referencedScripts = getReferencedScriptPaths(content);
        let allScriptsExist = true;
        for (const relPath of referencedScripts) {
          try {
            await this.api.files.read(join(skillDir, relPath));
          } catch {
            allScriptsExist = false;
            console.warn(`[maker] Referenced script missing: ${relPath}`);
            break;
          }
        }
        skillDirHasContent = allScriptsExist;
      }
    } catch {
      // dir might not exist or be empty
    }
    if (!skillDirHasContent) {
      const assistantContent = ctx.messages
        .filter((m) => m.role === "assistant")
        .map((m) => m.content)
        .join("\n\n");
      // Use request as hint so parser derives a slug; accept any parse when we already have a folder (slug from set_slug)
      const parsed = parseSkillFromText(assistantContent, request);
      if (parsed) {
        // Write into current slug's folder (parsed.slug may differ e.g. longer request-based slug)
        try {
          await this.api.files.ensureDir(skillDir);
          await this.api.files.ensureDir(join(skillDir, "scripts"));
          await this.api.files.write(join(skillDir, "skill.md"), parsed.skillMdContent);
          for (const { path: relPath, content } of parsed.scripts) {
            const fullPath = join(skillDir, relPath);
            await this.api.files.ensureDir(path.dirname(fullPath));
            await this.api.files.write(fullPath, content);
          }
          skillDirHasContent = true;
          console.log("[maker] Wrote skill from parsed assistant text (folder was empty).");
        } catch (writeErr) {
          console.error("[maker] Failed to write parsed skill (empty folder):", writeErr);
        }
      }
      if (!skillDirHasContent) {
        this.skillSlugByConversation.delete(conversationId);
        try {
          rmSync(skillDir, { recursive: true });
          console.log("[maker] Removed empty skill directory:", skillDir);
        } catch (e) {
          console.warn("[maker] Could not remove empty skill dir:", (e as Error).message);
        }
        emitCompletionMessage(
          "⚠️ <b>Skill folder created but no content written</b>\n\nThe model created the directory but did not complete writing skill.md or scripts. The empty folder was removed. Try again or use the CLI: <code>ronin skills create \"your description\"</code>.",
          true
        );
        return;
      }
    }

    const newSkillPayload = { name: slug, reason, taskId, path: skillDir };
    (this.api.events as { emit(event: string, data: unknown, source: string): void }).emit(
      "new-skill",
      newSkillPayload,
      SOURCE
    );
    console.log(`[maker] Created skill: ${slug} at ${skillDir}`);

    try {
      let summary = reason?.slice(0, 500);
      try {
        const skillMdPath = join(skillDir, "skill.md");
        const content = await this.api.files.read(skillMdPath);
        const descMatch = content.match(/(?:^---\s*\n[\s\S]*?\ndescription:\s*["']?([^"'\n]+)["']?|^#\s+.+\n\n([^\n]+))/m);
        if (descMatch?.[1] || descMatch?.[2]) {
          summary = (descMatch[1] ?? descMatch[2])!.trim().slice(0, 500);
        }
      } catch {
        // use reason as summary
      }
      await this.api.memory.store(`skill-${slug}`, { name: slug, summary: summary ?? undefined });
      console.log(`[maker] Memory updated with skill-${slug}`);
    } catch (err) {
      console.warn("[maker] Failed to update memory with new skill:", (err as Error).message);
    }

    emitCompletionMessage(
      `✅ <b>Skill created</b>\n\n<code>${escapeHtml(slug)}</code>\nPath: <code>${escapeHtml(skillDir)}</code>`
    );

    if (taskId) {
      (this.api.events as { emit(event: string, data: unknown, source: string): void }).emit(
        "retry.task",
        { taskId },
        SOURCE
      );
    }
  }
}
