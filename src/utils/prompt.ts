/**
 * Shared prompt construction for chat and tool-enabled flows.
 * Used by chatty, intent-ingress, and tool-orchestrator.
 * Memoizes Ronin context and conversation summaries via cache with use-count decay.
 */

import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { ensureDefaultExternalAgentDir, ensureDefaultAgentDir } from "../cli/commands/config.js";
import { getDefaultCache } from "./cache.js";
import type { AgentAPI } from "../types/index.js";
import type { OpenAIFunctionSchema } from "../tools/types.js";

export interface RoninContext {
  agents: Array<{ name: string; description?: string }>;
  plugins: string[];
  routes: Array<{ path: string; type: string }>;
  architecture: string;
  hasOntology?: boolean;
}

export interface PromptOptions {
  role?: string;
  includeArchitecture?: boolean;
  includeAgentList?: boolean;
  includePluginList?: boolean;
  includeRouteList?: boolean;
  sections?: string[];
  ontologyHint?: boolean;
}

export interface BuildToolPromptParams {
  systemPrompt: string;
  aiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  toolResults: Array<{ name: string; success: boolean; result: unknown; error?: string }>;
}

export interface WindowingResult {
  summary?: string;
  recentMessages: Array<{ role: string; content: string }>;
  totalTokensUsed: number;
}

