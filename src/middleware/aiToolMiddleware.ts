/**
 * AI tool loop middleware: call model → append message → execute tools → append results → loop.
 * Cap at MAX_TOOL_LOOPS; break on same-tool same-args repeat.
 * Optional logLabel: when set, log each iteration and tool call to the terminal.
 */

import type { AgentAPI } from "../types/index.js";
import type { ChainContext, ChainMessage } from "../chain/types.js";
import type { Middleware } from "./MiddlewareStack.js";
import { buildToolPrompt } from "../utils/prompt.js";
import type { OpenAIFunctionSchema } from "../tools/types.js";
import type { Tool } from "../types/api.js";

const MAX_TOOL_LOOPS = 24;
const MAX_LOG_DATA_LEN = 120;

function schemaToTool(s: OpenAIFunctionSchema): Tool {
  return {
    type: "function",
    function: {
      name: s.function.name,
      description: s.function.description,
      parameters: {
        type: "object",
        properties: (s.function.parameters?.properties as Record<string, { type: string; description?: string }>) ?? {},
        required: s.function.parameters?.required,
      },
    },
  };
}

/** Build a single prompt string from ctx.messages for the current callTools API. */
function buildPromptFromMessages(messages: ChainMessage[]): string {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const systemPrompt = systemParts.length ? systemParts.join("\n\n") : "You are a helpful assistant.";
  const rest = messages.filter((m) => m.role !== "system");
  const aiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  const toolResults: Array<{ name: string; success: boolean; result: unknown; error?: string }> = [];
  for (const m of rest) {
    if (m.role === "user" || m.role === "assistant") {
      aiMessages.push({ role: m.role, content: m.content });
    } else if (m.role === "tool") {
      let success = true;
      let result: unknown = m.content;
      let error: string | undefined;
      try {
        const parsed = JSON.parse(m.content);
        if (typeof parsed === "object" && parsed !== null) {
          if ("success" in parsed) success = Boolean(parsed.success);
          if ("data" in parsed) result = parsed.data;
          else if ("result" in parsed) result = parsed.result;
          if ("error" in parsed) error = String(parsed.error);
        }
      } catch {
        // keep result as content
      }
      toolResults.push({ name: m.name ?? "unknown", success, result, error });
    }
  }
  return buildToolPrompt({ systemPrompt, aiMessages, toolResults });
}

export interface AiToolMiddlewareOptions {
  /** When set, log each iteration and tool call to the terminal (e.g. "skill-maker"). */
  logLabel?: string;
}

export function createAiToolMiddleware(
  api: AgentAPI,
  options?: AiToolMiddlewareOptions
): Middleware<ChainContext> {
  const logLabel = options?.logLabel;
  const prefix = logLabel ? `[${logLabel}]` : "";

  function log(msg: string, data?: string): void {
    if (!logLabel) return;
    const line = data ? `${prefix} ${msg} ${data}` : `${prefix} ${msg}`;
    console.log(line);
  }

  return async (ctx, next) => {
    if (!ctx.executor) {
      await next();
      return;
    }
    let iterations = 0;
    let lastToolCall: { name: string; args: string } | null = null;
    let memoryFallbackInjected = false;

    while (iterations < MAX_TOOL_LOOPS) {
      iterations += 1;
      if (logLabel) log(`Iteration ${iterations}/${MAX_TOOL_LOOPS}`);
      const prompt = buildPromptFromMessages(ctx.messages);
      let schemas = ctx.executor.describeTools(
        ctx.ontology?.relevantSkills?.length
          ? { only: ctx.ontology.relevantSkills }
          : undefined
      );
      if (schemas.length === 0) schemas = ctx.executor.describeTools(undefined);
      const tools: Tool[] = schemas.map(schemaToTool);
      if (logLabel) log("Tools available:", `${tools.length} (${tools.map((t) => t.function.name).join(", ")})`);

      const result = await api.ai.callTools(prompt, tools, {
        maxTokens: ctx.budget?.reservedForResponse ?? 512,
        timeoutMs: 120_000,
        ...(ctx.model ? { model: ctx.model } : {}),
      });

      ctx.messages.push({
        role: "assistant",
        content: result.message.content ?? "",
      });

      const toolCalls = result.toolCalls ?? [];
      if (toolCalls.length === 0) {
        if (logLabel) log("No tool calls; stopping.");
        break;
      }

      let sameRepeat = false;
      let lastBatchAllFailed = true;
      let lastBatchHadMemorySearch = false;
      for (const call of toolCalls) {
        const argsStr = JSON.stringify(call.arguments ?? {});
        const argsPreview =
          argsStr.length > MAX_LOG_DATA_LEN
            ? argsStr.slice(0, MAX_LOG_DATA_LEN) + "..."
            : argsStr;
        if (logLabel) log("Tool call:", `${call.name} ${argsPreview}`);
        if (lastToolCall?.name === call.name && lastToolCall?.args === argsStr) {
          sameRepeat = true;
          if (logLabel) log("Same tool+args as last time; stopping.");
          break;
        }
        lastToolCall = { name: call.name, args: argsStr };
        if (call.name === "local.memory.search") lastBatchHadMemorySearch = true;

        const execResult = await ctx.executor!.execute(
          call.name,
          (call.arguments ?? {}) as Record<string, unknown>,
          ctx
        );
        if (execResult.success) lastBatchAllFailed = false;
        const rawResult =
          execResult.success && execResult.data != null
            ? JSON.stringify(execResult.data)
            : execResult.success
              ? "ok"
              : (execResult.error ?? "fail");
        const resultPreview =
          rawResult.length > MAX_LOG_DATA_LEN
            ? rawResult.slice(0, MAX_LOG_DATA_LEN) + "..."
            : rawResult;
        if (logLabel) log("Tool result:", `${call.name} → ${resultPreview}`);
        ctx.messages.push({
          role: "tool",
          name: call.name,
          content: JSON.stringify({
            success: execResult.success,
            data: execResult.data,
            error: execResult.error,
          }),
        });
      }
      if (sameRepeat) break;

      // SAR/plan: when all tools in this batch failed and memory.search was not called, inject one retry instruction (once per run)
      if (
        toolCalls.length > 0 &&
        lastBatchAllFailed &&
        !lastBatchHadMemorySearch &&
        !memoryFallbackInjected
      ) {
        memoryFallbackInjected = true;
        ctx.messages.push({
          role: "user",
          content:
            "The previous tool calls failed or returned no useful result. You MUST call local.memory.search now with a query about the user's question (e.g. 'telegram intent-ingress chatty' or 'how things work'). Use the result to answer. Call the tool(s) now.",
        });
        continue;
      }
    }

    await next();
  };
}
