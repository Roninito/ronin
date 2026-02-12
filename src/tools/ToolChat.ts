/**
 * Tool-Enabled Chat
 * 
 * High-level interface for chat with automatic tool execution
 * Integrates Ollama's function calling with the ToolRouter
 */

import type { AgentAPI } from "../types/api.js";
import type { 
  ToolDefinition, 
  ToolCall as RouterToolCall, 
  ToolContext,
  OpenAIFunctionSchema 
} from "./types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OpenAIFunctionSchema[];
  tool_call_id?: string;
}

export interface ToolEnabledChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxToolIterations?: number;
  systemPrompt?: string;
  enableTools?: boolean;
  toolFilter?: string[]; // Only use specific tools
}

export interface ToolEnabledChatResult {
  response: string;
  toolCalls: Array<{
    name: string;
    arguments: any;
    result: any;
  }>;
  iterations: number;
  cost: number;
}

/**
 * Tool-enabled chat helper
 * 
 * Usage:
 * ```typescript
 * const result = await toolChat(api, [
 *   { role: "user", content: "Research AI agents and create a summary" }
 * ], { enableTools: true });
 * ```
 */
export async function toolChat(
  api: AgentAPI,
  messages: ChatMessage[],
  options: ToolEnabledChatOptions = {}
): Promise<ToolEnabledChatResult> {
  const {
    model,
    temperature = 0.7,
    maxTokens = 2000,
    maxToolIterations = 5,
    systemPrompt = "You are a helpful AI assistant with access to tools.",
    enableTools = true,
    toolFilter,
  } = options;

  const conversationId = `chat-${Date.now()}`;
  let currentMessages = [...messages];
  let totalCost = 0;
  const executedToolCalls: Array<{ name: string; arguments: any; result: any }> = [];

  // Add system message if not present
  if (!currentMessages.some(m => m.role === "system")) {
    currentMessages.unshift({ role: "system", content: systemPrompt });
  }

  for (let iteration = 0; iteration < maxToolIterations; iteration++) {
    // Get available tools
    let tools: OpenAIFunctionSchema[] = [];
    if (enableTools) {
      const allTools = api.tools.getSchemas();
      if (toolFilter && toolFilter.length > 0) {
        tools = allTools.filter(t => toolFilter.includes(t.function.name));
      } else {
        tools = allTools;
      }
    }

    // Call Ollama with tools
    const response = await api.ai.callTools(
      currentMessages[currentMessages.length - 1].content,
      tools.map(t => ({
        type: "function" as const,
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      })),
      { model, temperature, maxTokens }
    );

    // If no tool calls, we're done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        response: response.message.content,
        toolCalls: executedToolCalls,
        iterations: iteration + 1,
        cost: totalCost,
      };
    }

    // Execute tool calls
    const toolResults: Array<{ role: "tool"; content: string; tool_call_id: string }> = [];
    
    for (const toolCall of response.toolCalls) {
      console.log(`[ToolChat] Executing tool: ${toolCall.name}`);
      
      try {
        const result = await api.tools.execute(
          toolCall.name,
          toolCall.arguments,
          {
            conversationId,
            originalQuery: currentMessages[currentMessages.length - 1].content,
          }
        );

        executedToolCalls.push({
          name: toolCall.name,
          arguments: toolCall.arguments,
          result: result.data,
        });

        if (result.metadata.cost) {
          totalCost += result.metadata.cost;
        }

        toolResults.push({
          role: "tool",
          content: JSON.stringify(result.data),
          tool_call_id: `${toolCall.name}-${Date.now()}`,
        });
      } catch (error) {
        console.error(`[ToolChat] Tool execution failed:`, error);
        toolResults.push({
          role: "tool",
          content: JSON.stringify({ error: String(error) }),
          tool_call_id: `${toolCall.name}-${Date.now()}`,
        });
      }
    }

    // Add assistant response and tool results to conversation
    currentMessages.push({
      role: "assistant",
      content: response.message.content,
    });
    
    for (const toolResult of toolResults) {
      currentMessages.push(toolResult as ChatMessage);
    }
  }

  // Max iterations reached, return last response
  return {
    response: "Maximum tool iterations reached. Here's what I found so far...",
    toolCalls: executedToolCalls,
    iterations: maxToolIterations,
    cost: totalCost,
  };
}

/**
 * Simple one-shot tool execution
 * Execute a single tool and return result
 */
export async function executeTool(
  api: AgentAPI,
  toolName: string,
  args: Record<string, any>,
  context?: Partial<ToolContext>
): Promise<any> {
  const result = await api.tools.execute(toolName, args, context);
  if (!result.success) {
    throw new Error(result.error || "Tool execution failed");
  }
  return result.data;
}

/**
 * Execute a workflow
 */
export async function runWorkflow(
  api: AgentAPI,
  workflowName: string,
  args: Record<string, any>,
  context?: Partial<ToolContext>
): Promise<any> {
  return api.tools.executeWorkflow(workflowName, args, context);
}

/**
 * Quick research helper
 */
export async function quickResearch(
  api: AgentAPI,
  query: string,
  options: { depth?: number; summarize?: boolean } = {}
): Promise<string> {
  const { depth = 2, summarize = true } = options;

  const result = await toolChat(
    api,
    [{ role: "user", content: `Research: ${query}` }],
    {
      enableTools: true,
      toolFilter: ["cloud.research", "local.reasoning", "agent.WebResearcher.research"],
      systemPrompt: `You are a research assistant. Use research tools to find information about "${query}" and provide a comprehensive summary.`,
    }
  );

  return result.response;
}

/**
 * Quick code analysis helper
 */
export async function analyzeCode(
  api: AgentAPI,
  code: string,
  options: { filePath?: string; context?: string } = {}
): Promise<{
  analysis: string;
  issues: string[];
  suggestions: string[];
}> {
  const result = await toolChat(
    api,
    [{ role: "user", content: `Analyze this code:\n\n${code}` }],
    {
      enableTools: true,
      toolFilter: ["local.reasoning", "local.memory.search"],
      systemPrompt: "You are a code reviewer. Analyze the provided code for bugs, security issues, and improvements.",
    }
  );

  // Parse structured response
  return {
    analysis: result.response,
    issues: [], // Would parse from response
    suggestions: [],
  };
}
