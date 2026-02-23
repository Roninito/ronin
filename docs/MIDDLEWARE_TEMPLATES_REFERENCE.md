# Middleware Templates Reference

## Overview

Ronin provides 3 pre-built middleware stacks (templates) in `src/chains/templates.ts`:
- **quickSAR()** — Minimal, for testing
- **standardSAR()** — Recommended for 80% of agents
- **smartSAR()** — Full control with custom middleware

This reference documents what each template does and when to use them.

---

## quickSAR()

**Purpose:** Minimal setup for testing or rapid prototyping  
**Lines saved:** 3-4  
**Common in:** Test agents, debugging, learning

### Stack
1. Logging
2. Ontology resolve
3. AI tools

### Code
```typescript
const stack = quickSAR();
const chain = this.createChain();
chain.useMiddlewareStack(stack);
```

### When to Use
- ✅ Learning SAR basics
- ✅ Testing/debugging (small scripts)
- ✅ Extreme simplicity needed
- ❌ Production agents (missing token guard)
- ❌ Complex conversations (no trimming)

### Limitations
- No token budget enforcement (dangerous)
- No message trimming (context drift)
- No ontology injection
- Not recommended for production

---

## standardSAR() ⭐ RECOMMENDED

**Purpose:** Recommended default for 80% of agents  
**Lines saved:** 5-7  
**Common in:** Most production agents, primary use case

### Stack Order (Matters!)
```
1. Logging
   └─ Log all operations for debugging

2. Ontology Resolve
   └─ Convert entity references (e.g., @user) to actual data

3. Ontology Inject
   └─ Add relevant context before LLM sees messages

4. Smart Trim
   └─ Keep only recent N messages (default 12)

5. Token Guard
   └─ Enforce hard budget (fail if over limit)

6. AI Tools
   └─ Allow LLM to call external tools
```

### Why This Order?

**Resolve BEFORE Inject:**
- Resolve converts `@entity` → actual data
- Inject adds resolved data to context
- Can't inject until data exists

**Trim AFTER Inject:**
- Need full context before deciding what to trim
- Prevents losing important resolved data

**Guard BEFORE Tools:**
- Check budget exists before calling external tools
- Prevents expensive tool calls on low budget

### Code
```typescript
const stack = standardSAR({ maxTokens: 8192 });
const chain = this.createChain();
chain.useMiddlewareStack(stack);
```

### Parameters
```typescript
interface StandardSAROptions {
  maxTokens?: number;              // Default: 8192
  reservedForResponse?: number;    // Default: 512
  recentMessageCount?: number;     // Default: 12
}
```

**maxTokens:** Total budget for entire conversation  
- Typical: 4096 (small) to 16384 (large)
- Reserve 20% for response

**reservedForResponse:** Tokens guaranteed for response  
- Typical: 512 (default)
- Increase for longer responses needed

**recentMessageCount:** Keep N recent messages  
- Typical: 8-12 (default)
- Increase for longer context, decrease for short sessions

### When to Use
- ✅ Default choice for any SAR agent
- ✅ Multi-turn conversations
- ✅ Tool-using agents
- ✅ Token-constrained scenarios
- ✅ Ontology-aware agents

### Example: Complete Agent
```typescript
import { BaseAgent } from "../src/agent/index.js";
import { standardSAR } from "../src/chains/templates.js";
import type { ChainContext } from "../src/chain/types.js";

export default class QuestionAgent extends BaseAgent {
  async execute(): Promise<void> {
    const ctx: ChainContext = {
      messages: [
        {
          role: "system",
          content: "You are a helpful Q&A agent. Answer questions accurately.",
        },
        {
          role: "user",
          content: "What is the capital of France?",
        },
      ],
      ontology: {
        domain: "qa",
        relevantSkills: ["ontology.search", "memory.retrieve"],
      },
      budget: {
        max: 8192,
        current: 0,
        reservedForResponse: 512,
      },
    };

    const stack = standardSAR({ maxTokens: 8192 });
    const chain = this.createChain();
    chain.useMiddlewareStack(stack);
    chain.withContext(ctx);
    await chain.run();

    console.log("Response:", ctx.messages[ctx.messages.length - 1].content);
  }
}
```

---

## smartSAR()

**Purpose:** Full control for complex agents  
**Lines saved:** 5-7  
**Common in:** Specialized agents, edge cases, custom workflows