export interface WindowingOptions {
  chatId?: string;
  api?: AgentAPI;
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

const DEFAULT_ROLE = `You are Ronin AI, a helpful assistant for the Ronin AI agent framework.

CRITICAL: "Ronin" refers to the Ronin AI agent framework - a Bun-based TypeScript/JavaScript framework for building AI agents. This is NOT the Ronin blockchain, Ronin DeFi platform, or any cryptocurrency. When users mention "Ronin", they mean the AI agent framework.`;

const ONTOLOGY_HINT_SECTION = `
KNOWLEDGE GRAPH (use it to find how to do things):
You have access to Ronin's knowledge graph via ontology tools:
- ontology_search: Find entities by type or name. Params: { type?, nameLike?, domain?, limit? }. Types: Skill, Task, Failure, Pipeline, Conversation, ReferenceDoc, Tool (do NOT use "Agent").
- ontology_stats: Get counts by node type and edge relation (what's in the ontology). Use when the user asks for "tables in ontology", "what's in the ontology", "ontology summary", or "list ontology contents". Returns { nodes: { type: count }, edges: { relation: count } }.
- ontology_related: From any node id, get linked nodes and edges (e.g. which tool a ReferenceDoc "uses"). Params: { nodeId, relation?, direction?, depth?, limit? }.
- ontology_context: Structured context for a task (related skills, failures). Params: { taskId, depth?, limit? }.
- ontology_history: Past successful pipelines. Params: { type?, nameLike?, successfulOnly?, limit? }.

DATABASE (ronin.db): For questions about the database itself — list tables, schema, or run custom read-only queries — use local.db.query. It accepts a single SELECT statement (e.g. "SELECT name FROM sqlite_master WHERE type='table'" to list tables, or "SELECT type, COUNT(*) as count FROM ontology_nodes GROUP BY type"). Only SELECT is allowed; results are limited to 100 rows.

DISCOVERY (basic capability): When you are unsure how to fulfill a request, use the graph to find out. (1) Call ontology_search with a relevant type (e.g. type "ReferenceDoc" or "Tool" and optional nameLike for the topic, e.g. "list", "skill", "discover"). (2) From the results, read node summaries — they often state which tool to call and with what args. (3) Use ontology_related(nodeId) if you need to see which tool is linked (e.g. use_tool edges). (4) Then call the indicated tool. Do not guess or refuse; search the graph first, then decide the best tool to call next.

LISTING SKILLS: To list available Ronin skills you MUST call at least one of: (1) ontology_search with { type: "Skill", limit: 50 } to get Skill nodes (name/summary per skill), or (2) skills.list to get the list from disk. If ontology_search returns empty, use skills.list. Never say "no tools are available to retrieve skills" or "skills are not registered in the ontology" without having called one of these first. ontology_stats only gives counts; use ontology_search(type: "Skill") to get the actual skill names and details.

Use the graph both for recall (past work, failures, task context) and for discovery (what tools exist, how to list skills/tools, how to do X). ReferenceDoc and Tool nodes are synced from docs and the tool registry; Skill nodes are installed AgentSkills.`;

/**
 * Single source of truth for discovering agents, plugins, routes.
 * Memoized with use-count decay (maxUses: 10, maxAgeMs: 60s).
 */
export async function getRoninContext(api: AgentAPI): Promise<RoninContext> {
  const cache = getDefaultCache();
  const cached = cache.get<RoninContext>(RONIN_CONTEXT_KEY);
  if (cached) return cached;

  const agents: Array<{ name: string; description?: string }> = [];
  try {
    const externalAgentDir = ensureDefaultExternalAgentDir();
    const localAgentDir = ensureDefaultAgentDir();

    try {
      const externalFiles = await readdir(externalAgentDir);
      for (const file of externalFiles) {
        if (file.endsWith(".ts") || file.endsWith(".js")) {
          const name = file.replace(/\.(ts|js)$/, "");
          let description: string | undefined;
          try {
            const content = await readFile(join(externalAgentDir, file), "utf-8");
            const descMatch =
              content.match(/\/\*\*[\s\S]*?\*\//) ||
              content.match(/\/\/.*description.*/i) ||
              content.match(/export default class \w+ extends BaseAgent[\s\S]{0,500}/);
            if (descMatch) {
              description = descMatch[0].substring(0, 200).replace(/\n/g, " ");
            }
          } catch {
            // ignore
          }
          agents.push({ name, description });
        }
      }
    } catch {
      // external dir may not exist
    }

    try {
      const localFiles = await readdir(localAgentDir);
      for (const file of localFiles) {
        if (file.endsWith(".ts") || file.endsWith(".js")) {
          const name = file.replace(/\.(ts|js)$/, "");
          if (!agents.find((a) => a.name === name)) agents.push({ name });
        }
      }
    } catch {
      // local dir may not exist
    }
  } catch (error) {
    console.warn("[prompt] Error discovering agents:", error);
  }

  const plugins = api.plugins.list();
  const routes: Array<{ path: string; type: string }> = [];
  const allRoutes = api.http.getAllRoutes();
  for (const path of allRoutes.keys()) {
    routes.push({ path, type: "http" });
  }

  const architecture = getArchitectureDescription();
  const hasOntology = api.plugins.has("ontology");
  const context: RoninContext = {
    agents,
    plugins,
    routes,
    architecture,
    hasOntology,
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
- Agents: Extend BaseAgent, implement execute(), auto-loaded from ~/.ronin/agents/
- Plugins: Tools in ~/.ronin/plugins/, accessed via api.plugins.call()
- Routes: Agents register HTTP routes via api.http.registerRoute()
- Events: Inter-agent communication via api.events.emit/on()
- Memory: Persistent storage via api.memory
- AI: Ollama integration via api.ai (complete, chat, callTools)
- LangChain: Advanced chains/graphs via api.langchain (if plugin loaded)

Agent Structure:
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
    includeAgentList = true,
    includePluginList = true,
    includeRouteList = false,
    sections = [],
    ontologyHint = context.hasOntology ?? false,
  } = options;

  const parts: string[] = [role];

  if (includeArchitecture) {
    parts.push(context.architecture);
  }

  if (includeAgentList) {
    const agentList =
      context.agents.length > 0
        ? context.agents
            .map(
              (a) =>
                `  - ${a.name}${a.description ? `: ${a.description.substring(0, 100)}` : ""}`
            )
            .join("\n")
        : "  (No agents found)";
    parts.push(`CURRENT RONIN SETUP:\n\nAvailable Agents:\n${agentList}`);
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
    "Your role:\n- Do the work yourself using the tools you have. Call the tools and return the result. Only tell the user how to do something in bash or with tools if they explicitly ask (e.g. \"how do I run X\", \"what command\", \"show me the steps\").\n- Answer questions about the Ronin AI agent framework architecture\n- Explain how agents, plugins, and routes work\n- Help users understand their current Ronin setup\n- Discuss agent creation, plugin usage, and route registration\n- Analyze agent outputs (e.g., RSS feeds) when requested\n\nIMPORTANT: Never confuse Ronin AI agent framework with blockchain platforms. Always clarify you're discussing the AI agent framework built on Bun/TypeScript."
  );

  if (ontologyHint) {
    parts.push(ONTOLOGY_HINT_SECTION);
  }

  for (const section of sections) {
    parts.push(section);
  }

  return parts.join("\n\n");
}

/**
 * Build tool-calling prompt. Preserves structure: system prompt + transcript + tool results.
 */
export function buildToolPrompt(params: BuildToolPromptParams): string {
  const transcript = params.aiMessages
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n\n");

  const toolSection =
    params.toolResults.length > 0
      ? `

Executed tool results:
${params.toolResults
          .map((tr) =>
            JSON.stringify({
              tool: tr.name,
              success: tr.success,
              result: tr.result,
              error: tr.error,
            })
          )
          .join("\n")}`
      : "";

  const failureInstruction = params.toolResults.some(
    (tr) => !tr.success || tr.error
  )
    ? "\n\nIMPORTANT: At least one tool failed (success: false or error). Before concluding you cannot help: (1) If you have not yet called local.memory.search, call it with a query about the user's question. (2) Use ontology_search (e.g. type 'ReferenceDoc' or 'Tool', nameLike matching the request) to find how to fulfill the request and which tool to call. (3) Only after trying memory search and/or ontology discovery may you tell the user that a tool failed and what went wrong."
    : "";

  return `${params.systemPrompt}

Conversation transcript:
${transcript}${toolSection}${failureInstruction}

TOOL CALLING: To run a tool you must respond with tool calls (each with a tool name and arguments). Plain text alone does not execute any tool. If the task requires tools, output tool calls now. If you cannot complete the task (e.g. you need to give up or only have a text reply), use the available abort/finish mechanism (e.g. skill_maker.finish with status "abort") so the run is explicitly aborted rather than leaving it ambiguous. After your tool calls run, you get another turn with the results; you can call more tools or call finish. Respond to the latest message; if you need to act, call the appropriate tool(s) first.`;
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

/**
 * Rough token estimator (chars / 3.5). Conservative for budget enforcement.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 3.5);
}

/**
 * Filter tool schemas by message context to stay within budget and relevance.
 * Always includes core tools; conditionally includes ontology, Discord/Telegram, speech.
 */
export function filterToolSchemas(
  allSchemas: OpenAIFunctionSchema[],
  context: {
    message: string;
    hasOntology?: boolean;
    hasSkills?: boolean;
    maxSchemas?: number;
  }
): OpenAIFunctionSchema[] {
  const maxSchemas = context.maxSchemas ?? 12;
  const msg = (context.message ?? "").toLowerCase();

  // Check if this looks like a tool-using query vs simple chat
  const isToolQuery = /\b(skills?|notes?|weather|email|mail|messages?|discord|telegram|search|run|execute|list|get|find|read|write|create|delete|update|discuss|explain|tell me about|about|tables?|database|schema|ronin\.db|diagram|mermaid|flowchart|flow chart|chart|draw)\b/.test(msg);
  const isQuestion = /\b(what|how|who|where|when|why|which|can|could|would|will|is|are|do|does|did)\b/.test(msg);
  const isGreeting = /\b(hello|hi|hey|good morning|good afternoon|good evening|greetings|howdy)\b/.test(msg);
  // Include tools when user asks about agents/architecture (so memory + ontology can be used)
  const isAboutAgents = /\b(agent|agents|intent-ingress|chatty|ronin)\b/.test(msg);

  // Only include tools for actual tool queries, not simple chat/greetings
  if ((!isToolQuery && !isAboutAgents) || (isGreeting && !isToolQuery && !isAboutAgents)) {
    return []; // Return empty for simple chat - let local model handle it
  }

  const coreNames = new Set([
    "local.memory.search",
    "local.events.emit",
    "skills.run",
  ]);

  const ontologyNames = new Set([
    "ontology_search",
    "ontology_related",
    "ontology_context",
    "ontology_history",
    "ontology_lookup",
    "ontology_stats",
  ]);

  const includeOntology =
    context.hasOntology &&
    /past|previous|before|history|failure|failed|why|what happened|that task|that skill|recall|remember|agent|agents|discuss|explain|about|docs?|tools?|reference|ronin script|skills?|ontology|tables?|schema|database/.test(
      msg
    );

  const includeDiscord = /discord|guild|channel.*discord/.test(msg);
  const includeTelegram = /telegram|telegram bot/.test(msg);
  const includeSpeech = /say|speak|listen|voice|hear|tell me out loud/.test(
    msg
  );
  const includeDb = /\b(database|tables?|schema|ronin\.db|sql)\b/.test(msg);
  const isDiagramRequest = /\b(diagram|mermaid|flowchart|flow chart|chart|draw)\b/.test(msg);

  const result: OpenAIFunctionSchema[] = [];
  for (const schema of allSchemas) {
    const name = schema.function?.name ?? "";
    if (coreNames.has(name) || (name === "skills.run" && context.hasSkills)) {
      result.push(schema);
      continue;
    }
    if (isDiagramRequest && name.startsWith("local.ronin_script.")) {
      continue;
    }
    if (name === "local.db.query" && includeDb) {
      result.push(schema);
      continue;
    }
    if (ontologyNames.has(name)) {
      if (includeOntology) result.push(schema);
      continue;
    }
    if (name.startsWith("local.discord.") && includeDiscord) {
      result.push(schema);
      continue;
    }
    if (name.startsWith("local.telegram.") && includeTelegram) {
      result.push(schema);
      continue;
    }
    if (
      (name === "local.speech.say" || name === "local.speech.listen") &&
      includeSpeech
    ) {
      result.push(schema);
      continue;
    }
    if (
      !name.startsWith("ontology_") &&
      !name.startsWith("local.discord.") &&
      !name.startsWith("local.telegram.")
    ) {
      result.push(schema);
    }
  }

  if (result.length > maxSchemas) {
    return result.slice(0, maxSchemas);
  }
  return result;
}
