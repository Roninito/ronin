/**
 * Shared prompt construction for chat and tool-enabled flows.
 * Used by chatty, intent-ingress, and tool-orchestrator.
 * Memoizes Ronin context and conversation summaries via cache with use-count decay.
 */

import { readdir, readFile } from "fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { ensureDefaultExternalDutyDir, ensureDefaultDutyDir } from "../cli/commands/config.js";
import { getDefaultCache } from "./cache.js";
import type { DutyAPI } from "../types/index.js";

export interface RoninContext {
  duties: Array<{ name: string; description?: string }>;
  plugins: string[];
  routes: Array<{ path: string; type: string }>;
  architecture: string;
  hasArtifacts?: boolean;
}

export interface PromptOptions {
  role?: string;
  includeArchitecture?: boolean;
  includeDutyList?: boolean;
  includePluginList?: boolean;
  includeRouteList?: boolean;
  sections?: string[];
  memoryHint?: boolean;
  artifactsHint?: boolean;
}

// Moved to @ronin/sar — re-exported for backward compatibility
import { buildToolPrompt as _buildToolPrompt, estimateTokens as _estimateTokens } from "@ronin/sar";
export { _buildToolPrompt as buildToolPrompt, _estimateTokens as estimateTokens };
export type { BuildToolPromptParams } from "@ronin/sar";

// Local aliases for use within this module
const estimateTokens = _estimateTokens;
const buildToolPrompt = _buildToolPrompt;

export interface WindowingResult {
  summary?: string;
  recentMessages: Array<{ role: string; content: string }>;
  totalTokensUsed: number;
}

export interface WindowingOptions {
  chatId?: string;
  api?: DutyAPI;
  recentCount?: number;
  maxSummaryTokens?: number;
}

const RONIN_CONTEXT_KEY = "ronin:context";
const RONIN_CONTEXT_MAX_USES = 10;
const RONIN_CONTEXT_MAX_AGE_MS = 60_000;
const ARCHITECTURE_KEY = "ronin:architecture";
const ARCHITECTURE_MAX_USES = 50;
const ARCHITECTURE_MAX_AGE_MS = 300_000;
const CHAT_SUMMARY_PREFIX = "chat-summary:";
const CHAT_SUMMARY_MAX_USES = 5;
const CHAT_SUMMARY_MAX_AGE_MS = 120_000;
const PERSONA_FILE_PATH = join(homedir(), ".ronin", "persona.md");
const DEFAULT_PERSONA = `# Ronin Persona

Personality:
- Helpful, practical, and calm.
- Prioritize clarity over verbosity.

Communication style:
- Use concise, direct language.
- Explain decisions briefly.
- Be transparent about uncertainty and next steps.`;

const DEFAULT_ROLE = `You are Ronin AI, a helpful assistant for the Ronin AI agent framework.

CRITICAL: "Ronin" refers to the Ronin AI agent framework - a Bun-based TypeScript/JavaScript framework for building AI agents. This is NOT the Ronin blockchain, Ronin DeFi platform, or any cryptocurrency. When users mention "Ronin", they mean the AI agent framework.`;

