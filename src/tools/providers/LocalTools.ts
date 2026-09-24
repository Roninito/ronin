import type { ToolDefinition, ToolContext, ToolResult } from "../types.js";
import type { DutyAPI } from "../../types/index.js";
import { parse, serialize, toJson, fromJson, fromJsonToScript } from "../../ronin-script/index.js";
import { readCategoryDoc } from "../toolDocs.js";
import { DEFAULT_EPHEMERAL_TTL_MS, registerEphemeralFile, sweepExpiredEphemeralFiles } from "../../utils/ephemeralFiles.js";
import { mkdirSync } from "fs";
import { writeFile as writeFileAsync, unlink as unlinkAsync } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

// Global queue to ensure TTS playback is strictly serialized across all callers.
let speechQueue: Promise<void> = Promise.resolve();

async function runSpeechQueued(task: () => Promise<void>): Promise<void> {
  const run = speechQueue.then(task);
  // Keep queue alive even if one speech call fails.
  speechQueue = run.catch(() => undefined);
  return run;
}

/**
 * Send a pending-response question to the user's preferred chat (Telegram or Discord).
 * Used when local.notify.ask times out so the user can respond later.
 */
async function sendToChatChannel(
  api: DutyAPI,
  title: string,
  message: string,
  buttons: string[],
  taskId: string
): Promise<"telegram" | "discord" | null> {
  const preferred = api.config.getNotifications?.()?.preferredChat ?? "auto";

  const replyLine =
    buttons.length > 0
      ? `Reply with: ${buttons.map((b, i) => `${i + 1}) ${b}`).join("  ")}`
      : "Reply when ready.";
  const body = `[Ronin] ${title}\n\n${message}\n\n${replyLine}\nTask: ${taskId}`;

  const tryTelegram = async (): Promise<boolean> => {
    if (!api.telegram) return false;
    const tg = api.config.getTelegram();
    const token = tg.botToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = tg.chatId || process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return false;
    try {
      const botId = await api.telegram.initBot(token);
      await api.telegram.sendMessage(botId, chatId, body);
      return true;
    } catch {
      return false;
    }
  };

  const tryDiscord = async (): Promise<boolean> => {
    if (!api.discord) return false;
    const dc = api.config.getDiscord();
    if (!dc.enabled || !dc.botToken || !dc.channelIds?.length) return false;
    const channelId = dc.channelIds[0]!; // length check above guarantees index 0 exists
    try {
      const clientId = await api.discord.initBot(dc.botToken);
      await api.discord.sendMessage(clientId, channelId, body);
      return true;
    } catch {
      return false;
    }
  };

  if (preferred === "telegram") {
    return (await tryTelegram()) ? "telegram" : null;
  }
  if (preferred === "discord") {
    return (await tryDiscord()) ? "discord" : null;
  }
  // auto: try Telegram first, then Discord
  if (await tryTelegram()) return "telegram";
  if (await tryDiscord()) return "discord";
  return null;
}

/**
 * Local Tools Registry
 * 
 * Built-in tools that run locally without external APIs
 */
