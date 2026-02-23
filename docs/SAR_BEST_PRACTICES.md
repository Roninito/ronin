# SAR Best Practices Guide

## Overview

SAR (Semantic Agent Runtime) is Ronin's primary execution engine for agents. It provides a clean, composable middleware-based architecture for tool calling, token management, ontology integration, and knowledge retrieval.

**95% of Ronin agents use SAR.** This guide explains when to use SAR, which middleware template to choose, and how to write SAR-first agents.

---

## When to Use SAR (vs LangChain)

### Use SAR (95% of cases)
- ✅ Single-turn or simple multi-turn conversations
- ✅ Tool calling with clear execution flow
- ✅ Need ontology integration or token management
- ✅ Want visible, auditable execution
- ✅ Don't need explicit state machine management

### Use LangChain (5% of cases)
- ✅ Multi-node state machines (e.g., Planning → Research → Coding)
- ✅ Complex workflows requiring explicit graph management
- ✅ LangGraph for conditional branching or looping patterns
- ✅ Example: `agent-creator-orchestrator.ts` (justified use)

**Default:** Start with SAR. Only move to LangChain if you genuinely need state machine complexity.

---

## Middleware Templates

SAR provides 3 ready-to-use templates for 95% of use cases:

### 1. **quickSAR()** — Minimal Setup
**Use when:** Testing, debugging, or extreme simplicity needed

```typescript
const stack = quickSAR();
const chain = this.createChain();
chain.useMiddlewareStack(stack);
```

**Stack:**
- Logging (for debugging)
- Ontology resolve (entity references)
- AI tools (calling external tools)

**Lines of code saved:** 3-4

---

### 2. **standardSAR()** — Recommended for 80% of Agents
**Use when:** Default choice for any agent doing tool-based work

```typescript
const stack = standardSAR({ maxTokens: 8192 });
const chain = this.createChain();
chain.useMiddlewareStack(stack);
```

**Stack:**
1. Logging → Visibility for debugging
2. Ontology resolve → Convert entity refs to data
3. Ontology inject → Add context before AI
4. Smart trim → Keep messages under limit
5. Token guard → Hard budget enforcement
6. AI tools → Call external tools