const MEMORY_HINT_SECTION = `
MEMORY (use it to find how to do things and recall past context):
Ronin's memory is plain markdown files under memory/ — no database, no graph:
- memory/notes/: refdoc-* (reference docs), tool-* (registered tools), skill-* (installed AgentSkills), and freeform notes. Find one with local.memory.search(query) — it does a text search over these files and returns the matches.
- memory/conversations/<duty>.md: append-only per-duty conversation transcripts.
- memory/blackboards/<duty>.md: per-duty scratch/working state.
Notes may cross-reference each other with plain [[wikilink]] references — there is no graph traversal API, just text.

DATABASE (ronin.db): For questions about the database itself — contracts, tasks, katas, usage — use local.db.query with a single SELECT statement. Memory/conversation/blackboard content is NOT in this database; use local.memory.search for that instead.

DISCOVERY (when tools are needed): When you need live data you cannot answer from built-in knowledge, call local.memory.search with a relevant query (e.g. the topic, or "tool-X" / "skill-X" / "refdoc-X"). Read the matched note's content — it often states which tool to call next.

IMPORTANT: Do NOT call memory or shell tools for questions you can answer from your built-in knowledge about the Ronin framework. Only use tools when you need current/live data (e.g., "what duties are installed right now", "search my past conversations").

LISTING SKILLS: To list available Ronin skills, call skills.list (returns array of { name, description } from disk) or local.memory.search for "skill-" entries. Never say "no tools are available to retrieve skills" without having called one of these first.

Use memory both for recall (past work, task context) and for discovery (what tools exist, how to list skills/tools, how to do X).`;

const ARTIFACT_HINT_SECTION = `
ARTIFACTS (persistent, cross-chat project containers):
When the user describes multi-step collection, research, or prototyping work that will span more than one session — gathering assets, building a research base, aggregating resources — you can create an Artifact to track it:
- artifact_create: Start a new project container (name, type, tags, completionThreshold). Only do this for ongoing multi-session work, never for single-session one-off tasks or simple questions.
- artifact_load: Load an existing artifact's progress, pending categories, and recent activity before continuing work on it.
- artifact_updateProgress / artifact_addAsset / artifact_appendLog: Record progress as you gather or produce things for the project.
- artifact_getSchedulingStatus: Check whether an artifact is due for more work (respects backoff — don't call artifact_schedule repeatedly for the same artifact).
- artifact_transitionState: Move the artifact to COMPLETE once its completion threshold is met — this stops further scheduling and finalizes its dashboard.
- Dashboards live at /artifact/<id> and the full list at /artifacts.
Do NOT create an artifact for something you can just answer or do in this one turn.

ATTACHING SCREENSHOTS (e.g. from web research via agent-browser): artifact_create and artifact_load both return an assetsDir (an absolute local directory). To attach a screenshot: (1) run agent-browser open <url>, then agent-browser screenshot "<assetsDir>/<name>.png" via local.shell.safe, (2) call artifact_addAsset with assetType "reference", filename "<name>.png", source "<url>", and storedPath "<name>.png". The asset is then served at /api/artifact/<id>/asset/<name>.png and shown on the dashboard. Do not pass arbitrary paths as storedPath — it must be a file you just saved under assetsDir.`;

function buildFileStructureGuide(): string {
  const projectRoot = process.cwd();
  return `FILE ACCESS (use sparingly):
When you need to read specific files or check current system state, use:
1) local.memory.search (for past conversations/context)
2) local.file.read (for a specific known file)
3) local.shell.safe (only for targeted commands, not exploratory browsing)

IMPORTANT: Do NOT use local.shell.safe to repeatedly ls, find, or cat files to discover how things work. Answer framework questions from your knowledge. Only read files when the user asks about their specific content.

Project workspace tree:
${projectRoot}/
├── duties/             # Project duties (repo-local)
├── skills/              # Project skills (repo-local)
├── docs/                # Project docs/reference
├── src/                 # Core framework/runtime code
└── ...                  # Other project files

Local Ronin home tree:
~/.ronin/
├── config.json          # User configuration
├── ronin.log            # App/server logs
├── ninja.log            # Background mode log
├── daemon.log           # Daemon log
├── logs/
│   └── runs/            # Per-run logs
├── skills/              # User-installed skills
├── duties/             # User-installed duties
├── plugins/             # User plugins
└── data/                # Runtime data files`;
}