export function registerLocalTools(api: DutyAPI, register: (tool: ToolDefinition) => void): void {

  // Ephemeral screenshot storage: ensure the directory exists and sweep any
  // files orphaned by a crash/restart before their TTL timer could fire.
  const screenshotsDir = join(api.config.getSystem().dataDir, "tmp", "screenshots");
  try {
    mkdirSync(screenshotsDir, { recursive: true });
  } catch {
    // Best-effort — local.screen.capture will surface a clear error if this directory is unusable.
  }
  void sweepExpiredEphemeralFiles(screenshotsDir).catch(() => {});

  // 1. Memory Search Tool
  register({
    name: "local.memory.search",
    description: "Search Ronin's memory for relevant information",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", default: 5, description: "Maximum results" },
      },
      required: ["query"],
    },
    provider: "local",
    handler: async (args: { query: string; limit?: number }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const results = await api.memory.search(args.query, args.limit || 5);
        const truncate = (s: string, max: number): string =>
          s.length > max ? `${s.slice(0, max)}…` : s;
        const summarizeValue = (value: unknown): string => {
          try {
            const raw = typeof value === "string" ? value : JSON.stringify(value);
            return truncate(raw ?? String(value), 4000);
          } catch {
            return truncate(String(value), 4000);
          }
        };
        const safeResults = results.map((r: any) => ({
          id: r.id,
          key: r.key,
          text: r.text ? truncate(String(r.text), 500) : undefined,
          valueSummary: summarizeValue(r.value),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
        return {
          success: true,
          data: { results: safeResults, count: safeResults.length },
          metadata: {
            toolName: "local.memory.search",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Search failed",
          metadata: {
            toolName: "local.memory.search",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: true,
    ttl: 300,
    riskLevel: "low",
  });

  // 1a. Read-only database query (ronin.db) — SELECT only
  register({
    name: "local.db.query",
    description:
      "Run a read-only SELECT query against Ronin's database (ronin.db) — contracts, tasks, katas, and usage tables. Memory/conversation/blackboard content lives in plain markdown files under memory/, not this database; use local.memory.search for that instead. Only SELECT is allowed; other SQL is rejected. Limit results to 100 rows.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A single SELECT SQL statement (e.g. \"SELECT name FROM sqlite_master WHERE type='table'\", or \"SELECT status, COUNT(*) as count FROM tasks_v2 GROUP BY status\")",
        },
        params: {
          type: "array",
          description: "Optional parameters for ? placeholders in the query (in order)",
          items: { type: "string" },
        },
      },
      required: ["query"],
    },
    provider: "local",
    handler: async (args: { query: string; params?: string[] }): Promise<ToolResult> => {
      const startTime = Date.now();
      const MAX_ROWS = 100;
      try {
        const raw = (args.query ?? "").trim();
        const upper = raw.toUpperCase();
        if (!raw) {
          return {
            success: false,
            data: null,
            error: "Query is required",
            metadata: {
              toolName: "local.db.query",
              provider: "local",
              duration: Date.now() - startTime,
              cached: false,
              timestamp: Date.now(),
              callId: `local-${Date.now()}`,
            },
          };
        }
        const queryNoTrailingSemicolon = raw.replace(/;\s*$/, "");
        if (queryNoTrailingSemicolon.includes(";")) {
          return {
            success: false,
            data: null,
            error: "Only a single SELECT statement is allowed",
            metadata: {
              toolName: "local.db.query",
              provider: "local",
              duration: Date.now() - startTime,
              cached: false,
              timestamp: Date.now(),
              callId: `local-${Date.now()}`,
            },
          };
        }
        if (!upper.startsWith("SELECT")) {
          return {
            success: false,
            data: null,
            error: "Only SELECT queries are allowed (read-only)",
            metadata: {
              toolName: "local.db.query",
              provider: "local",
              duration: Date.now() - startTime,
              cached: false,
              timestamp: Date.now(),
              callId: `local-${Date.now()}`,
            },
          };
        }
        const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|ATTACH|DETACH|PRAGMA\s+write|VACUUM)\b/i;
        if (forbidden.test(queryNoTrailingSemicolon)) {
          return {
            success: false,
            data: null,
            error: "Only read-only SELECT is allowed",
            metadata: {
              toolName: "local.db.query",
              provider: "local",
              duration: Date.now() - startTime,
              cached: false,
              timestamp: Date.now(),
              callId: `local-${Date.now()}`,
            },
          };
        }
        const params = Array.isArray(args.params) ? args.params : [];
        const rows = await api.db.query<Record<string, unknown>>(queryNoTrailingSemicolon, params);
        const limited = rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows;
        return {
          success: true,
          data: {
            rows: limited,
            rowCount: limited.length,
            truncated: rows.length > MAX_ROWS,
          },
          metadata: {
            toolName: "local.db.query",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Query failed",
          metadata: {
            toolName: "local.db.query",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: false,
    riskLevel: "medium",
  });

  // 1b. Ronin Script tools (parse, JSON round-trip, aggregate)
  register({
    name: "local.ronin_script.parse",
    description: "Parse Ronin Script text into a structured AST. Use for validating or transforming Ronin Script.",
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "Ronin Script content to parse" },
        asJson: { type: "boolean", default: false, description: "If true, also return JSON representation" },
      },
      required: ["script"],
    },
    provider: "local",
    handler: async (args: { script: string; asJson?: boolean }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const ast = parse(args.script);
        const data: { ast: unknown; json?: unknown } = { ast };
        if (args.asJson) data.json = toJson(ast);
        return {
          success: true,
          data,
          metadata: {
            toolName: "local.ronin_script.parse",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Parse failed",
          metadata: {
            toolName: "local.ronin_script.parse",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    riskLevel: "low",
    cacheable: false,
  });

  register({
    name: "local.ronin_script.to_json",
    description: "Convert Ronin Script (string or AST) to JSON for APIs or persistence.",
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "Ronin Script content (or leave empty if passing ast)" },
        ast: { type: "object", description: "Parsed AST from local.ronin_script.parse (optional)" },
      },
      required: [],
    },
    provider: "local",
    handler: async (args: { script?: string; ast?: unknown }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const json = args.script ? toJson(args.script) : (args.ast ? toJson(args.ast as ReturnType<typeof parse>) : null);
        if (json == null) {
          return {
            success: false,
            data: null,
            error: "Provide script or ast",
            metadata: { toolName: "local.ronin_script.to_json", provider: "local", duration: Date.now() - startTime, cached: false, timestamp: Date.now(), callId: `local-${Date.now()}` },
          };
        }
        return {
          success: true,
          data: { json },
          metadata: { toolName: "local.ronin_script.to_json", provider: "local", duration: Date.now() - startTime, cached: false, timestamp: Date.now(), callId: `local-${Date.now()}` },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "to_json failed",
          metadata: { toolName: "local.ronin_script.to_json", provider: "local", duration: Date.now() - startTime, cached: false, timestamp: Date.now(), callId: `local-${Date.now()}` },
        };
      }
    },
    riskLevel: "low",
    cacheable: false,
  });

  register({
    name: "local.ronin_script.from_json",
    description: "Convert JSON to Ronin Script string. Use for external systems feeding Ronin Script via JSON.",
    parameters: {
      type: "object",
      properties: {
        json: { type: "object", description: "JSON object (typeDefs, entities, relationships)" },
      },
      required: ["json"],
    },
    provider: "local",
    handler: async (args: { json: unknown }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const script = fromJsonToScript(args.json as Parameters<typeof fromJson>[0]);
        return {
          success: true,
          data: { script },
          metadata: { toolName: "local.ronin_script.from_json", provider: "local", duration: Date.now() - startTime, cached: false, timestamp: Date.now(), callId: `local-${Date.now()}` },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "from_json failed",
          metadata: { toolName: "local.ronin_script.from_json", provider: "local", duration: Date.now() - startTime, cached: false, timestamp: Date.now(), callId: `local-${Date.now()}` },
        };
      }
    },
    riskLevel: "low",
    cacheable: false,
  });

  register({
    name: "local.ronin_script.aggregate",
    description: "Aggregate a memory search into a token-efficient Ronin Script snapshot.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query for memory" },
        memoryLimit: { type: "number", default: 10, description: "Max memory results" },
      },
      required: ["query"],
    },
    provider: "local",
    cacheable: false,
    handler: async (args: { query: string; memoryLimit?: number }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const memLimit = args.memoryLimit ?? 10;
        const memResults = await api.memory.search(args.query, memLimit);
        const entities: Array<{ type: string; values: string[] }> = memResults.map((m) => ({
          type: "memory",
          values: [String(m.key ?? m.id), String(m.text ?? m.value ?? "").slice(0, 300), String(m.createdAt?.getTime() ?? "")],
        }));
        const lines: string[] = ["# Entities"];
        for (const e of entities) {
          lines.push([e.type, ...e.values].join(" "));
        }
        const script = lines.join("\n");
        return {
          success: true,
          data: { script, entityCount: entities.length },
          metadata: { toolName: "local.ronin_script.aggregate", provider: "local", duration: Date.now() - startTime, cached: false, timestamp: Date.now(), callId: `local-${Date.now()}` },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "aggregate failed",
          metadata: { toolName: "local.ronin_script.aggregate", provider: "local", duration: Date.now() - startTime, cached: false, timestamp: Date.now(), callId: `local-${Date.now()}` },
        };
      }
    },
    riskLevel: "low",
  });

  // 2. File Read Tool
  register({
    name: "local.file.read",
    description: "Read a file from the filesystem",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        encoding: { type: "string", enum: ["utf8", "base64"], default: "utf8" },
      },
      required: ["path"],
    },
    provider: "local",
    handler: async (args: { path: string; encoding?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const content = await api.files.read(args.path);
        return {
          success: true,
          data: { content, path: args.path },
          metadata: {
            toolName: "local.file.read",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "File read failed",
          metadata: {
            toolName: "local.file.read",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: true,
    ttl: 60,
    riskLevel: "medium",
  });

  // 3. File List Tool
  register({
    name: "local.file.list",
    description: "List files in a directory",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Directory path" },
        pattern: { type: "string", description: "Glob pattern (optional)" },
      },
      required: ["directory"],
    },
    provider: "local",
    handler: async (args: { directory: string; pattern?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const files = await api.files.list(args.directory, args.pattern);
        return {
          success: true,
          data: { files, directory: args.directory },
          metadata: {
            toolName: "local.file.list",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "File listing failed",
          metadata: {
            toolName: "local.file.list",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: true,
    ttl: 30,
    riskLevel: "low",
  });

  // 3b. Tool Category Docs — load a plugin category's real tool signatures on
  // demand. Plugin tools (~186 of them, one per plugin method) are deliberately
  // NOT included in every chat request; the model sees a compact category index
  // instead and calls this to get exact names/descriptions/parameters for one
  // category before calling anything in it. See src/tools/toolDocs.ts.
  register({
    name: "local.tools.load_category",
    description:
      "Load the full tool signatures (names, descriptions, parameters) for one plugin category. Call this before calling any tool from a category you haven't loaded yet in this conversation — see the tool category index for available category names.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category name from the tool category index, e.g. \"git\" or \"telegram\"" },
      },
      required: ["category"],
    },
    provider: "local",
    handler: async (args: { category: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      const meta = (extra: Record<string, unknown> = {}) => ({
        toolName: "local.tools.load_category",
        provider: "local",
        duration: Date.now() - startTime,
        cached: false,
        timestamp: Date.now(),
        callId: `local-${Date.now()}`,
        ...extra,
      });
      const category = (args?.category ?? "").trim();
      if (!category) {
        return { success: false, data: null, error: "category is required", metadata: meta() };
      }
      try {
        const docs = await readCategoryDoc(api, category);
        return { success: true, data: { category, docs }, metadata: meta() };
      } catch {
        return {
          success: false,
          data: null,
          error: `No tool category named "${category}". Check the tool category index for valid names.`,
          metadata: meta(),
        };
      }
    },
    cacheable: false,
    riskLevel: "low",
  });

  // 4. Shell Command Tool (restricted)
  register({
    name: "local.shell.safe",
    description: "Execute safe shell commands (read-only operations, plus agent-browser for browser automation/screenshots). Allowed commands: ls, cat, head, tail, echo, pwd, cd, find, grep, wc, sort, uniq, diff, date, cal, time, uptime, whoami, uname, sw_vers, sysctl, git, curl, bun, node, npm, npx, pnpm, yarn, osascript, open, pbcopy, pbpaste, agent-browser.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["command"],
    },
    provider: "local",
    handler: async (args: { command: string; cwd?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      
      // Whitelist of safe commands (checked against the base command word)
      const configuredCommands = api.config.getAll?.()?.system?.safeShellCommands;
      const safeCommands = Array.isArray(configuredCommands) && configuredCommands.length > 0
        ? configuredCommands
        : [
            'ls', 'cat', 'head', 'tail', 'echo', 'pwd', 'cd',
            'find', 'grep', 'wc', 'sort', 'uniq', 'diff',
            'date', 'cal', 'time', 'uptime', 'whoami', 'uname', 'sw_vers', 'sysctl',
            'git', 'curl', 'bun', 'node', 'npm', 'npx', 'pnpm', 'yarn',
            'osascript', 'open', 'pbcopy', 'pbpaste',
            'agent-browser',
          ];
      const baseCmd = args.command.split(' ')[0]!; // split() always returns >= 1 element
      
      if (!safeCommands.includes(baseCmd)) {
        return {
          success: false,
          data: null,
          error: `Command '${baseCmd}' is not in the safe commands list`,
          metadata: {
            toolName: "local.shell.safe",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
      
      try {
        // Use exec from child_process
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        const { stdout, stderr } = await execAsync(args.command, {
          cwd: args.cwd,
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        });
        
        return {
          success: true,
          data: { stdout, stderr },
          metadata: {
            toolName: "local.shell.safe",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Command failed",
          metadata: {
            toolName: "local.shell.safe",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: false,
    riskLevel: "medium",
  });

  // 5. HTTP Request Tool
  register({
    name: "local.http.request",
    description: "Make HTTP requests to external APIs",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Request URL" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], default: "GET" },
        headers: { type: "object", description: "Request headers" },
        body: { type: "string", description: "Request body" },
      },
      required: ["url"],
    },
    provider: "local",
    handler: async (args: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const response = await fetch(args.url, {
          method: args.method || "GET",
          headers: args.headers,
          body: args.body,
        });
        
        const contentType = response.headers.get("content-type");
        let data: any;
        
        if (contentType?.includes("application/json")) {
          data = await response.json();
        } else {
          data = await response.text();
        }
        
        // forEach (not .entries()/for-of) because tsconfig's `lib` has "DOM" but not
        // "DOM.Iterable" — Headers' iterator protocol methods aren't typed without it.
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => { responseHeaders[key] = value; });

        return {
          success: response.ok,
          data: {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            data,
          },
          metadata: {
            toolName: "local.http.request",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Request failed",
          metadata: {
            toolName: "local.http.request",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: true,
    ttl: 60,
    riskLevel: "low",
  });

  // 6. Reasoning Tool (uses local Ollama)
  register({
    name: "local.reasoning",
    description: "Perform reasoning using the local Ollama model",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Reasoning prompt" },
        context: { type: "string", description: "Additional context" },
      },
      required: ["prompt"],
    },
    provider: "local",
    handler: async (args: { prompt: string; context?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const fullPrompt = args.context 
          ? `Context: ${args.context}\n\nTask: ${args.prompt}`
          : args.prompt;
        
        const response = await api.ai.complete(fullPrompt, {
          maxTokens: 2000,
          temperature: 0.7,
        });
        
        return {
          success: true,
          data: { response },
          metadata: {
            toolName: "local.reasoning",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Reasoning failed",
          metadata: {
            toolName: "local.reasoning",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: true,
    ttl: 300,
    riskLevel: "low",
  });

  // 7. Emit Event Tool
  register({
    name: "local.events.emit",
    description:
      "Emit a Ronin event so other agents or the event monitor can react. Use for signaling completion, proposing plans (e.g. PlanProposed, TaskCreated), or custom events.",
    parameters: {
      type: "object",
      properties: {
        event: {
          type: "string",
          description: "Event type name (e.g. PlanProposed, TaskCreated, or custom)",
        },
        data: {
          type: "object",
          description: "Payload object (any JSON-serializable data)",
        },
        source: {
          type: "string",
          description: "Optional event source; defaults to 'ai' or current agent if known",
        },
      },
      required: ["event", "data"],
    },
    provider: "local",
    handler: async (
      args: { event: string; data: Record<string, unknown>; source?: string },
      context: ToolContext
    ): Promise<ToolResult> => {
      const startTime = Date.now();
      if (args.event == null || args.event === "") {
        return {
          success: false,
          data: null,
          error: "event is required and must be non-empty",
          metadata: {
            toolName: "local.events.emit",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
      if (args.data == null || typeof args.data !== "object") {
        return {
          success: false,
          data: null,
          error: "data is required and must be an object",
          metadata: {
            toolName: "local.events.emit",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
      const source = args.source ?? context.metadata?.dutyName ?? "ai";
      try {
        api.events.emit(args.event, args.data, source);
        return {
          success: true,
          data: { emitted: true, event: args.event, source },
          metadata: {
            toolName: "local.events.emit",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Emit failed",
          metadata: {
            toolName: "local.events.emit",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: false,
    riskLevel: "low",
  });

  // 8. Speech Say Tool (uses Piper TTS plugin)
  register({
    name: "local.speech.say",
    description: "Speak text aloud using text-to-speech. Use this to verbally communicate with the user.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to speak aloud" },
      },
      required: ["text"],
    },
    provider: "local",
    handler: async (args: { text: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        await runSpeechQueued(async () => {
          const ttsConfig = api.config.getAll?.()?.speech?.tts;
          if (ttsConfig?.backend === "agent-voice" && api.plugins.has("agent-voice")) {
            await api.plugins.call("agent-voice", "speak", args.text, { voice: ttsConfig.agentVoiceVoice });
          } else if (api.plugins.has("piper")) {
            await api.plugins.call("piper", "speakAndPlay", args.text);
          } else {
            // Fallback: macOS say command
            if (process.platform === "darwin") {
              const { exec } = require("child_process");
              const { promisify } = require("util");
              const execAsync = promisify(exec);
              const escaped = args.text.replace(/"/g, '\\"').replace(/'/g, "'\\''");
              await execAsync(`say "${escaped}"`);
            } else {
              throw new Error("No TTS backend available. Install piper plugin or run on macOS.");
            }
          }
        });
        return {
          success: true,
          data: { spoken: true, text: args.text },
          metadata: {
            toolName: "local.speech.say",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Speech synthesis failed",
          metadata: {
            toolName: "local.speech.say",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: false,
    riskLevel: "low",
  });

  // 9. Screen Capture Tool (uses screenshot plugin, macOS only)
  register({
    name: "local.screen.capture",
    description: "Capture a screenshot of the Mac's screen. Modes: \"full\" (entire screen), \"display\" (a specific monitor), \"region\" (interactively drag-select an area), \"window\" (click a window). The image file is automatically deleted 60 seconds after capture — analyze it with local.vision.analyze right away.",
    parameters: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["full", "display", "region", "window"], description: "Capture mode (default: full)" },
        displayId: { type: "number", description: "Display index, only used when mode is \"display\"" },
      },
      required: [],
    },
    provider: "local",
    handler: async (args: { mode?: string; displayId?: number }): Promise<ToolResult> => {
      const startTime = Date.now();
      const desktop = api.config.getAll?.()?.desktop;
      if (desktop?.features?.screenCapture === false) {
        return {
          success: false,
          data: null,
          error: "Screen capture is disabled (desktop.features.screenCapture is false in config).",
          metadata: {
            toolName: "local.screen.capture",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
      if (!api.plugins.has("screenshot")) {
        return {
          success: false,
          data: null,
          error: "Screenshot plugin not loaded (macOS only).",
          metadata: {
            toolName: "local.screen.capture",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }

      try {
        const mode = args.mode ?? "full";
        const outputPath = join(screenshotsDir, `screenshot-${Date.now()}-${randomUUID().slice(0, 8)}.png`);

        let result: { path: string; format: "png"; capturedAt: number };
        switch (mode) {
          case "full":
            result = await api.plugins.call("screenshot", "captureFullScreen", outputPath) as typeof result;
            break;
          case "display":
            result = await api.plugins.call("screenshot", "captureDisplay", args.displayId ?? 0, outputPath) as typeof result;
            break;
          case "region":
            result = await api.plugins.call("screenshot", "captureInteractiveRegion", outputPath) as typeof result;
            break;
          case "window":
            result = await api.plugins.call("screenshot", "captureInteractiveWindow", outputPath) as typeof result;
            break;
          default:
            throw new Error(`Unknown mode "${mode}". Use "full", "display", "region", or "window".`);
        }

        registerEphemeralFile(result.path);

        return {
          success: true,
          data: { path: result.path, expiresAt: Date.now() + DEFAULT_EPHEMERAL_TTL_MS },
          metadata: {
            toolName: "local.screen.capture",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Screenshot capture failed",
          metadata: {
            toolName: "local.screen.capture",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: false,
    riskLevel: "medium",
  });

  // 10. Vision Analysis Tool (uses AIAPI.analyzeImage — Ollama vision models only)
  register({
    name: "local.vision.analyze",
    description: "Analyze an image (e.g. a screenshot from local.screen.capture) with a vision-capable AI model and answer a question or describe it.",
    parameters: {
      type: "object",
      properties: {
        imagePath: { type: "string", description: "Path to the image file to analyze" },
        prompt: { type: "string", description: "What to ask about the image (e.g. \"what's on this screen?\")" },
      },
      required: ["imagePath", "prompt"],
    },
    provider: "local",
    handler: async (args: { imagePath: string; prompt: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const answer = await api.ai.analyzeImage(args.imagePath, args.prompt);
        return {
          success: true,
          data: { answer },
          metadata: {
            toolName: "local.vision.analyze",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Image analysis failed",
          metadata: {
            toolName: "local.vision.analyze",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: false,
    riskLevel: "low",
  });

  // 11. AppleScript Tool (dedicated, auditable — mirrors local.shell.safe's osascript-already-allowed path)
  register({
    name: "local.system.applescript",
    description: "Run an AppleScript to control apps, windows, and system UI on this Mac (launch/quit apps, move windows, show dialogs, System Events UI scripting, etc.). This can take real actions on the system — write scripts deliberately.",
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "AppleScript source to execute" },
      },
      required: ["script"],
    },
    provider: "local",
    handler: async (args: { script: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      const scriptPath = join(tmpdir(), `ronin-applescript-${Date.now()}-${randomUUID().slice(0, 8)}.scpt`);
      try {
        await writeFileAsync(scriptPath, args.script, "utf-8");

        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          const { spawn } = require("child_process");
          const proc = spawn("osascript", [scriptPath], { stdio: ["ignore", "pipe", "pipe"] });
          let stdout = "";
          let stderr = "";
          const timeout = setTimeout(() => {
            proc.kill();
            reject(new Error("AppleScript execution timed out after 10 seconds"));
          }, 10000);
          proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
          proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
          proc.on("close", (code: number) => {
            clearTimeout(timeout);
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(stderr.trim() || `osascript exited with code ${code}`));
          });
          proc.on("error", (err: Error) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to run osascript: ${err.message}`));
          });
        });

        return {
          success: true,
          data: { stdout, stderr },
          metadata: {
            toolName: "local.system.applescript",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "AppleScript execution failed",
          metadata: {
            toolName: "local.system.applescript",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } finally {
        await unlinkAsync(scriptPath).catch(() => {});
      }
    },
    cacheable: false,
    riskLevel: "medium",
  });

  // 8b. Skills tools (when skills plugin is loaded)
  if (api.skills) {
    // List all skills directly from disk.
    register({
      name: "skills.list",
      description:
        "Return the list of all installed Ronin AgentSkills (from ~/.ronin/skills and ./skills). " +
        "Use when the user asks what skills are available or to discover skills. " +
        "Returns array of { name, description }.",
      parameters: { type: "object", properties: {}, required: [] },
      provider: "local",
      handler: async (): Promise<ToolResult> => {
        const startTime = Date.now();
        const meta = () => ({
          toolName: "skills.list",
          provider: "local",
          duration: Date.now() - startTime,
          cached: false,
          timestamp: Date.now(),
          callId: `local-${Date.now()}`,
        });
        let skills: { name: string; description: string }[] = [];
        try {
          skills = (await api.plugins.call("skills", "discover_skills", "")) as { name: string; description: string }[];
        } catch {
          // ignore
        }
        if (!skills.length) {
          const { readdirSync, existsSync: fsExists, readFileSync } = require("fs");
          const { join } = require("path");
          const { homedir } = require("os");
          const skillsDirs: string[] = [];
          const system = api.config.getSystem();
          const userDir = (system as { skillsDir?: string }).skillsDir ?? join(homedir(), ".ronin", "skills");
          if (fsExists(userDir)) skillsDirs.push(userDir);
          const projDir = join(process.cwd(), "skills");
          if (fsExists(projDir) && projDir !== userDir) skillsDirs.push(projDir);
          for (const dir of skillsDirs) {
            try {
              for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const skillMd = join(dir, entry.name, "skill.md");
                const skillMdAlt = join(dir, entry.name, "SKILL.md");
                const mdPath = fsExists(skillMd) ? skillMd : fsExists(skillMdAlt) ? skillMdAlt : null;
                if (!mdPath) continue;
                const content = readFileSync(mdPath, "utf-8");
                const nameMatch = content.match(/name:\s*(.+)/);
                const descMatch = content.match(/description:\s*(.+)/);
                const sName = (nameMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
                const sDesc = (descMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
                skills.push({ name: sName || entry.name, description: sDesc });
              }
            } catch {
              // ignore
            }
          }
        }
        return { success: true, data: skills, metadata: meta() };
      },
      cacheable: false,
      riskLevel: "low",
    });

    register({
      name: "skills.run",
      description:
        "Run an AgentSkill in one step. Finds a skill matching the query, picks the best ability for the action, and executes it. " +
        "Use for ALL skill operations including: listing skills, getting weather, managing notes, reading emails, etc. " +
        "Examples: query='skills' action='list all skills' | query='apple notes' action='list all notes' | query='weather' action='get weather in Miami'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search term to find the skill (e.g. 'apple notes', 'notes')" },
          action: { type: "string", description: "What the user wants to do (e.g. 'list notes', 'read note titled hello', 'search for green')" },
          params: { type: "object", description: "Key-value inputs for the ability (e.g. { title: 'green', query: 'shopping' })" },
        },
        required: ["query", "action"],
      },
      provider: "local",
      handler: async (args: { query: string; action: string; params?: Record<string, unknown> }): Promise<ToolResult> => {
        const startTime = Date.now();
        const meta = (ok: boolean) => ({
          toolName: "skills.run",
          provider: "local",
          duration: Date.now() - startTime,
          cached: false,
          timestamp: Date.now(),
          callId: `local-${Date.now()}`,
        });
        try {
          type SkillWithAbilities = { name: string; description: string; abilities: { name: string; description?: string; input: string[] }[] };
          type AiChoice = { skillName: string; ability: string; params: Record<string, unknown> };

          let catalog: SkillWithAbilities[] = [];
          let aiChoice: AiChoice | null = null;
          try {
            catalog = (await api.plugins.call("skills", "list_skills_with_abilities", { limit: 50 })) as SkillWithAbilities[];
          } catch {
            // ignore
          }

          // Guard against misrouted calls: when the request is clearly a built-in tool
          // operation ("show contents of X", "read the file Y", "list files in Z") rather
          // than a skill invocation, return a hint naming the right local.* tool instead
          // of asking the AI to pick a skill — small models on Telegram were picking
          // skills.run for these (see 2026-09-17 failures), then the AI selection came
          // back empty because no installed skill actually matches "show me a file".
          const ql = (args.query ?? "").toLowerCase().trim();
          const al = (args.action ?? "").toLowerCase().trim();
          const combined = `${ql} ${al}`;
          const looksLikeFileRequest =
            /\b(show|read|open|view|get|cat|print|contents? of)\b.*\b(file|\.md|\.txt|\.json|\.yaml|\.yml)\b/.test(combined) ||
            /\blist files? in\b/.test(combined) ||
            /\bfind (the |a )?file\b/.test(combined) ||
            /\b(show|read|view|open) me\b/.test(combined);
          if (looksLikeFileRequest) {
            return {
              success: false,
              data: null,
              error: `This looks like a built-in tool request, not a skill. Call local.file.read({ path: "<absolute path>" }) directly — skills.run is for invoking installed AgentSkills, not for arbitrary file reads. If you don't know the absolute path, call local.memory.search("<filename>") first to find it.`,
              metadata: meta(false),
            };
          }

          if (catalog.length > 0 && api.ai) {
            const catalogText = JSON.stringify(
              catalog.map((s) => ({ name: s.name, description: s.description, abilities: s.abilities.map((a) => ({ name: a.name, input: a.input })) }))
            );
            const prompt = `You are selecting which AgentSkill to run. Request: query="${args.query}", action="${args.action}".${args.params && Object.keys(args.params).length ? ` Caller params: ${JSON.stringify(args.params)}.` : ""}

Skills available (name, description, abilities with name and input params):
${catalogText}

If the request is a built-in operation (reading/showing a file, listing files, running a shell command, querying the database, searching memory) and NOT something any skill in the catalog does, return exactly: {"skillName": null, "ability": null, "params": {}}.

Otherwise respond with JSON only, no other text: { "skillName": "<exact name from list>", "ability": "<exact ability name>", "params": {} }. Extract params from the request (e.g. location, title, query, limit, path, content, input) where they match ability inputs. Use the exact skill name and ability name from the list.`;
            try {
              const response = await api.ai.complete(prompt, { maxTokens: 512, temperature: 0 });
              const raw = typeof response === "string" ? response : (response as { content?: string })?.content ?? "";
              const trimmed = raw.replace(/^[\s\S]*?```(?:json)?\s*/i, "").replace(/\s*```[\s\S]*$/i, "").trim();
              if (!trimmed) {
                console.warn("[skills.run] AI selection returned empty response");
              } else {
                let parsed: AiChoice | null = null;
                try {
                  parsed = JSON.parse(trimmed) as AiChoice;
                } catch {
                  console.warn("[skills.run] AI selection JSON parse failed (invalid or truncated)");
                }
                if (parsed?.skillName && parsed?.ability) {
                  const skill = catalog.find((s) => s.name === parsed.skillName);
                  const abilityValid = skill?.abilities.some((a) => a.name === parsed.ability);
                  if (skill && abilityValid) {
                    aiChoice = { skillName: parsed.skillName, ability: parsed.ability, params: parsed.params ?? {} };
                  }
                }
              }
            } catch (err) {
              console.warn("[skills.run] AI selection failed:", err instanceof Error ? err.message : err);
            }
          }

          let skillName: string;
          let explored: { abilities: { name: string; description?: string; input: string[] }[] } | null = null;
          let abilities: { name: string; description?: string; input: string[] }[];
          // Undefined only transiently: the aiChoice branch below returns early when this
          // stays unset; the fallback branch always assigns a defined value (see its own
          // guard). By the time `picked` is read after the if/else, it's always defined.
          let picked: { name: string; description?: string; input: string[] } | undefined;
          let abilityParams: Record<string, unknown>;

          if (aiChoice) {
            skillName = aiChoice.skillName;
            console.log("[skills.run] AI selected skill: %s, ability: %s", skillName, aiChoice.ability);
            try {
              explored = await (api.plugins.call("skills", "explore_skill", skillName, false) as Promise<{
                abilities: { name: string; description?: string; input: string[] }[];
              }>);
            } catch (e) {
              console.warn("[skills.run] explore_skill failed after AI select:", e);
              explored = { abilities: [] };
            }
            abilities = explored?.abilities ?? [];
            picked = abilities.find((a) => a.name === aiChoice!.ability) ?? abilities[0];
            if (!picked) {
              // Doc-as-ability skill (e.g. kepano's obsidian-cli): no structured `## Abilities`
              // section, the whole skill is documentation that the AI reads and acts on with
              // local.shell.safe. Return the skill body so the call still succeeds and the AI
              // has the operating instructions it needs to construct the actual shell command.
              // See plugins/skills.ts:resolveSkillDir and explore_skill for the full instructions.
              const instructions = (explored as { instructions?: string } | null)?.instructions ?? "";
              return {
                success: true,
                data: {
                  skillName,
                  hint: `Skill "${skillName}" has no structured abilities — it is documentation. Read the instructions and execute the requested action directly with local.shell.safe or the relevant local.* tool.`,
                  instructions,
                  noAbilities: true,
                },
                metadata: meta(true),
              };
            }
            abilityParams = { ...aiChoice.params, ...(args.params ?? {}) };
          } else {
            // Fallback: discover by query, keyword ability, regex params
            let skills: { name: string; description: string }[] = [];
            try {
              skills = (await api.plugins.call("skills", "discover_skills", args.query)) as { name: string; description: string }[];
            } catch (discoverErr) {
              console.warn("[skills.run] discover_skills threw:", discoverErr);
            }

            if (!skills.length) {
              const { readdirSync, existsSync: fsExists, readFileSync } = require("fs");
              const { join } = require("path");
              const { homedir } = require("os");
              const system = api.config.getSystem();
              const userDir = (system as any).skillsDir ?? join(homedir(), ".ronin", "skills");
              const projDir = join(process.cwd(), "skills");
              const q = args.query.toLowerCase();
              for (const dir of [userDir, projDir].filter((d) => fsExists(d))) {
                try {
                  for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    if (!entry.isDirectory()) continue;
                    const mdPath = fsExists(join(dir, entry.name, "skill.md")) ? join(dir, entry.name, "skill.md") : fsExists(join(dir, entry.name, "SKILL.md")) ? join(dir, entry.name, "SKILL.md") : null;
                    if (!mdPath) continue;
                    const content = readFileSync(mdPath, "utf-8");
                    const nameMatch = content.match(/name:\s*(.+)/);
                    const descMatch = content.match(/description:\s*(.+)/);
                    const sName = (nameMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
                    const sDesc = (descMatch?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
                    if (sName.toLowerCase().includes(q) || sDesc.toLowerCase().includes(q) || entry.name.includes(q.replace(/\s+/g, "-"))) {
                      skills.push({ name: sName || entry.name, description: sDesc });
                    }
                  }
                } catch {
                  // ignore
                }
              }
            }

            if (!skills.length) {
              return { success: false, data: null, error: `No skills found for "${args.query}"`, metadata: meta(false) };
            }

            skillName = skills[0]!.name; // length check above guarantees index 0 exists

            try {
              explored = await (api.plugins.call("skills", "explore_skill", skillName, false) as Promise<{
                abilities: { name: string; description?: string; input: string[] }[];
              }>);
            } catch (e) {
              console.log("[skills.run] explore_skill failed:", e);
              explored = { abilities: [] };
            }
            abilities = explored?.abilities ?? [];
            if (!abilities.length) {
              // Same doc-as-ability fallback as the AI-select branch above — return the skill
              // body so the AI can read the instructions and execute the action itself.
              const instructions = (explored as { instructions?: string } | null)?.instructions ?? "";
              return {
                success: true,
                data: {
                  skillName,
                  hint: `Skill "${skillName}" has no structured abilities — it is documentation. Read the instructions and execute the requested action directly with local.shell.safe or the relevant local.* tool.`,
                  instructions,
                  noAbilities: true,
                },
                metadata: meta(true),
              };
            }

            const actionLower = args.action.toLowerCase();
            let fallbackPicked = abilities.find((a) => actionLower.includes(a.name.toLowerCase()));
            if (!fallbackPicked) {
              const keywords: Record<string, string[]> = {
                current: ["current", "now", "right now", "today", "weather", "temperature", "temp", "outside"],
                forecast: ["forecast", "week", "days", "tomorrow", "upcoming", "outlook"],
                list: ["list", "show", "all", "recent", "last", "subject", "incoming", "latest", "recent"],
                "list-inboxes": ["inboxes", "mailboxes", "folders", "accounts"],
                search: ["search", "find", "look", "query"],
                read: ["read", "get", "open", "view", "content", "body"],
                write: ["write", "update", "edit", "change", "modify"],
                create: ["create", "new", "add", "make"],
              };
              for (const ability of abilities) {
                const kws = keywords[ability.name.toLowerCase()] ?? [ability.name.toLowerCase()];
                if (kws.some((kw) => actionLower.includes(kw))) {
                  fallbackPicked = ability;
                  break;
                }
              }
            }
            picked = fallbackPicked ?? abilities[0]!; // length check above guarantees index 0 exists
            abilityParams = { ...(args.params ?? {}) };
          }

          const actionText = `${args.action}`.trim();

          // When ability has "input" (e.g. mermaid-diagram-generator), use full action as input if missing or generic so diagram+URL match
          if (picked.input?.includes("input")) {
            const current = String(abilityParams.input ?? "").trim();
            const generic = !current || /^(flowchart|sequence|simple flowchart|default)$/i.test(current);
            if (generic && actionText.length > 10) {
              abilityParams.input = actionText;
            }
          }

          if (picked.input?.includes("query") && abilityParams.query == null) {
            const m = actionText.match(/(?:search|find|look\s*up|query)\s+(?:for\s+)?["']?([^"']+)["']?\s*$/i);
            if (m) abilityParams.query = m[1]!.trim(); // capture group is mandatory in the regex
          }

          // Extract location for weather-type abilities
          if (picked.input?.includes("location") && abilityParams.location == null) {
            const locPatterns = [
              /(?:weather|forecast|temperature|temp)\s+(?:in|for|at)\s+["']?(.+?)["']?\s*$/i,
              /(?:in|for|at)\s+["']?(.+?)["']?\s*(?:weather|forecast|temperature|temp)/i,
              /(?:in|for|at)\s+["']?(.+?)["']?\s*$/i,
            ];
            for (const re of locPatterns) {
              const m = actionText.match(re);
              if (m?.[1]) {
                abilityParams.location = m[1].trim();
                break;
              }
            }
          }

          // When ability has "limit" and user wants last/first one (e.g. "subject of last email"), set limit to 1
          if ((picked.input?.includes("limit") || picked.name === "list") && abilityParams.limit == null) {
            if (/\b(last|first|latest|most recent|newest)\s+(incoming\s+)?(email|message)\b/i.test(actionText) ||
                /\b(subject of my last)\b/i.test(actionText)) {
              abilityParams.limit = 1;
            }
          }

          if (picked.input?.includes("title") && abilityParams.title == null) {
            const patterns = [
              /(?:called|titled|named)\s+["']?([^\s"']+)["']?(?:\s|$)/i,
              /(?:note\s+)?(?:called|titled|named|title)\s+["']?([^"']+)["']?\s*$/i,
              /(?:find|get|read)\s+(?:the\s+)?note\s+["']?([^"']+)["']?\s*$/i,
              /note\s+["']?([^"']+)["']?\s*$/i,
            ];
            for (const re of patterns) {
              const m = actionText.match(re);
              if (m?.[1]) {
                abilityParams.title = m[1].trim();
                break;
              }
            }
          }

          // When ability supports "index" (e.g. Mail read) and user said last/first/most recent, use index 1
          const inputStr = (Array.isArray(picked.input) ? picked.input.join(" ") : String(picked.input ?? "")).toLowerCase();
          if (inputStr.includes("index") && abilityParams.index == null) {
            if (/\b(last|first|latest|most recent|newest)\b/i.test(actionText)) {
              abilityParams.index = 1;
            }
          }

          // Only require note title/id for read when this ability has no "index" (e.g. Notes read, not Mail read)
          const readRequiresNoteId = picked.name.toLowerCase() === "read" && !inputStr.includes("index");
          if (readRequiresNoteId && abilityParams.id == null && abilityParams.title == null) {
            return {
              success: false,
              data: null,
              error: "Read ability needs a note title or id. Pass params.title (e.g. the note name) or ensure the action includes it (e.g. 'read note called green').",
              metadata: meta(false),
            };
          }

          const result = await api.skills!.use_skill(skillName, {
            ability: picked.name,
            params: abilityParams,
          });

          return {
            success: result.success,
            data: { skill: skillName, ability: picked.name, params: abilityParams, ...result },
            error: result.error,
            metadata: meta(result.success),
          };
        } catch (error) {
          return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : "Skill run failed",
            metadata: meta(false),
          };
        }
      },
      cacheable: false,
      riskLevel: "low",
    });
  }

  // 8c. Discord tools (traverse guilds/channels/DMs, read, send) – when Discord plugin and config enabled
  if (api.discord) {
    const getDiscordClientId = async (): Promise<string> => {
      const dc = api.config.getDiscord();
      if (!dc.enabled || !dc.botToken) {
        throw new Error("Discord is not configured. Set discord.enabled and discord.botToken (or DISCORD_BOT_TOKEN).");
      }
      return api.discord!.initBot(dc.botToken);
    };

    const discordMeta = (ok: boolean, toolName: string) => ({
      toolName,
      provider: "local",
      duration: 0,
      cached: false,
      timestamp: Date.now(),
      callId: `local-${Date.now()}`,
    });

    register({
      name: "local.discord.listGuilds",
      description: "List Discord guilds (servers) the bot is in. Use to traverse the user's Discord account.",
      parameters: { type: "object", properties: {}, required: [] },
      provider: "local",
      handler: async (): Promise<ToolResult> => {
        const start = Date.now();
        try {
          const clientId = await getDiscordClientId();
          const guilds = await api.discord!.listGuilds(clientId);
          return {
            success: true,
            data: { guilds },
            metadata: { ...discordMeta(true, "local.discord.listGuilds"), duration: Date.now() - start },
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "listGuilds failed",
            metadata: { ...discordMeta(false, "local.discord.listGuilds"), duration: Date.now() - start },
          };
        }
      },
      cacheable: false,
      riskLevel: "low",
    });

    register({
      name: "local.discord.listChannels",
      description: "List channels in a Discord guild (server). Requires guildId from listGuilds.",
      parameters: {
        type: "object",
        properties: { guildId: { type: "string", description: "Guild (server) ID" } },
        required: ["guildId"],
      },
      provider: "local",
      handler: async (args: { guildId: string }): Promise<ToolResult> => {
        const start = Date.now();
        try {
          const clientId = await getDiscordClientId();
          const channels = await api.discord!.listChannels(clientId, args.guildId);
          return {
            success: true,
            data: { channels },
            metadata: { ...discordMeta(true, "local.discord.listChannels"), duration: Date.now() - start },
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "listChannels failed",
            metadata: { ...discordMeta(false, "local.discord.listChannels"), duration: Date.now() - start },
          };
        }
      },
      cacheable: false,
      riskLevel: "low",
    });

    register({
      name: "local.discord.listDMs",
      description: "List DM channels the bot has. May be empty until DMs are opened. Use for private chat context.",
      parameters: { type: "object", properties: {}, required: [] },
      provider: "local",
      handler: async (): Promise<ToolResult> => {
        const start = Date.now();
        try {
          const clientId = await getDiscordClientId();
          const dms = await api.discord!.listDMChannels(clientId);
          return {
            success: true,
            data: { dms },
            metadata: { ...discordMeta(true, "local.discord.listDMs"), duration: Date.now() - start },
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "listDMs failed",
            metadata: { ...discordMeta(false, "local.discord.listDMs"), duration: Date.now() - start },
          };
        }
      },
      cacheable: false,
      riskLevel: "low",
    });

    register({
      name: "local.discord.getMessages",
      description: "Get recent messages from a Discord channel (guild or DM). Use channelId from listChannels or listDMs.",
      parameters: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Channel ID" },
          limit: { type: "number", description: "Max messages to fetch (default 10)" },
          before: { type: "string", description: "Message ID to fetch before (for pagination)" },
        },
        required: ["channelId"],
      },
      provider: "local",
      handler: async (args: { channelId: string; limit?: number; before?: string }): Promise<ToolResult> => {
        const start = Date.now();
        try {
          const clientId = await getDiscordClientId();
          const messages = await api.discord!.getMessages(clientId, args.channelId, {
            limit: args.limit ?? 10,
            before: args.before,
          });
          return {
            success: true,
            data: { messages },
            metadata: { ...discordMeta(true, "local.discord.getMessages"), duration: Date.now() - start },
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "getMessages failed",
            metadata: { ...discordMeta(false, "local.discord.getMessages"), duration: Date.now() - start },
          };
        }
      },
      cacheable: false,
      riskLevel: "low",
    });

    register({
      name: "local.discord.sendMessage",
      description: "Send a message to a Discord channel (guild or DM). Use channelId from listChannels or listDMs.",
      parameters: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Channel ID" },
          content: { type: "string", description: "Message text" },
        },
        required: ["channelId", "content"],
      },
      provider: "local",
      handler: async (args: { channelId: string; content: string }): Promise<ToolResult> => {
        const start = Date.now();
        try {
          const clientId = await getDiscordClientId();
          await api.discord!.sendMessage(clientId, args.channelId, args.content);
          return {
            success: true,
            data: { ok: true },
            metadata: { ...discordMeta(true, "local.discord.sendMessage"), duration: Date.now() - start },
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "sendMessage failed",
            metadata: { ...discordMeta(false, "local.discord.sendMessage"), duration: Date.now() - start },
          };
        }
      },
      cacheable: false,
      riskLevel: "low",
    });

    register({
      name: "local.discord.getChannel",
      description: "Get info for a Discord channel (id, name, type, guildId). Use channelId from listChannels or listDMs.",
      parameters: {
        type: "object",
        properties: { channelId: { type: "string", description: "Channel ID" } },
        required: ["channelId"],
      },
      provider: "local",
      handler: async (args: { channelId: string }): Promise<ToolResult> => {
        const start = Date.now();
        try {
          const clientId = await getDiscordClientId();
          const channel = await api.discord!.getChannel(clientId, args.channelId);
          return {
            success: true,
            data: { channel },
            metadata: { ...discordMeta(true, "local.discord.getChannel"), duration: Date.now() - start },
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "getChannel failed",
            metadata: { ...discordMeta(false, "local.discord.getChannel"), duration: Date.now() - start },
          };
        }
      },
      cacheable: false,
      riskLevel: "low",
    });

    register({
      name: "local.discord.getBotInfo",
      description: "Get the connected Discord bot's own identity (id, username). Useful to confirm the bot is live.",
      parameters: { type: "object", properties: {}, required: [] },
      provider: "local",
      handler: async (): Promise<ToolResult> => {
        const start = Date.now();
        try {
          const clientId = await getDiscordClientId();
          const bot = await api.discord!.getBotInfo(clientId);
          return {
            success: true,
            data: { bot },
            metadata: { ...discordMeta(true, "local.discord.getBotInfo"), duration: Date.now() - start },
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "getBotInfo failed",
            metadata: { ...discordMeta(false, "local.discord.getBotInfo"), duration: Date.now() - start },
          };
        }
      },
      cacheable: false,
      riskLevel: "low",
    });
  }

  // 8d. Telegram tools (send, read updates, bot identity) – when Telegram plugin and config enabled.
  // Mirrors the Discord block above: auto-initializes from config so the model never needs
  // to see or manage a botId/token itself.
  if (api.telegram) {
    const getTelegramBotId = async (): Promise<string> => {
      const tc = api.config.getTelegram();
      if (!tc.botToken) {
        throw new Error("Telegram is not configured. Set telegram.botToken (or TELEGRAM_BOT_TOKEN).");
      }
      return api.telegram!.initBot(tc.botToken);
    };

    const telegramMeta = (toolName: string) => ({
      toolName,
      provider: "local",
      duration: 0,
      cached: false,
      timestamp: Date.now(),
      callId: `local-${Date.now()}`,
    });

    register({
      name: "local.telegram.sendMessage",
      description: "Send a message to a Telegram chat. Omit chatId to use the configured default chat.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "Message text" },
          chatId: { type: "string", description: "Chat ID (defaults to the configured telegram.chatId)" },
        },
        required: ["content"],
      },
      provider: "local",
      handler: async (args: { content: string; chatId?: string }): Promise<ToolResult> => {
        const start = Date.now();
        try {
          const botId = await getTelegramBotId();
          // Treat empty/whitespace chatId as missing so the configured default is used.
          const explicitChatId = args.chatId?.trim();
          const chatId = explicitChatId || api.config.getTelegram().chatId;
          if (process.env.RONIN_VERBOSE_TOOLS) {
            console.log(
              `[local.telegram.sendMessage] explicitChatIdPresent=${!!explicitChatId} resolvedChatId=${JSON.stringify(chatId)}`
            );
          }
          if (!chatId) throw new Error("Missing chatId and no default telegram.chatId configured.");
          await api.telegram!.sendMessage(botId, chatId, args.content);
          return {
            success: true,
            data: { ok: true },
            metadata: { ...telegramMeta("local.telegram.sendMessage"), duration: Date.now() - start },
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "sendMessage failed",
            metadata: { ...telegramMeta("local.telegram.sendMessage"), duration: Date.now() - start },
          };
        }
      },
      cacheable: false,
      riskLevel: "low",
    });

    register({
      name: "local.telegram.getBotInfo",
      description: "Get the connected Telegram bot's own identity. Useful to confirm the bot is live.",
      parameters: { type: "object", properties: {}, required: [] },
      provider: "local",
      handler: async (): Promise<ToolResult> => {
        const start = Date.now();
        try {
          const botId = await getTelegramBotId();
          const bot = await api.telegram!.getBotInfo(botId);
          return {
            success: true,
            data: { bot },
            metadata: { ...telegramMeta("local.telegram.getBotInfo"), duration: Date.now() - start },
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "getBotInfo failed",
            metadata: { ...telegramMeta("local.telegram.getBotInfo"), duration: Date.now() - start },
          };
        }
      },
      cacheable: false,
      riskLevel: "low",
    });
  }

  // 9. Speech Listen Tool (uses STT plugin)
  register({
    name: "local.speech.listen",
    description: "Record audio from the microphone and transcribe to text. Use this to listen to the user speaking.",
    parameters: {
      type: "object",
      properties: {
        duration: { type: "number", description: "Recording duration in seconds (default: 5)" },
        language: { type: "string", description: "Language code (e.g. 'en')" },
      },
      required: [],
    },
    provider: "local",
    handler: async (args: { duration?: number; language?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        if (api.plugins.has("stt")) {
          const result = await api.plugins.call("stt", "recordAndTranscribe", args.duration || 5, { language: args.language }) as { text: string; audioPath: string };
          return {
            success: true,
            data: { text: result.text, audioPath: result.audioPath },
            metadata: {
              toolName: "local.speech.listen",
              provider: "local",
              duration: Date.now() - startTime,
              cached: false,
              timestamp: Date.now(),
              callId: `local-${Date.now()}`,
            },
          };
        }
        throw new Error("STT plugin not loaded. Enable the stt plugin for speech recognition.");
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Speech recognition failed",
          metadata: {
            toolName: "local.speech.listen",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: false,
    riskLevel: "low",
  });

  // 10. Notification Tool
  register({
    name: "local.notify",
    description: "Show a desktop notification to the user. Use this to alert the user about task status, errors, or important information.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Notification title" },
        message: { type: "string", description: "Notification body text" },
        subtitle: { type: "string", description: "Optional subtitle" },
        sound: { type: "boolean", description: "Play notification sound (default: true)" },
      },
      required: ["title", "message"],
    },
    provider: "local",
    handler: async (args: { title: string; message: string; subtitle?: string; sound?: boolean }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        if (process.platform === "darwin") {
          const { exec } = require("child_process");
          const { promisify } = require("util");
          const execAsync = promisify(exec);
          const escTitle = args.title.replace(/"/g, '\\"');
          const escMsg = args.message.replace(/"/g, '\\"');
          let script = `display notification "${escMsg}" with title "${escTitle}"`;
          if (args.subtitle) {
            script += ` subtitle "${args.subtitle.replace(/"/g, '\\"')}"`;
          }
          if (args.sound !== false) {
            script += ` sound name "default"`;
          }
          await execAsync(`osascript -e '${script}'`);
        } else {
          // Linux fallback via notify-send
          const { exec } = require("child_process");
          const { promisify } = require("util");
          const execAsync = promisify(exec);
          await execAsync(`notify-send "${args.title}" "${args.message}"`);
        }
        return {
          success: true,
          data: { notified: true, title: args.title },
          metadata: {
            toolName: "local.notify",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Notification failed",
          metadata: {
            toolName: "local.notify",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: false,
    riskLevel: "low",
  });

  // 11. Notification Ask Tool (interactive dialog with choices)
  register({
    name: "local.notify.ask",
    description:
      "Show an interactive notification dialog asking the user a question with choices. " +
      "Returns the user's selected answer. Use this when you need user input to proceed, " +
      "e.g. 'Unable to complete task. Would you like me to create these skills?' " +
      "If the dialog times out (default 30s), a pending task is created and the question is sent to your preferred chat (Telegram/Discord).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Dialog title" },
        message: { type: "string", description: "Question or message to display" },
        buttons: {
          type: "array",
          description: 'Button labels for choices (max 3). E.g. ["Yes", "No", "Skip"]',
          items: { type: "string" },
        },
        defaultButton: { type: "string", description: "Which button is the default (pressed on Enter)" },
        icon: { type: "string", description: "Icon type: 'note', 'caution', or 'stop'" },
        timeout: { type: "number", description: "Seconds before dialog times out (default from config, usually 30)" },
      },
      required: ["title", "message", "buttons"],
    },
    provider: "local",
    handler: async (args: {
      title: string;
      message: string;
      buttons: string[];
      defaultButton?: string;
      icon?: string;
      timeout?: number;
    }): Promise<ToolResult> => {
      const startTime = Date.now();
      const buttons = (args.buttons || ["OK", "Cancel"]).slice(0, 3);
      const timeoutSeconds =
        args.timeout ??
        api.config.getNotifications?.()?.timeoutSeconds ??
        30;

      try {
        const buttonsStr = buttons.map((b: string) => `"${b.replace(/"/g, '\\"')}"`).join(", ");
        const escTitle = args.title.replace(/"/g, '\\"');
        const escMsg = args.message.replace(/"/g, '\\"');
        let defaultClause = "";
        if (args.defaultButton) {
          defaultClause = ` default button "${args.defaultButton.replace(/"/g, '\\"')}"`;
        }
        let iconClause = "";
        if (args.icon && ["note", "caution", "stop"].includes(args.icon)) {
          iconClause = ` with icon ${args.icon}`;
        }

        if (process.platform === "darwin") {
          const { exec } = require("child_process");
          const { promisify } = require("util");
          const execAsync = promisify(exec);
          const script = `display dialog "${escMsg}" with title "${escTitle}" buttons {${buttonsStr}}${defaultClause}${iconClause} giving up after ${timeoutSeconds}`;
          const { stdout } = await execAsync(`osascript -e '${script}'`);
          const out = (stdout as string) || "";
          // Timeout: AppleScript returns "gave up:true"
          if (out.includes("gave up:true")) {
            const taskId = crypto.randomUUID();
            api.events.emit(
              "PendingResponse",
              {
                taskId,
                title: args.title,
                message: args.message,
                buttons,
                source: "notify.ask",
              },
              "local.notify.ask"
            );
            const sentToChat = await sendToChatChannel(
              api,
              args.title,
              args.message,
              buttons,
              taskId
            );
            return {
              success: true,
              data: {
                answer: null,
                timedOut: true,
                taskId,
                sentToChat,
              },
              metadata: {
                toolName: "local.notify.ask",
                provider: "local",
                duration: Date.now() - startTime,
                cached: false,
                timestamp: Date.now(),
                callId: `local-${Date.now()}`,
              },
            };
          }
          // Parse "button returned:Yes" format
          const match = out.match(/button returned:(.+)/);
          const chosen = match ? match[1]!.trim() : buttons[0]; // capture group is mandatory in the regex
          return {
            success: true,
            data: { answer: chosen, buttons, title: args.title },
            metadata: {
              toolName: "local.notify.ask",
              provider: "local",
              duration: Date.now() - startTime,
              cached: false,
              timestamp: Date.now(),
              callId: `local-${Date.now()}`,
            },
          };
        }

        // Non-macOS: emit event and wait for response via event system
        const requestId = `ask-${Date.now()}`;
        api.events.emit(
          "notify.ask",
          {
            requestId,
            title: args.title,
            message: args.message,
            buttons,
          },
          "local.notify.ask"
        );

        return {
          success: true,
          data: {
            answer: buttons[0],
            note: "Non-macOS: dialog emitted as notify.ask event. Default answer used.",
            buttons,
          },
          metadata: {
            toolName: "local.notify.ask",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        // User cancelled dialog (exit code 1)
        if (errMsg.includes("User canceled") || errMsg.includes("(-128)")) {
          return {
            success: true,
            data: { answer: null, cancelled: true, title: args.title },
            metadata: {
              toolName: "local.notify.ask",
              provider: "local",
              duration: Date.now() - startTime,
              cached: false,
              timestamp: Date.now(),
              callId: `local-${Date.now()}`,
            },
          };
        }
        return {
          success: false,
          data: null,
          error: errMsg,
          metadata: {
            toolName: "local.notify.ask",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: false,
    riskLevel: "low",
  });

  if (!process.env.RONIN_QUIET) console.log("[LocalTools] Registered 11 local tools");
}