**Lines of code saved:** 5-7  
**Why this stack order matters:**
- Resolve BEFORE inject (can't inject until you have data)
- Trim AFTER inject (need full context before trimming)
- Token guard BEFORE tools (ensure budget exists before calling)

**Parameters:**
- `maxTokens` — Hard budget for entire conversation (default: 8192)
- `reservedForResponse` — Tokens reserved for response (default: 512)
- `recentMessageCount` — Keep N recent messages (default: 12)

---

### 3. **smartSAR()** — Full Control
**Use when:** Complex agents needing custom middleware, branching, or special handling

```typescript
const stack = smartSAR({
  maxTokens: 16384,
  reservedForResponse: 1024,
  recentMessageCount: 20,
  customMiddleware: [
    // Add custom middlewares here if needed
    myCustomMiddleware(),
  ],
});
const chain = this.createChain();
chain.useMiddlewareStack(stack);
```

**Same as standardSAR but:**
- Supports custom middleware insertion
- Larger default token budgets
- More flexibility for edge cases

**When to add custom middleware:**
- Specialized logging for domain (e.g., refactoring-specific logging)
- Custom input validation or transformation
- Specialized output handling (e.g., converting tool results to specific format)

---

## Step-by-Step: Write Your First SAR Agent

### 1. Extend BaseAgent
```typescript
import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { standardSAR } from "../src/chains/templates.js";
import type { ChainContext } from "../src/chain/types.js";

export default class MyAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    // Your agent logic here
  }
}
```

### 2. Create a Chain with standardSAR
```typescript
async execute(): Promise<void> {
  // Set up context
  const ctx: ChainContext = {
    messages: [
      { role: "system", content: "You are my assistant..." },
      { role: "user", content: "Hello!" },
    ],
    ontology: {
      domain: "my-domain",
      relevantSkills: ["skill.list", "skill.run"],
    },
    budget: {
      max: 8192,
      current: 0,
      reservedForResponse: 512,
    },
  };

  // Create chain with standardSAR
  const stack = standardSAR({ maxTokens: 8192 });
  const chain = this.createChain("my-agent");
  chain.useMiddlewareStack(stack);
  chain.withContext(ctx);
  
  // Run the chain
  await chain.run();

  // Process results
  const lastMessage = ctx.messages[ctx.messages.length - 1];
  console.log("Response:", lastMessage.content);
}
```

### 3. Define Your Tools
Use `UnifiedToolInterface` to define tools once, reuse everywhere:

```typescript
import { UnifiedTool } from "../src/tools/UnifiedToolInterface.js";

const myTool: UnifiedTool = {
  id: "my.tool",
  name: "My Tool",
  description: "Does something useful",
  parameters: [
    {
      name: "input",
      type: "string",
      description: "The input to process",
      required: true,
    },
  ],
  execute: async (params, context) => {
    const result = await doSomething(params.input);
    return {
      success: true,
      data: result,
    };
  },
};
```

### 4. Register Tools with Ontology
The SAR middleware automatically resolves and injects tools from your ontology. Define them in your ontology entry.

---

## Common Patterns

### Pattern 1: Multi-Turn Conversation
```typescript
const messages: Message[] = [];

for (const userInput of userInputs) {
  messages.push({ role: "user", content: userInput });
  
  const stack = standardSAR();
  const chain = this.createChain();
  chain.useMiddlewareStack(stack);
  chain.withContext({
    messages,
    ontology: { domain: "chat" },
    budget: { max: 8192, current: 0, reservedForResponse: 512 },
  });
  
  await chain.run();
  
  const response = messages[messages.length - 1];
  console.log("Assistant:", response.content);
}
```

### Pattern 2: Tool-First Agent
```typescript
const ctx: ChainContext = {
  messages: [
    {
      role: "system",
      content: "You are a tool-using assistant. Use tools to accomplish tasks.",
    },
    { role: "user", content: userRequest },
  ],
  ontology: {
    domain: "tools",
    relevantSkills: ["files.read", "files.write", "shell.exec"],
  },
  budget: { max: 8192, current: 0, reservedForResponse: 512 },
};
```

### Pattern 3: Bounded Conversation (Token-Limited)
```typescript
const stack = standardSAR({ maxTokens: 4096 }); // Small budget
// Middleware automatically enforces budget
```

### Pattern 4: Custom Logging
Use `smartSAR()` for domain-specific logging:
```typescript
const stack = smartSAR({
  customMiddleware: [
    async (ctx, next) => {
      console.log(`[my-domain] Starting with ${ctx.messages.length} messages`);
      await next();
      console.log(`[my-domain] Completed, response: ${ctx.messages[ctx.messages.length - 1].content.slice(0, 50)}`);
    },
  ],
});
```

---

## Performance Considerations

### Token Budget
- **quickSAR**: No explicit budget (dangerous for production)
- **standardSAR**: Default 8192 tokens (good balance)
- **smartSAR**: Configurable (8192-16384 recommended)

**Rule of thumb:** Reserve 20% of budget for response (default: 512 / 8192)

### Message Trimming
The `createSmartTrimMiddleware` keeps N recent messages. Default is 12.
- Reduces context drift
- Keeps conversations focused
- Prevents token runaway

**Tuning:** Increase `recentMessageCount` for long conversations, decrease for quick queries.

### Ontology Resolution
Ontology resolve is fast (<1ms for most queries) but can be expensive for 100s of entities.
- Use specific `relevantSkills` filters
- Don't include entire ontology in every chain

---

## Debugging SAR Chains

### 1. Enable Logging
```typescript
const stack = standardSAR({ maxTokens: 8192 });
// Logging middleware is already included, check console output
```

### 2. Inspect Context
```typescript
const chain = this.createChain();
chain.useMiddlewareStack(stack);
chain.withContext(ctx);

console.log("Before run:", JSON.stringify(ctx, null, 2));
await chain.run();
console.log("After run:", JSON.stringify(ctx, null, 2));
```

### 3. Check Token Usage
```typescript
const chain = this.createChain();
chain.withContext(ctx);
console.log("Token budget:", ctx.budget);
await chain.run();
console.log("Tokens used:", ctx.budget.current);
```

---

## Migration Guide: From Manual Middleware to Templates

### Before (Manual Middleware)
```typescript
import { createOntologyResolveMiddleware, createAiToolMiddleware } from "../src/middleware";
import { MiddlewareStack } from "../src/middleware/MiddlewareStack.js";

const stack = new MiddlewareStack<ChainContext>();
stack.use(createOntologyResolveMiddleware({ api: this.api }));
stack.use(createAiToolMiddleware(this.api));
// ... more middleware ...

const chain = new Chain(this.executor!, stack, "my-agent");
```

### After (standardSAR Template)
```typescript
import { standardSAR } from "../src/chains/templates.js";

const stack = standardSAR({ maxTokens: 8192 });
const chain = this.createChain();
chain.useMiddlewareStack(stack);
```

**Result:** 5 lines → 3 lines. Clearer intent, same functionality.

---

## FAQ

**Q: When should I use smartSAR over standardSAR?**  
A: Only if you need custom middleware. Otherwise, stick with standardSAR.

**Q: Can I add middleware to templates?**  
A: Yes, use `smartSAR()` and pass `customMiddleware` array.

**Q: What if standardSAR is missing a middleware I need?**  
A: Either (1) request it be added to templates, or (2) use smartSAR with custom middleware.

**Q: How do I know if token budget is sufficient?**  
A: Run with logging enabled, check `ctx.budget.current` after execution.

**Q: Can I use SAR for non-tool agents (pure conversation)?**  
A: Yes, SAR works for any LLM task. Just don't define tools in ontology.

**Q: Is there performance overhead vs manual middleware?**  
A: No, templates use identical middleware. Just cleaner syntax.

---

## Summary

| Scenario | Template | Lines Saved | Complexity |
|----------|----------|------------|-----------|
| Testing/Debug | quickSAR() | 3-4 | Very Low |
| Normal agent | standardSAR() | 5-7 | Low |
| Complex agent | smartSAR() | 5-7 | Medium |
| State machine | LangChain | N/A | High |

**Default choice:** `standardSAR()` for any agent doing tool calling, knowledge retrieval, or multi-turn conversation.

**Next:** Read [MIDDLEWARE_TEMPLATES_REFERENCE.md](MIDDLEWARE_TEMPLATES_REFERENCE.md) for detailed middleware docs.