### Stack
Same as `standardSAR()` plus optional custom middleware:
```
1. Logging
2. Ontology Resolve
3. Ontology Inject
4. Smart Trim
5. Token Guard
6. AI Tools
7. [Custom Middleware] ← Optional
```

### Code
```typescript
const stack = smartSAR({
  maxTokens: 16384,
  customMiddleware: [
    myCustomMiddleware(),
    anotherMiddleware(),
  ],
});
const chain = this.createChain();
chain.useMiddlewareStack(stack);
```

### Parameters
```typescript
interface SmartSAROptions extends StandardSAROptions {
  customMiddleware?: ((ctx: ChainContext, next: () => Promise<void>) => Promise<void>)[];
}
```

**Inherits from StandardSAROptions:**
- `maxTokens`
- `reservedForResponse`
- `recentMessageCount`

**customMiddleware:** Array of Koa-style middlewares to add

### When to Use
- ✅ Need custom logging for domain
- ✅ Custom input validation
- ✅ Specialized output formatting
- ✅ Domain-specific behavior (e.g., refactoring stats)
- ❌ Simple agents (use standardSAR)
- ❌ Just changing token budget (use standardSAR options)

### Example: Custom Middleware
```typescript
// Domain-specific logging
const refactoryLogging = async (ctx: ChainContext, next: () => Promise<void>) => {
  console.log(`[refactory] Start: ${ctx.messages.length} messages`);
  console.log(`[refactory] Domain: ${ctx.ontology?.domain}`);
  
  await next(); // Run middleware stack
  
  const lastMsg = ctx.messages[ctx.messages.length - 1];
  console.log(`[refactory] Complete: response length ${lastMsg.content.length}`);
  console.log(`[refactory] Tokens used: ${ctx.budget.current}/${ctx.budget.max}`);
};

const stack = smartSAR({
  customMiddleware: [refactoryLogging],
});
```

### Example: Input Validation
```typescript
const validateMessages = async (ctx: ChainContext, next: () => Promise<void>) => {
  if (!ctx.messages || ctx.messages.length === 0) {
    throw new Error("No messages in context");
  }
  
  for (const msg of ctx.messages) {
    if (!msg.role || !msg.content) {
      throw new Error("Invalid message structure");
    }
  }
  
  await next();
};

const stack = smartSAR({
  customMiddleware: [validateMessages],
});
```

---

## Comparing the Templates

| Feature | quickSAR | standardSAR | smartSAR |
|---------|----------|------------|----------|
| Logging | ✅ | ✅ | ✅ |
| Ontology Resolve | ✅ | ✅ | ✅ |
| Ontology Inject | ❌ | ✅ | ✅ |
| Smart Trim | ❌ | ✅ | ✅ |
| Token Guard | ❌ | ✅ | ✅ |
| AI Tools | ✅ | ✅ | ✅ |
| Custom Middleware | ❌ | ❌ | ✅ |
| Recommended For | Learning | Production | Specialized |
| Lines Saved | 3-4 | 5-7 | 5-7 |
| Complexity | Very Low | Low | Medium |

---

## When to Add Custom Middleware

### Scenario 1: Domain-Specific Logging
```typescript
// Add detailed logging for a specific domain
const myLogging = async (ctx: ChainContext, next: () => Promise<void>) => {
  console.log(`[my-domain] Starting chain...`);
  console.log(`[my-domain] Target file: ${ctx.metadata?.targetFile}`);
  
  const start = Date.now();
  await next();
  const elapsed = Date.now() - start;
  
  console.log(`[my-domain] Completed in ${elapsed}ms`);
};
```

### Scenario 2: Input Validation
```typescript
// Validate user input before processing
const validateRefactorRequest = async (ctx: ChainContext, next: () => Promise<void>) => {
  const userMsg = ctx.messages.find(m => m.role === "user");
  if (!userMsg?.content) {
    throw new Error("No user request provided");
  }
  
  if (userMsg.content.length < 10) {
    throw new Error("Request too short (minimum 10 characters)");
  }
  
  await next();
};
```

### Scenario 3: Output Transformation
```typescript
// Transform or validate output before returning
const transformRefactorOutput = async (ctx: ChainContext, next: () => Promise<void>) => {
  await next();
  
  const assistantMsg = ctx.messages.find(m => m.role === "assistant");
  if (!assistantMsg) return;
  
  // Add refactoring metadata
  const lines = assistantMsg.content.split("\n").length;
  console.log(`Output: ${lines} lines, ${assistantMsg.content.length} chars`);
};
```

