# Tool/Function Calling Guide

## Overview

Ronin supports Ollama's native function calling API, allowing AI agents to use plugins as tools. This enables agents to interact with external systems and perform actions based on AI decisions.

## How It Works

1. **Plugin Discovery**: Plugins are automatically discovered and loaded
2. **Tool Generation**: Plugins are converted to Ollama tool definitions
3. **AI Request**: Agent calls `api.ai.callTools()` with a prompt
4. **Tool Execution**: Ollama returns tool calls, which are executed
5. **Result Handling**: Tool results can be used in subsequent AI calls

## Basic Usage

### Simple Tool Calling

```typescript
export default class MyAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Call tools with a prompt
    const { message, toolCalls } = await this.api.ai.callTools(
      "Check git status and tell me what files have changed",
      [] // Plugin tools are automatically included
    );

    // Execute tool calls
    for (const toolCall of toolCalls) {
      const [pluginName, methodName] = toolCall.name.split("_");
      const result = await this.api.plugins.call(
        pluginName,
        methodName,
        ...(toolCall.arguments.args || [])
      );
      console.log(`Tool ${toolCall.name} result:`, result);
    }

    // Use the AI's message
    console.log("AI response:", message.content);
  }
}
```

### Multi-Step Tool Calling

```typescript
export default class MyAgent extends BaseAgent {
  async execute(): Promise<void> {
    const prompt = "Check git status, and if there are changes, commit them with message 'Auto-commit'";
    
    const { toolCalls } = await this.api.ai.callTools(prompt, []);
    
    // Execute all tool calls
    const results = [];
    for (const toolCall of toolCalls) {
      const [pluginName, methodName] = toolCall.name.split("_");
      const result = await this.api.plugins.call(
        pluginName,
        methodName,
        ...(toolCall.arguments.args || [])
      );
      results.push({ tool: toolCall.name, result });
    }

    // Continue conversation with results
    const followUp = await this.api.ai.chat([
      { role: "user", content: prompt },
      { role: "assistant", content: JSON.stringify(results) },
      { role: "user", content: "Summarize what was done" },
    ]);

    console.log(followUp.content);
  }
}
```

## Custom Tools

You can also define custom tools (not from plugins):

```typescript
import type { Tool } from "@ronin/types/api.js";

const customTool: Tool = {
  type: "function",
  function: {
    name: "calculate",
    description: "Perform a calculation",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Mathematical expression to evaluate",
        },
      },
      required: ["expression"],
    },
  },
};

const { toolCalls } = await this.api.ai.callTools(
  "Calculate 2 + 2",
  [customTool]
);
```

## Tool Call Format

Tool calls from Ollama follow this structure:

```typescript
{
  name: "pluginName_methodName",
  arguments: {
    args: [/* method arguments */]
  }
}
```

To execute:
```typescript
const [pluginName, methodName] = toolCall.name.split("_");
await this.api.plugins.call(pluginName, methodName, ...toolCall.arguments.args);
```

## Plugin Tool Naming

Plugin tools are automatically named: `{pluginName}_{methodName}`

Examples:
- `git_status` - git plugin, status method
- `shell_exec` - shell plugin, exec method
- `my-plugin_methodName` - my-plugin, methodName method

## Advanced Patterns

### Tool Call Loop

```typescript
async function executeWithTools(prompt: string, maxIterations = 5) {
  let iteration = 0;
  let conversation = [{ role: "user" as const, content: prompt }];

  while (iteration < maxIterations) {
    const { message, toolCalls } = await this.api.ai.callTools(
      conversation[conversation.length - 1].content,
      []
    );

    conversation.push(message);

    if (toolCalls.length === 0) {
      break; // No more tools to call
    }

    // Execute tools
    const toolResults = [];
    for (const toolCall of toolCalls) {
      const [pluginName, methodName] = toolCall.name.split("_");
      const result = await this.api.plugins.call(
        pluginName,
        methodName,
        ...(toolCall.arguments.args || [])
      );
      toolResults.push({ tool: toolCall.name, result });
    }

    // Add tool results to conversation
    conversation.push({
      role: "user",
      content: `Tool results: ${JSON.stringify(toolResults)}`,
    });

    iteration++;
  }

  return conversation;
}
```

### Error Handling

```typescript
const { toolCalls } = await this.api.ai.callTools(prompt, []);

for (const toolCall of toolCalls) {
  try {
    const [pluginName, methodName] = toolCall.name.split("_");
    const result = await this.api.plugins.call(
      pluginName,
      methodName,
      ...(toolCall.arguments.args || [])
    );
    console.log(`✅ ${toolCall.name}:`, result);
  } catch (error) {
    console.error(`❌ ${toolCall.name} failed:`, error);
    // Continue with other tools or handle error
  }
}
```

## Ollama Function Calling Support

Ronin uses Ollama's native function calling API via the `/api/chat` endpoint with the `tools` parameter. This requires:

1. **Ollama version** that supports function calling
2. **Model support** - qwen3 should support function calling
3. **Proper tool definitions** - Automatically generated from plugins

If function calling is not supported, you can:
- Use JSON mode as fallback
- Structure prompts to request tool calls in JSON format
- Parse JSON responses manually

## Limitations

1. **Tool Parameter Inference**: Currently uses generic `args` array - plugin authors should document expected parameters
2. **Type Safety**: Tool arguments are not type-checked at runtime
3. **Error Propagation**: Tool errors need manual handling
4. **Tool Result Format**: Results are passed as-is to AI

## Best Practices

1. **Clear Prompts**: Be specific about what tools to use
2. **Error Handling**: Always handle tool execution errors
3. **Result Validation**: Validate tool results before using
4. **Iteration Limits**: Set max iterations for tool call loops
5. **Logging**: Log tool calls for debugging

## Example: Complete Agent

```typescript
import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

export default class GitAgent extends BaseAgent {
  static schedule = "0 */6 * * *"; // Every 6 hours

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    const prompt = "Check git status. If there are uncommitted changes, commit them with an appropriate message based on the file changes.";

    try {
      const { toolCalls, message } = await this.api.ai.callTools(prompt, []);

      // Execute tool calls
      for (const toolCall of toolCalls) {
        const [pluginName, methodName] = toolCall.name.split("_");
        
        try {
          const result = await this.api.plugins.call(
            pluginName,
            methodName,
            ...(toolCall.arguments.args || [])
          );
          
          console.log(`Executed ${toolCall.name}:`, result);
          
          // Store result in memory
          await this.api.memory.store(
            `tool_${toolCall.name}_${Date.now()}`,
            result
          );
        } catch (error) {
          console.error(`Tool ${toolCall.name} failed:`, error);
        }
      }

      console.log("AI message:", message.content);
    } catch (error) {
      console.error("Tool calling failed:", error);
    }
  }
}
```

