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
    ? "\n\nIMPORTANT: At least one tool failed (success: false or error). Before concluding you cannot help: (1) If you have not yet called local.memory.search, call it with a query about the user's question. (2) Use ontology_search (e.g. type 'ReferenceDoc' or 'Tool', nameLike matching the request) to find how to fulfill the request and which tool to call. (3) For prior conversation/context questions, run skills.run with skill_name \"recall\" and ability \"find-related\" plus the user topic/query. (4) Only after trying memory search/recall/ontology discovery may you tell the user that a tool failed and what went wrong."
    : "";

  return `${params.systemPrompt}

Conversation transcript:
${transcript}${toolSection}${failureInstruction}

TOOL CALLING: To run a tool you must respond with tool calls (each with a tool name and arguments). Plain text alone does not execute any tool. If the task requires tools, output tool calls now. Use exact registered tool names (including dots), e.g. local.memory.search, ontology_search, skills.run, local.ronin_script.aggregate, local.ronin_script.parse, local.ronin_script.to_json, local.ronin_script.from_json.

TOOL CALL SHAPE:
- Native tool-calling models: emit function/tool calls with { name, arguments } only.
- Text-only fallback models: emit exact lines like: TOOL: local.memory.search, ARGS: {"query":"..."} (valid JSON args).

RECALL WORKFLOW (when user asks about previous work/history/context): call tools first, in order:
1) local.memory.search with the topic or key phrase
2) ontology_search / ontology_history for structured prior knowledge
3) skills.run with { "skill_name":"recall", "options": { "ability":"find-related", "params": { "query":"<topic>" } } } for deep grep-style lookup
Then synthesize from tool evidence.

If you cannot complete the task (e.g. you need to give up or only have a text reply), use the available abort/finish mechanism (e.g. skill_maker.finish with status "abort") so the run is explicitly aborted rather than leaving it ambiguous. After your tool calls run, you get another turn with the results; you can call more tools or call finish. Respond to the latest message; if you need to act, call the appropriate tool(s) first.`;
}