### Scenario 4: Token Management
```typescript
// Fine-grained token tracking
const tokenTracker = async (ctx: ChainContext, next: () => Promise<void>) => {
  const beforeTokens = ctx.budget.current;
  
  await next();
  
  const tokensUsed = ctx.budget.current - beforeTokens;
  const percent = Math.round((tokensUsed / ctx.budget.max) * 100);
  console.log(`Tokens: ${tokensUsed} used (${percent}% of budget)`);
};
```

---

## Custom Middleware Pattern (Koa-style)

Middleware in Ronin uses Koa-style async composition:

```typescript
type Middleware = (ctx: ChainContext, next: () => Promise<void>) => Promise<void>;
```

### Structure
```typescript
const myMiddleware: Middleware = async (ctx, next) => {
  // BEFORE: Run before next middleware
  console.log("Before:", ctx.messages.length);
  
  // NEXT: Call the rest of the stack
  await next();
  
  // AFTER: Run after next middleware returns
  console.log("After:", ctx.budget.current);
};
```

### Execution Order
```
Request → myMiddleware (before) → next() → tokenGuard → aiTools → [return]
                                    ↑
                            entire stack executes
                                    ↓
Response ← myMiddleware (after) ← [return]
```

### Modifying Context
```typescript
const myMiddleware: Middleware = async (ctx, next) => {
  // Modify before
  ctx.budget.max = 4096;
  
  await next();
  
  // Modify after
  const lastMsg = ctx.messages[ctx.messages.length - 1];
  lastMsg.content += "\n[Modified by myMiddleware]";
};
```

---

## Template Selection Decision Tree

```
Start: Need SAR middleware stack

Is this a test/learning?
├─ YES → Use quickSAR()
└─ NO → Do you need custom behavior?
    ├─ NO → Use standardSAR() ⭐
    └─ YES → Do you need to modify context during execution?
        ├─ NO → Just change standardSAR parameters
        └─ YES → Use smartSAR() with customMiddleware
```

---

## Troubleshooting

### "Token budget exceeded" error
- Reduce `maxTokens` in options (or increase if intentional)
- Increase `reservedForResponse` to see actual usage
- Check `recentMessageCount` (trim more aggressively)

### "Context not modified by middleware"
- Middleware runs in order, make sure you're not running AFTER the change you need
- Remember: custom middleware runs LAST (after standard stack)
- If you need to modify before standard processing, implement custom logic separately

### "Middleware not being called"
- Check it's added to `customMiddleware` array (not as part of stack)
- Remember to `await next()` or middleware chain stops
- Check for errors in middleware (try/catch for debugging)

### Performance issues
- Reduce `recentMessageCount` to trim more aggressively
- Lower `maxTokens` to prevent large responses
- Remove unnecessary ontology skills from `relevantSkills`

---

## Migration Guide

### From quickSAR to standardSAR
```typescript
// Before
const stack = quickSAR();

// After
const stack = standardSAR({ maxTokens: 8192 });
```

**Added:** Ontology injection, trimming, token guarding

### From quickSAR to smartSAR (with custom middleware)
```typescript
// Before
const stack = quickSAR();

// After
const stack = smartSAR({
  customMiddleware: [myCustomMiddleware],
});
```

**Added:** Ontology injection, trimming, token guarding, custom logic

### From standardSAR to smartSAR
```typescript
// Before
const stack = standardSAR({ maxTokens: 8192 });

// After
const stack = smartSAR({
  maxTokens: 8192,
  customMiddleware: [myCustomMiddleware],
});
```

**Added:** Custom middleware support

---

## Summary

| Template | Use Case | Setup Time | Complexity |
|----------|----------|-----------|-----------|
| **quickSAR()** | Testing, learning | < 1 min | Minimal |
| **standardSAR()** ⭐ | Production agents | < 1 min | Low |
| **smartSAR()** | Specialized agents | 2-5 min | Medium |

**Default:** Start with `standardSAR()`. Move to `smartSAR()` only if you need custom middleware.

**Next:** Read [TOOL_INTEGRATION_GUIDE.md](TOOL_INTEGRATION_GUIDE.md) to learn how to define tools.
