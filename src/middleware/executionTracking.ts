/**
 * Execution Tracking Middleware
 *
 * Provides real-time visibility into:
 * - Shell commands being executed
 * - Skills and tools running
 * - Command outputs and results
 *
 * Logs all executable operations for debugging and transparency.
 */

import type { ChainContext, ChainMessage } from "../chain/types.js";
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

/**
 * Create execution tracking middleware
 * 
 * Monitors chain execution and logs all shell commands, skills, and tools
 * being executed with their inputs and outputs.
 */
export function createExecutionTrackingMiddleware(): Middleware<ChainContext> {
  return async (ctx, next) => {
    const originalMessages = [...ctx.messages];
    
    await next();
    
    // Find new messages added during this middleware iteration
    const newMessages = ctx.messages.slice(originalMessages.length);
    
    // Process tool results and assistant messages
    for (const msg of newMessages) {
      if (msg.role === "assistant" && msg.content) {
        // Log assistant's response
        if (msg.content.includes("local.shell") || msg.content.includes("shell")) {
          console.log(`[ExecutionTracking] 🤖 AI deciding to execute shell command`);
        }
      } else if (msg.role === "tool" && msg.name) {
        // Log tool execution with results
        await logToolExecution(msg, ctx);
      }
    }
  };
}

/**
 * Log tool execution details
 */
async function logToolExecution(msg: any, ctx: ChainContext): Promise<void> {
  const toolName = msg.name || "unknown";
  let content = msg.content;
  
  try {
    // Parse tool result if it's JSON
    const result = typeof content === "string" ? JSON.parse(content) : content;
    
    // Log based on tool type
    if (toolName === "local.shell.safe" || toolName === "local_shell_safe") {
      logShellCommand(result, msg.name);
    } else if (toolName === "skills.run" || toolName === "skills_run") {
      logSkillExecution(result);
    } else if (toolName.includes("http") || toolName.includes("request")) {
      logHttpRequest(result);
    } else {
      logGenericTool(toolName, result);
    }
  } catch (e) {
    // If not JSON, just log the tool name and content preview
    const preview = content.substring(0, 100) + (content.length > 100 ? "..." : "");
    console.log(`[ExecutionTracking] 🔧 Tool: ${toolName}\n   Result: ${preview}`);
  }
}

/**
 * Log shell command execution
 */
function logShellCommand(result: any, originalName?: string): void {
  const success = result.success;
  const status = success ? "✅" : "❌";
  const data = result.data || {};
  const stdout = data.stdout || "";
  const stderr = data.stderr || "";
  const error = result.error || "";
  
  console.log(`${status} [ExecutionTracking] Shell Command Executed`);
  
  // Extract command if possible (it's in the original tool call, not the result)
  // For now, we'll note that execution occurred
  if (success && stdout) {
    const stdoutPreview = stdout.substring(0, 200) + (stdout.length > 200 ? "\n   ..." : "");
    console.log(`   Output:\n   ${stdoutPreview.split("\n").join("\n   ")}`);
  }
  
  if (stderr) {
    const stderrPreview = stderr.substring(0, 200) + (stderr.length > 200 ? "\n   ..." : "");
    console.log(`   Stderr:\n   ${stderrPreview.split("\n").join("\n   ")}`);
  }
  
  if (!success) {
    console.log(`   Error: ${error}`);
  }
}

/**
 * Log skill execution
 */
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
  
  if (!success) {
    console.log(`   Error: ${error}`);
  }
}

/**
 * Log HTTP request
 */
function logHttpRequest(result: any): void {
  const success = result.success;
  const status = success ? "✅" : "❌";
  const data = result.data || {};
  const url = data.url || "unknown";
  const method = data.method || "GET";
  const statusCode = data.status || "?";
  const error = result.error || "";
  
  console.log(`${status} [ExecutionTracking] HTTP ${method} ${url} → ${statusCode}`);
  
  if (!success) {
    console.log(`   Error: ${error}`);
  }
}

/**
 * Log generic tool execution
 */
function logGenericTool(toolName: string, result: any): void {
  const success = result.success ?? true;
  const status = success ? "✅" : "❌";
  const error = result.error || "";
  const dataKeys = result.data ? Object.keys(result.data).slice(0, 3) : [];
  
  console.log(`${status} [ExecutionTracking] Tool: ${toolName}`);
  
  if (dataKeys.length > 0) {
    console.log(`   Data: {${dataKeys.join(", ")}${Object.keys(result.data).length > 3 ? ", ..." : ""}}`);
  }
  
  if (!success && error) {
    console.log(`   Error: ${error}`);
  }
}

/**
 * Export execution log for dashboard/UI
 */
export function getExecutionLog(): ExecutableInfo[] {
  return executionLog;
}

/**
 * Clear execution log
 */
export function clearExecutionLog(): void {
  executionLog.length = 0;
}
