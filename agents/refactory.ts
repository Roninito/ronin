/**
 * Refactory Agent — SAR-compliant refactoring. Listens for refactor-request,
 * creates/updates tasks via todo events, runs a SAR Chain with refactory tools,
 * tests when feasible, and notifies via Telegram.
 */

import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import type { ToolDefinition, ToolResult, ToolContext } from "../src/tools/types.js";
import {
  createOntologyResolveMiddleware,
  createOntologyInjectMiddleware,
  createSmartTrimMiddleware,
  createTokenGuardMiddleware,
  createAiToolMiddleware,
} from "../src/middleware/index.js";
import { Chain } from "../src/chain/Chain.js";
import { MiddlewareStack } from "../src/middleware/MiddlewareStack.js";
import type { ChainContext } from "../src/chain/types.js";
import { join } from "path";
import { homedir } from "os";

interface RefactorRequestPayload {
  target: string;
  description: string;
  planId?: string;
  source?: string;
  sourceChannel?: string;
  sourceUser?: string;
  telegramChatId?: string | number;
}

const REFACTOR_ONTOLOGY_SKILLS = [
  "refactory.read_file",
  "refactory.write_file",
  "refactory.run_cli",
  "local.file.read",
  "local.file.list",
  "local.memory.search",
  "local.events.emit",
];

function createRefactoryTools(api: AgentAPI): ToolDefinition[] {
  const baseMeta = (name: string, duration: number) => ({
    toolName: name,
    provider: "refactory",
    duration,
    cached: false,
    timestamp: Date.now(),
    callId: `refactory-${Date.now()}`,
  });

  return [
    {
      name: "refactory.read_file",
      description: "Read a file from the filesystem. Use for reading agent or source files to refactor.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (e.g. agents/my-agent.ts)" },
        },
        required: ["path"],
      },
      provider: "refactory",
      handler: async (args: { path: string }, ctx: ToolContext): Promise<ToolResult> => {
        const start = Date.now();
        try {
          const content = await api.files.read(args.path);
          return {
            success: true,
            data: { content, path: args.path },
            metadata: baseMeta("refactory.read_file", Date.now() - start),
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "Read failed",
            metadata: baseMeta("refactory.read_file", Date.now() - start),
          };
        }
      },
      riskLevel: "low",
      cacheable: false,
    },
    {
      name: "refactory.write_file",
      description: "Write content to a file. Use to save refactored agent or source code.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "Full file content to write" },
        },
        required: ["path", "content"],
      },
      provider: "refactory",
      handler: async (args: { path: string; content: string }, ctx: ToolContext): Promise<ToolResult> => {
        const start = Date.now();
        try {
          await api.files.write(args.path, args.content);
          return {
            success: true,
            data: { path: args.path },
            metadata: baseMeta("refactory.write_file", Date.now() - start),
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "Write failed",
            metadata: baseMeta("refactory.write_file", Date.now() - start),
          };
        }
      },
      riskLevel: "medium",
      cacheable: false,
    },
    {
      name: "refactory.run_cli",
      description: "Run a code-generation CLI (e.g. qwen-cli) with a prompt. Use for generating or modifying code. workspace defaults to .ronin/agents.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Instruction for the CLI" },
          workspace: { type: "string", description: "Workspace path (optional)" },
          cli: { type: "string", description: "CLI name: qwen, cursor, opencode, gemini (optional)" },
        },
        required: ["prompt"],
      },
      provider: "refactory",
      handler: async (
        args: { prompt: string; workspace?: string; cli?: string },
        ctx: ToolContext
      ): Promise<ToolResult> => {
        const start = Date.now();
        const cliName = args.cli || "qwen";
        const pluginName = `${cliName}-cli`;
        if (!api.plugins.has(pluginName)) {
          return {
            success: false,
            data: null,
            error: `CLI plugin not found: ${pluginName}`,
            metadata: baseMeta("refactory.run_cli", Date.now() - start),
          };
        }
        const workspace =
          args.workspace || join(homedir(), ".ronin", "agents");
        try {
          const result = (await api.plugins.call(pluginName, "execute", args.prompt, {
            workspace,
          })) as { success: boolean; output?: string; error?: string };
          return {
            success: result?.success ?? false,
            data: { output: result?.output, error: result?.error },
            metadata: baseMeta("refactory.run_cli", Date.now() - start),
          };
        } catch (err) {
          return {
            success: false,
            data: null,
            error: err instanceof Error ? err.message : "CLI execution failed",
            metadata: baseMeta("refactory.run_cli", Date.now() - start),
          };
        }
      },
      riskLevel: "medium",
      cacheable: false,
    },
  ];
}

export default class RefactoryAgent extends BaseAgent {
  private guidelinesCache: string | null = null;
  private isProcessing = false;

  constructor(api: AgentAPI) {
    super(api);
    this.registerRefactoryTools();
    this.registerEventHandlers();
    console.log("[refactory] Ready. Listening for refactor-request.");
  }

  private registerRefactoryTools(): void {
    for (const tool of createRefactoryTools(this.api)) {
      this.api.tools.register(tool);
    }
  }

  private registerEventHandlers(): void {
    this.api.events.on("refactor-request", (data: unknown) => {
      const payload = data as RefactorRequestPayload;
      this.handleRefactorRequest(payload).catch((err) => {
        console.error("[refactory] handleRefactorRequest error:", err);
      });
    });
  }

