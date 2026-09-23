/**
 * Report middleware for the SAR envelope.
 *
 * Sense → Act → Report
 *
 * Report is output-only: document, log, report, emit, and store. It never does
 * new work. This middleware guarantees every runner-envelope duty run leaves
 * a non-empty `ctx.report` artifact.
 */

import type { ChainContext, SARReportRecord } from "../chain/types.js";
import type { Middleware } from "./MiddlewareStack.js";

interface ToolCallSummary {
  name: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface ReportMiddlewareOptions {
  dutyName: string;
  startTime: number;
  api?: {
    memory?: {
      store(key: string, value: unknown): Promise<void>;
    };
    events?: {
      emit(event: string, data: unknown, source: string): void;
    };
  };
}

function extractFinalContent(messages: ChainContext["messages"]): string | undefined {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return undefined;
  const text =
    typeof lastAssistant.content === "string"
      ? lastAssistant.content
      : JSON.stringify(lastAssistant.content);
  return text.trim() || undefined;
}

function extractToolCalls(messages: ChainContext["messages"]): ToolCallSummary[] | undefined {
  const toolMessages = messages.filter((m) => m.role === "tool" && m.name);
  if (toolMessages.length === 0) return undefined;

  return toolMessages.map((m) => {
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
      // Keep raw content as result.
    }
    return { name: m.name ?? "unknown", success, result, error };
  });
}

function buildSummary(record: SARReportRecord): string {
  const toolCount = record.toolCalls?.length ?? 0;
  const finalPreview = record.finalContent
    ? record.finalContent.slice(0, 80) + (record.finalContent.length > 80 ? "..." : "")
    : "no assistant output";
  return `Duty "${record.dutyName}" completed in ${record.durationMs}ms; ${toolCount} tool call(s); final: ${finalPreview}`;
}

export function createReportMiddleware(
  options: ReportMiddlewareOptions
): Middleware<ChainContext> {
  const { dutyName, startTime, api } = options;

  return async (ctx, next) => {
    await next();

    const duration = Date.now() - startTime;
    const timestamp = new Date().toISOString();

    const record: SARReportRecord = {
      dutyName,
      timestamp,
      durationMs: duration,
      summary: "",
      finalContent: extractFinalContent(ctx.messages),
      toolCalls: extractToolCalls(ctx.messages),
    };

    record.summary = buildSummary(record);

    // Persist to memory if available (non-blocking, best effort).
    const memoryKey = `sar:report:${dutyName}:${Date.now()}`;
    if (api?.memory?.store) {
      try {
        await api.memory.store(memoryKey, record);
        record.memoryKey = memoryKey;
      } catch (error) {
        record.memoryKey = `failed:${error instanceof Error ? error.message : String(error)}`;
      }
    }

    // Emit report event if bus is available (non-blocking, best effort).
    if (api?.events?.emit) {
      try {
        api.events.emit("duty.reported", { dutyName, timestamp, durationMs: duration }, dutyName);
        record.eventEmitted = { type: "duty.reported", ok: true };
      } catch (error) {
        record.eventEmitted = {
          type: "duty.reported",
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    // Log the report artifact.
    console.log(`[Report] ${record.summary}`);
    if (record.memoryKey) {
      console.log(`[Report] Memory key: ${record.memoryKey}`);
    }

    ctx.report = record;
  };
}

/**
 * Helper to finalize a report record synchronously when used outside a
 * middleware stack (e.g. by a duty that manages its own SAR loop).
 */
export function finalizeReportRecord(
  ctx: ChainContext,
  options: { dutyName: string; startTime: number }
): SARReportRecord {
  const { dutyName, startTime } = options;
  const duration = Date.now() - startTime;
  const timestamp = new Date().toISOString();

  const record: SARReportRecord = {
    dutyName,
    timestamp,
    durationMs: duration,
    summary: "",
    finalContent: extractFinalContent(ctx.messages),
    toolCalls: extractToolCalls(ctx.messages),
  };

  record.summary = buildSummary(record);
  ctx.report = record;
  return record;
}