function getPersonaSection(): string {
  try {
    if (!existsSync(PERSONA_FILE_PATH)) {
      mkdirSync(dirname(PERSONA_FILE_PATH), { recursive: true });
      writeFileSync(PERSONA_FILE_PATH, DEFAULT_PERSONA, "utf-8");
      return `USER PERSONA (apply this tone and style in every response):\n${DEFAULT_PERSONA}`;
    }
    const persona = readFileSync(PERSONA_FILE_PATH, "utf-8").trim();
    if (!persona) return "";
    return `USER PERSONA (apply this tone and style in every response):\n${persona}`;
  } catch {
    return "";
  }
}

/**
 * Single source of truth for discovering duties, plugins, routes.
 * Memoized with use-count decay (maxUses: 10, maxAgeMs: 60s).
 */
export async function getRoninContext(api: DutyAPI): Promise<RoninContext> {
  const cache = getDefaultCache();
  const cached = cache.get<RoninContext>(RONIN_CONTEXT_KEY);
  if (cached) return cached;

  const duties: Array<{ name: string; description?: string }> = [];
  try {
    const externalDutyDir = ensureDefaultExternalDutyDir();
    const localDutyDir = ensureDefaultDutyDir();

    try {
      const externalFiles = await readdir(externalDutyDir);
      for (const file of externalFiles) {
        if (file.endsWith(".ts") || file.endsWith(".js")) {
          const name = file.replace(/\.(ts|js)$/, "");
          let description: string | undefined;
          try {
            const content = await readFile(join(externalDutyDir, file), "utf-8");
            const descMatch =
              content.match(/\/\*\*[\s\S]*?\*\//) ||
              content.match(/\/\/.*description.*/i) ||
              content.match(/export default class \w+ extends BaseDuty[\s\S]{0,500}/);
            if (descMatch) {
              description = descMatch[0].substring(0, 200).replace(/\n/g, " ");
            }
          } catch {
            // ignore
          }
          duties.push({ name, description });
        }
      }
    } catch {
      // external dir may not exist
    }

    try {
      const localFiles = await readdir(localDutyDir);
      for (const file of localFiles) {
        if (file.endsWith(".ts") || file.endsWith(".js")) {
          const name = file.replace(/\.(ts|js)$/, "");
          if (!duties.find((d) => d.name === name)) duties.push({ name });
        }
      }
    } catch {
      // local dir may not exist
    }
  } catch (error) {
    console.warn("[prompt] Error discovering duties:", error);
  }

  const plugins = api.plugins.list();
  const routes: Array<{ path: string; type: string }> = [];
  const allRoutes = api.http.getAllRoutes();
  for (const path of allRoutes.keys()) {
    routes.push({ path, type: "http" });
  }

  const architecture = getArchitectureDescription();
  const hasArtifacts = api.tools.has("artifact_create");
  const context: RoninContext = {
    duties,
    plugins,
    routes,
    architecture,
    hasArtifacts,
  };

  cache.set(RONIN_CONTEXT_KEY, context, {
    maxUses: RONIN_CONTEXT_MAX_USES,
    maxAgeMs: RONIN_CONTEXT_MAX_AGE_MS,
  });
  return context;
}

/**
 * Static Ronin architecture description. Cached with high maxUses and 5min TTL.
 */
export function getArchitectureDescription(): string {
  const cache = getDefaultCache();
  const cached = cache.get<string>(ARCHITECTURE_KEY);
  if (cached) return cached;

  const text = `Ronin is a Bun-based AI agent framework for TypeScript/JavaScript.

Key Components:
- Duties: Extend BaseDuty, implement execute(), auto-loaded from ~/.ronin/duties/
- Plugins: Tools in ~/.ronin/plugins/, accessed via api.plugins.call()
- Routes: Duties register HTTP routes via api.http.registerRoute()
- Events: Inter-duty communication via api.events.emit/on()
- Memory: Persistent storage via api.memory
- AI: Ollama integration via api.ai (complete, chat, callTools)
- LangChain: Advanced chains/graphs via api.langchain (if plugin loaded)

Duty Structure:
- Static schedule (cron) for scheduled execution
- Static watch (file patterns) for file watching
- Static webhook (path) for HTTP webhooks
- execute() method contains main logic
- Optional onFileChange() and onWebhook() handlers`;

  cache.set(ARCHITECTURE_KEY, text, {
    maxUses: ARCHITECTURE_MAX_USES,
    maxAgeMs: ARCHITECTURE_MAX_AGE_MS,
  });
  return text;
}

/**
 * Build system prompt from Ronin context and options.
 */
export function buildSystemPrompt(
  context: RoninContext,
  options: PromptOptions = {}
): string {
  const {
    role = DEFAULT_ROLE,
    includeArchitecture = true,
    includeDutyList = true,
    includePluginList = true,
    includeRouteList = false,
    sections = [],
    memoryHint = true,
    artifactsHint = context.hasArtifacts ?? false,
  } = options;

  const parts: string[] = [role];
  parts.push(buildFileStructureGuide());
  const personaSection = getPersonaSection();
  if (personaSection) parts.push(personaSection);

  if (includeArchitecture) {
    parts.push(context.architecture);
  }

  if (includeDutyList) {
    const dutyList =
      context.duties.length > 0
        ? context.duties
            .map(
              (d) =>
                `  - ${d.name}${d.description ? `: ${d.description.substring(0, 100)}` : ""}`
            )
            .join("\n")
        : "  (No duties found)";
    parts.push(`CURRENT RONIN SETUP:\n\nAvailable Duties:\n${dutyList}`);
  }

  if (includePluginList) {
    const pluginList =
      context.plugins.length > 0
        ? context.plugins.map((p) => `  - ${p}`).join("\n")
        : "  (No plugins found)";
    parts.push(`Available Plugins:\n${pluginList}`);
  }

  if (includeRouteList) {
    const routeList =
      context.routes.length > 0
        ? context.routes.map((r) => `  - ${r.path}`).join("\n")
        : "  (No routes found)";
    parts.push(`Registered Routes:\n${routeList}`);
  }

  parts.push(
    "Your role:\n- Answer questions about the Ronin AI agent framework from your knowledge. You already know how duties, plugins, routes, skills, and the SAR loop work — explain them directly without calling tools.\n- Use tools ONLY when you need live data: file contents, database queries, running commands, searching memory for past conversations, or listing current system state.\n- Do NOT call local.shell.safe repeatedly to explore the filesystem when you can answer from knowledge. One or two targeted reads are fine; more than that means you should just answer the question.\n- When users ask \"how do I create a duty\" or \"explain the framework\", ANSWER DIRECTLY. Do not search for documentation first.\n- Only tell the user how to do something in bash or with commands if they explicitly ask for that format.\n- Never confuse Ronin AI agent framework with blockchain platforms. Always clarify you're discussing the AI agent framework built on Bun/TypeScript.\n\nIMPORTANT: If you find yourself calling the same tool or similar tools more than 2-3 times without getting useful results, STOP. Summarize what you know and answer the user's question directly. Do not loop on tool calls."
  );

  if (memoryHint) {
    parts.push(MEMORY_HINT_SECTION);
  }

  if (artifactsHint) {
    parts.push(ARTIFACT_HINT_SECTION);
  }

  for (const section of sections) {
    parts.push(section);
  }

  return parts.join("\n\n");
}

export type ToolResultEntry = { name: string; success: boolean; result: unknown; error?: string };

const MERMAID_LIVE_PREFIX = "https://mermaid.live/";

function findMermaidUrlInResult(r: unknown): string | null {
  if (r === null || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const url = o?.url;
  if (typeof url === "string" && url.startsWith(MERMAID_LIVE_PREFIX)) return url;
  const output = o?.output ?? o?.data;
  if (output !== null && typeof output === "object") {
    const outUrl = (output as Record<string, unknown>)?.url;
    if (typeof outUrl === "string" && outUrl.startsWith(MERMAID_LIVE_PREFIX)) return outUrl;
  }
  return null;
}

/**
 * Extract mermaid.live URL from a skills.run result (mermaid-diagram-generator output).
 * Checks result.output.url, result.url, and any nested object so we never miss the link.
 */
export function getMermaidUrlFromToolResults(
  toolResults: Array<ToolResultEntry>
): string | null {
  for (const tr of toolResults) {
    if ((tr.name !== "skills.run" && tr.name !== "run") || !tr.success || !tr.result) continue;
    const url = findMermaidUrlInResult(tr.result);
    if (url) return url;
  }
  return null;
}

/**
 * Ensure the reply includes the mermaid diagram link from tool results: replace any wrong
 * mermaid.live link or append the link if missing.
 */
export function injectMermaidLinkIntoResponse(
  response: string,
  toolResults: Array<ToolResultEntry>
): string {
  const mermaidUrl = getMermaidUrlFromToolResults(toolResults);
  if (!mermaidUrl) return response;
  if (response.includes(mermaidUrl)) return response;
  const anyMermaidLive = /https:\/\/mermaid\.live\/[^\s)\]>\`"]+/;
  if (anyMermaidLive.test(response)) {
    return response.replace(anyMermaidLive, mermaidUrl);
  }
  return response + `\n\nView/edit diagram: ${mermaidUrl}`;
}

/**
 * Ensure the reply includes a renderable approval card for any contract
 * proposal drafted this turn (contracts.proposeReflex). The chat UI detects
 * a fenced \`\`\`contract-proposal block and renders it as a card with
 * Allow/Refuse buttons — deterministic injection here means the card always
 * appears regardless of what the model chose to say in prose, mirroring
 * injectMermaidLinkIntoResponse's pattern above.
 */
export function injectContractProposalCardIntoResponse(
  response: string,
  toolResults: Array<ToolResultEntry>
): string {
  const fences: string[] = [];
  for (const tr of toolResults) {
    if (tr.name !== "contracts.proposeReflex" || !tr.success || !tr.result) continue;
    const data = tr.result as Record<string, unknown>;
    if (typeof data.id !== "string" || typeof data.preview !== "string") continue;
    const fence = "```contract-proposal\n" + JSON.stringify({ id: data.id, preview: data.preview }) + "\n```";
    // Check for the fence itself, not just the bare id — a model that
    // narrates the id in prose ("...with ID prop_123") must not suppress the
    // card. Real bug: this used to check `response.includes(data.id)`, so a
    // model saying "I've drafted it, ID: prop_123" silently swallowed the
    // card every time, contradicting this function's whole point (see the
    // doc comment above: the card must appear regardless of what the model
    // says in prose).
    if (!response.includes(fence)) fences.push(fence);
  }
  if (fences.length === 0) return response;
  return response + "\n\n" + fences.join("\n\n");
}

/**
 * Same pattern as injectContractProposalCardIntoResponse, for AI-drafted
 * Workflow proposals (workflows.propose, duties/workflow-manager.ts). The
 * chat UI detects a fenced \`\`\`workflow-proposal block and renders it as an
 * Allow/Refuse card.
 */
export function injectWorkflowProposalCardIntoResponse(
  response: string,
  toolResults: Array<ToolResultEntry>
): string {
  const fences: string[] = [];
  for (const tr of toolResults) {
    if (tr.name !== "workflows.propose" || !tr.success || !tr.result) continue;
    const data = tr.result as Record<string, unknown>;
    if (typeof data.id !== "string" || typeof data.preview !== "string") continue;
    const fence = "```workflow-proposal\n" + JSON.stringify({ id: data.id, preview: data.preview }) + "\n```";
    // See injectContractProposalCardIntoResponse above — check the fence
    // itself, not the bare id, or a model narrating the id in prose silently
    // suppresses the card.
    if (!response.includes(fence)) fences.push(fence);
  }
  if (fences.length === 0) return response;
  return response + "\n\n" + fences.join("\n\n");
}

/**
 * Same pattern as injectContractProposalCardIntoResponse, for AI-drafted
 * Duty proposals (duties.proposeDuty, duties/duty-executor.ts). The chat UI
 * detects a fenced \`\`\`duty-proposal block and renders it as an Allow/Refuse
 * card. Unlike the contract/workflow fences, this one also carries the full
 * generated `code` — a duty proposal is arbitrary TypeScript with real
 * DutyAPI access once approved, not structured/pre-validated data, so the
 * card shows the actual code (collapsed by default), not just a gloss of it.
 */
export function injectDutyProposalCardIntoResponse(
  response: string,
  toolResults: Array<ToolResultEntry>
): string {
  const fences: string[] = [];
  for (const tr of toolResults) {
    if (tr.name !== "duties.proposeDuty" || !tr.success || !tr.result) continue;
    const data = tr.result as Record<string, unknown>;
    if (typeof data.id !== "string" || typeof data.preview !== "string" || typeof data.code !== "string") continue;
    const fence = "```duty-proposal\n" + JSON.stringify({ id: data.id, preview: data.preview, code: data.code }) + "\n```";
    // See injectContractProposalCardIntoResponse above — this exact bug is
    // what was reported: the model narrated the id in prose ("with ID
    // dprop_..."), `response.includes(data.id)` was true, and the card was
    // silently never appended even though the proposal was drafted
    // successfully. Check the fence itself, not the bare id.
    if (!response.includes(fence)) fences.push(fence);
  }
  if (fences.length === 0) return response;
  return response + "\n\n" + fences.join("\n\n");
}

/**
 * Invalidate conversation summary for a chat (call when new message is appended).
 */
export function invalidateChatSummary(chatId: string): void {
  getDefaultCache().invalidate(CHAT_SUMMARY_PREFIX + chatId);
}

/**
 * Window messages to fit token budget. Uses cached summary for older messages when available.
 */
export async function windowMessages(
  messages: Array<{ role: string; content: string }>,
  budget: number,
  options: WindowingOptions = {}
): Promise<WindowingResult> {
  const recentCount = options.recentCount ?? 8;
  const maxSummaryTokens = options.maxSummaryTokens ?? 300;

  if (messages.length <= recentCount) {
    const totalTokensUsed = messages.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0
    );
    return { recentMessages: messages, totalTokensUsed };
  }

  const recent = messages.slice(-recentCount);
  const older = messages.slice(0, -recentCount);
  let summary: string | undefined;
  const cache = getDefaultCache();

  if (options.chatId) {
    const key = CHAT_SUMMARY_PREFIX + options.chatId;
    summary = cache.get<string>(key);
    if (!summary && options.api && older.length > 0) {
      const summaryText = older
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");
      if (estimateTokens(summaryText) > 100) {
        try {
          const response = await options.api.ai.chat(
            [
              {
                role: "system",
                content:
                  "Summarize this conversation in 2-4 short sentences. Preserve task names, decisions, and any @ronin commands mentioned.",
              },
              { role: "user", content: summaryText },
            ],
            { maxTokens: 150 }
          );
          summary = response.content?.trim() ?? "";
          cache.set(key, summary, {
            maxUses: CHAT_SUMMARY_MAX_USES,
            maxAgeMs: CHAT_SUMMARY_MAX_AGE_MS,
          });
        } catch {
          summary = "(Earlier messages omitted)";
        }
      }
    }
  }

  let totalTokensUsed = recent.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0
  );
  if (summary) {
    const summaryTokens = Math.min(
      estimateTokens(summary),
      maxSummaryTokens
    );
    totalTokensUsed += summaryTokens;
  }

  const result: WindowingResult = {
    summary,
    recentMessages: recent,
    totalTokensUsed,
  };
  return result;
}

