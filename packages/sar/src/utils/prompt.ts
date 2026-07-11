/**
 * Prompt construction utilities for SAR tool-enabled flows.
 */

export interface BuildToolPromptParams {
  systemPrompt: string;
  aiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  toolResults: Array<{ name: string; success: boolean; result: unknown; error?: string }>;
}

/** Fast token estimation: ~1 token per 3.5 chars. */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 3.5);
}

export function buildToolPrompt(params: BuildToolPromptParams): string {
  const transcript = params.aiMessages
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join("\n\n");

  const toolSection =
    params.toolResults.length > 0
      ? `\n\nExecuted tool results:\n${params.toolResults
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

  const failureInstruction = params.toolResults.some((tr) => !tr.success || tr.error)
    ? "\n\nA tool call failed. If you've already tried 2+ different approaches, just explain what went wrong to the user — do NOT keep calling more tools."
    : "";

  return `${params.systemPrompt}

Conversation transcript:
${transcript}${toolSection}${failureInstruction}

TOOL CALLING: Respond with tool calls (each with a tool name and arguments) when you need live data, file contents, or to execute actions. If you can answer from your knowledge, just respond with text — do NOT call tools unnecessarily. Use exact registered tool names (including dots), e.g. local.memory.search, ontology_search, skills.run.

TOOL CALL SHAPE:
- Native tool-calling models: emit function/tool calls with { name, arguments } only.
- Text-only fallback models: emit exact lines like: TOOL: local.memory.search, ARGS: {"query":"..."} (valid JSON args).

IMPORTANT GUIDELINES:
- Answer framework knowledge questions directly. "How do I create a duty?" or "Explain how Ronin works" do NOT require tool calls.
- Only call tools when you need live/current data: listing installed duties, reading a specific file, searching conversation history, running commands.
- If a tool call fails, do NOT retry with slightly different arguments. If you've tried 2 approaches, stop and answer from knowledge.
- Do NOT call the same tool more than twice in a conversation. If it didn't help the first time, it won't help the second time.`;
}
