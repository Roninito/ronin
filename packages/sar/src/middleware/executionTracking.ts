/**
 * Execution Tracking Middleware
 *
 * Provides real-time visibility into shell commands, skills, and tools running.
 * Logs all executable operations for debugging and transparency.
 */

import type { ChainContext } from "../chain/types.js";
import type { Middleware } from "./MiddlewareStack.js";

interface ExecutableInfo {
  type: "shell" | "skill" | "tool" | "http";
  name: string;
  command?: string;
  args?: Record<string, unknown>;
  timestamp: number;
  startTime: number;
  endTime?: number;
  success?: boolean;
  output?: string;
  error?: string;
}

const executionLog: ExecutableInfo[] = [];

export function createExecutionTrackingMiddleware(): Middleware<ChainContext> {
  return async (ctx, next) => {
    const originalMessages = [...ctx.messages];

    await next();

    const newMessages = ctx.messages.slice(originalMessages.length);

    for (const msg of newMessages) {
      if (msg.role === "tool" && msg.name) {
        await logToolExecution(msg, ctx);
      }
    }
  };
}

async function logToolExecution(msg: any, _ctx: ChainContext): Promise<void> {
  const toolName = msg.name || "unknown";
  const content = msg.content;

  try {
    const result = typeof content === "string" ? JSON.parse(content) : content;

    if (toolName === "local.shell.safe" || toolName === "local_shell_safe") {
      logShellCommand(result);
    } else if (toolName === "skills.run" || toolName === "skills_run") {
      logSkillExecution(result);
    } else if (toolName.includes("http") || toolName.includes("request")) {
      logHttpRequest(result);
    } else {
      logGenericTool(toolName, result);
    }
  } catch {
    const preview = content.substring(0, 100) + (content.length > 100 ? "..." : "");
    console.log(`[ExecutionTracking] 🔧 Tool: ${toolName}\n   Result: ${preview}`);
  }
}

function logShellCommand(result: any): void {
  const success = result.success;
  const status = success ? "✅" : "❌";
  const data = result.data || {};
  const stdout = data.stdout || "";
  const stderr = data.stderr || "";
  const error = result.error || "";

  console.log(`${status} [ExecutionTracking] Shell Command Executed`);
  if (success && stdout) {
    const preview = stdout.substring(0, 200) + (stdout.length > 200 ? "\n   ..." : "");
    console.log(`   Output:\n   ${preview.split("\n").join("\n   ")}`);
  }
  if (stderr) {
    const preview = stderr.substring(0, 200) + (stderr.length > 200 ? "\n   ..." : "");
    console.log(`   Stderr:\n   ${preview.split("\n").join("\n   ")}`);
  }
  if (!success) console.log(`   Error: ${error}`);
}

function logSkillExecution(result: any): void {
  const success = result.success;
  const status = success ? "✅" : "❌";
  const skillData = result.data || {};
  const skill = skillData.skill || "unknown";
  const output = skillData.output || "";
  const error = result.error || "";

  console.log(`${status} [ExecutionTracking] Skill Executed: ${skill}`);
  if (success && output) {
    if (typeof output === "string") {
      const preview = output.substring(0, 200) + (output.length > 200 ? "\n   ..." : "");
      console.log(`   Output:\n   ${preview.split("\n").join("\n   ")}`);
    } else if (typeof output === "object") {
      const keys = Object.keys(output).slice(0, 5);
      console.log(`   Output: {${keys.join(", ")}${Object.keys(output).length > 5 ? ", ..." : ""}}`);
    }
  }
  if (!success) console.log(`   Error: ${error}`);
}

function logHttpRequest(result: any): void {
  const success = result.success;
  const status = success ? "✅" : "❌";
  const data = result.data || {};
  const url = data.url || "unknown";
  const method = data.method || "GET";
  const statusCode = data.status || "?";
  const error = result.error || "";

  console.log(`${status} [ExecutionTracking] HTTP ${method} ${url} → ${statusCode}`);
  if (!success) console.log(`   Error: ${error}`);
}

function logGenericTool(toolName: string, result: any): void {
  const success = result.success ?? true;
  const status = success ? "✅" : "❌";
  const error = result.error || "";
  const dataKeys = result.data ? Object.keys(result.data).slice(0, 3) : [];

  console.log(`${status} [ExecutionTracking] Tool: ${toolName}`);
  if (dataKeys.length > 0) {
    console.log(`   Data: {${dataKeys.join(", ")}${Object.keys(result.data).length > 3 ? ", ..." : ""}}`);
  }
  if (!success && error) console.log(`   Error: ${error}`);
}

export function getExecutionLog(): ExecutableInfo[] {
  return executionLog;
}

export function clearExecutionLog(): void {
  executionLog.length = 0;
}