  private async getGuidelines(): Promise<string> {
    if (this.guidelinesCache) return this.guidelinesCache;
    try {
      const content = await this.api.files.read("docs/ronin-coding-guidelines.md");
      this.guidelinesCache = content;
      return content;
    } catch {
      return "Follow Ronin agent patterns and SAR (Chain, Executor, middleware). Use tasks: emit PlanProposed, TaskAppendDescription, PlanCompleted/PlanFailed.";
    }
  }

  private async appendToTask(planId: string, content: string): Promise<void> {
    this.api.events.emit(
      "TaskAppendDescription",
      { planId, content, timestamp: Date.now() },
      "refactory"
    );
  }

  private emitTelegramMessage(text: string, chatId?: string | number): void {
    this.api.events.emit(
      "SendTelegramMessage",
      { text, chatId, source: "refactory" },
      "refactory"
    );
  }

  private async handleRefactorRequest(payload: RefactorRequestPayload): Promise<void> {
    if (this.isProcessing) {
      console.log("[refactory] Already processing a request, skipping.");
      return;
    }
    const planId = payload.planId || `refactor-${Date.now()}`;
    const target = payload.target || "unknown";
    const description = payload.description || "Refactor per guidelines";

    this.isProcessing = true;
    try {
      if (!payload.planId) {
        this.api.events.emit(
          "PlanProposed",
          {
            id: planId,
            title: `Refactor: ${target}`,
            description,
            tags: ["refactor"],
            source: "refactory",
            sourceChannel: payload.sourceChannel,
            sourceUser: payload.sourceUser,
            proposedAt: Date.now(),
          },
          "refactory"
        );
      }

      await this.appendToTask(
        planId,
        `\n[REFACTORY] Started refactor for ${target}\nDescription: ${description}\n`
      );

      this.emitTelegramMessage(
        `🔄 Starting refactor: ${target}\n${description}`,
        payload.telegramChatId ?? undefined
      );

      const guidelines = await this.getGuidelines();
      const systemContent = `${guidelines}\n\nYou are the refactory agent. Refactor the target (agent or file) according to the guidelines. Use the tools to read files, write files, and optionally run the CLI for code generation. Prefer converting agents to use SAR (Chain + middleware). When done, summarize what you changed.`;
      const userContent = `Target: ${target}\nRequest: ${description}`;

      const stack = new MiddlewareStack<ChainContext>();
      stack.use(createOntologyResolveMiddleware({ api: this.api }));
      stack.use(createOntologyInjectMiddleware());
      stack.use(createSmartTrimMiddleware({ recentCount: 12 }));
      stack.use(createTokenGuardMiddleware());
      stack.use(createAiToolMiddleware(this.api));

      const ctx: ChainContext = {
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: userContent },
        ],
        ontology: {
          domain: "refactor",
          relevantSkills: REFACTOR_ONTOLOGY_SKILLS,
        },
        budget: {
          max: 8192,
          current: 0,
          reservedForResponse: 512,
        },
        conversationId: planId,
      };

      this.createChain(); // ensure executor exists
      const chain = new Chain(this.executor!, stack, "refactor");
      chain.withContext(ctx);
      await chain.run();

      const lastAssistant = [...ctx.messages].reverse().find((m) => m.role === "assistant");
      const summary = lastAssistant?.content || "Refactor run completed.";

      await this.appendToTask(planId, `\n[REFACTORY] Chain completed.\nSummary: ${summary}\n`);

      let testNote = "Test skipped (no shell or not an agent name).";
      const agentName = target.replace(/\.ts$/, "").replace(/^agents\//, "");
      if (this.api.shell) {
        try {
          const runResult = await this.api.shell.exec(
            "bun run ronin run " + agentName,
            [],
            { cwd: process.cwd() }
          );
          testNote = runResult.success
            ? `Test run: ✅ exited ${runResult.exitCode}`
            : `Test run: ❌ ${runResult.stderr || runResult.stdout || "error"}`;
        } catch (e) {
          testNote = `Test run: ❌ ${e instanceof Error ? e.message : "error"}`;
        }
      }
      await this.appendToTask(planId, `\n${testNote}\n`);

      this.api.events.emit(
        "PlanCompleted",
        {
          id: planId,
          result: summary,
          completedAt: Date.now(),
          source: payload.source,
          sourceChannel: payload.sourceChannel,
          sourceUser: payload.sourceUser,
          title: `Refactor: ${target}`,
        },
        "refactory"
      );

      this.emitTelegramMessage(
        `✅ Refactor completed for ${target}\n${summary.substring(0, 500)}`,
        payload.telegramChatId ?? undefined
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.appendToTask(planId, `\n[REFACTORY] Error: ${errorMessage}\n`);
      this.api.events.emit(
        "PlanFailed",
        {
          id: planId,
          error: errorMessage,
          failedAt: Date.now(),
          source: payload.source,
          sourceChannel: payload.sourceChannel,
          sourceUser: payload.sourceUser,
          title: `Refactor: ${target}`,
        },
        "refactory"
      );
      this.emitTelegramMessage(
        `❌ Refactor failed for ${target}: ${errorMessage}`,
        payload.telegramChatId ?? undefined
      );
    } finally {
      this.isProcessing = false;
    }
  }

  async execute(): Promise<void> {
    // Event-driven; no scheduled work
  }
}
