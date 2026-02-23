# Tool Integration Guide

## Overview

Tools in Ronin are defined once using `UnifiedToolInterface` and work seamlessly across:
- **SAR** (Semantic Agent Runtime) — Primary execution engine
- **LangChain** — For specialized multi-state workflows
- **Ontology** — For knowledge discovery and semantic search

This guide explains how to define, register, and use tools consistently across all systems.

---

## Tool Definition: UnifiedToolInterface

All tools implement `UnifiedTool`, a single interface used everywhere.

### Basic Structure
```typescript
import { UnifiedTool } from "../src/tools/UnifiedToolInterface.js";

const myTool: UnifiedTool = {
  id: "my.tool.name",
  name: "Human-Readable Name",
  description: "What this tool does",
  parameters: [
    {
      name: "param1",
      type: "string",
      description: "What param1 does",
      required: true,
    },
    {
      name: "param2",
      type: "number",
      description: "What param2 does",
      required: false,
      default: 10,
    },
  ],
  execute: async (params, context) => {
    // Implement tool logic here
    return {
      success: true,
      data: { /* results */ },
    };
  },
};
```

### Field Specifications

**Tool ID (required)**
- Format: `namespace.tool.name` (lowercase, dots)
- Example: `files.read`, `shell.exec`, `skill.list`
- Used for: Discovery in ontology, logging, tool calling

**Name (required)**
- Human-readable display name
- Example: "Read File", "Execute Shell Command"

**Description (required)**
- 1-2 sentences explaining what the tool does
- Used by LLM for understanding tool purpose
- Example: "Read the contents of a file on disk"

**Parameters (required, can be empty [])**
- Array of `ToolParameter` objects
- Each parameter has: `name`, `type`, `description`, `required`, optional `default`
- Types: `"string"`, `"number"`, `"boolean"`, `"array"`, `"object"`

**Execute (required)**
- Async function taking `(params, context)` → `Promise<ToolResult>`
- `params`: Object with keys matching parameter names
- `context`: `ToolContext` with access to agent API
- Return: `{ success: boolean, data?: any, error?: string }`

---

## Example: Complete Tool

```typescript
import { UnifiedTool } from "../src/tools/UnifiedToolInterface.js";

export const readFileTool: UnifiedTool = {
  id: "files.read",
  name: "Read File",
  description: "Read the contents of a file on disk",
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Absolute path to the file",
      required: true,
    },
    {
      name: "encoding",
      type: "string",
      description: 'File encoding (default: "utf-8")',
      required: false,
      default: "utf-8",
    },
  ],
  execute: async (params, context) => {
    try {
      const fs = require("fs").promises;
      const content = await fs.readFile(params.path, params.encoding);
      return {
        success: true,
        data: {
          path: params.path,
          encoding: params.encoding,
          content,
          lines: content.split("\n").length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to read ${params.path}: ${error.message}`,
      };
    }
  },
};
```

---

## Tool Registry: Discovery & Listing

The `UnifiedToolRegistry` helps discover available tools:

```typescript
import { UnifiedToolRegistry } from "../src/tools/UnifiedToolInterface.js";

const registry = new UnifiedToolRegistry();
registry.register(readFileTool);
registry.register(writeFileTool);
registry.register(listDirTool);

// List all tools
const allTools = registry.listTools();

// Get specific tool
const tool = registry.getTool("files.read");

// Filter by domain
const fileTools = registry.filterByDomain("files");
```

---

## Tool Context: What Tools Can Access

When a tool's `execute()` is called, it receives a `ToolContext`:

```typescript
interface ToolContext {
  agentName: string;           // Name of calling agent
  api: AgentAPI;               // Full agent API
  chainId: string;             // Current chain ID
  metadata?: Record<string, any>;  // Custom metadata
}
```

**Use API in your tool:**
```typescript
execute: async (params, context) => {
  // Access agent services
  const { api } = context;
  
  // Read files
  if (api.files) {
    const content = await api.files.read(params.path);
  }
  
  // Execute shell
  if (api.shell) {
    const result = await api.shell.exec(params.command);
  }
  
  // Store memory
  if (api.memory) {
    await api.memory.store(`result_${params.path}`, content);
  }
  
  // Query ontology
  if (api.ontology) {
    const entities = await api.ontology.search(params.query);
  }
  
  // ... more API access ...
}
```

---

## Tool Parameters: Type System

### Supported Types

**String**
```typescript
{
  name: "query",
  type: "string",
  description: "Search query",
  required: true,
}
```

**Number**
```typescript
{
  name: "timeout",
  type: "number",
  description: "Timeout in milliseconds",
  required: false,
  default: 5000,
}
```

**Boolean**
```typescript
{
  name: "recursive",
  type: "boolean",
  description: "Search recursively",
  required: false,
  default: false,
}
```

**Array**
```typescript
{
  name: "patterns",
  type: "array",
  description: "File patterns to match",
  required: true,
}
```

**Object**
```typescript
{
  name: "config",
  type: "object",
  description: "Configuration object",
  required: false,
}
```

### Parameter Validation
Tools should validate parameters internally:

```typescript
execute: async (params, context) => {
  // Validate
  if (!params.path) {
    return {
      success: false,
      error: "path parameter is required",
    };
  }
  
  if (typeof params.timeout !== "number") {
    return {
      success: false,
      error: "timeout must be a number",
    };
  }
  
  // ... execute ...
}
```

---

## Tool Results: Success and Error Handling

All tools return `ToolResult`:

```typescript
interface ToolResult {
  success: boolean;        // True if execution succeeded
  data?: unknown;          // Result data (if success)
  error?: string;          // Error message (if failed)
  details?: Record<string, any>;  // Additional metadata
}
```

### Success Response
```typescript
return {
  success: true,
  data: {
    filePath: "/path/to/file",
    lineCount: 42,
    content: "file contents...",
  },
};
```

### Error Response
```typescript
return {
  success: false,
  error: "File not found: /path/to/file",
};
```

### With Metadata
```typescript
return {
  success: true,
  data: { result: 42 },
  details: {
    executionTimeMs: 123,
    tokensUsed: 50,
    cacheHit: true,
  },
};
```

---

## Registering Tools with Ontology

Tools are discovered via the ontology. Register tools in your agent's ontology entry:

```typescript
export const myAgentOntology = {
  id: "my.agent",
  name: "My Agent",
  skills: [
    {
      id: "files.read",
      tool: readFileTool,
    },
    {
      id: "files.write",
      tool: writeFileTool,
    },
    {
      id: "shell.exec",
      tool: shellExecTool,
    },
  ],
};
```

**Discovery:** SAR middleware automatically:
1. Finds tools via ontology
2. Filters to `relevantSkills`
3. Makes them available to LLM for calling

---

## Using Tools in SAR Chains

Tools are called automatically by the SAR middleware. Just include them in ontology:

```typescript
const ctx: ChainContext = {
  messages: [
    { role: "system", content: "You are a code assistant with file access" },
    { role: "user", content: "Read the README.md file" },
  ],
  ontology: {
    domain: "code",
    relevantSkills: ["files.read", "files.write"],  // Tools available
  },
  budget: { max: 8192, current: 0, reservedForResponse: 512 },
};

const stack = standardSAR();
const chain = this.createChain();
chain.useMiddlewareStack(stack);
chain.withContext(ctx);
await chain.run();

// LLM automatically calls files.read if needed
```

---

## Tool Development Best Practices

### 1. Clear, Specific IDs
❌ Bad: `my_tool`, `tool1`, `do_something`  
✅ Good: `files.read`, `shell.exec`, `code.format`

### 2. Comprehensive Descriptions
❌ Bad: "Does stuff"  
✅ Good: "Execute a shell command and return stdout/stderr. Supports bash, zsh, fish. Times out after 30s."

### 3. Error Handling
```typescript
execute: async (params, context) => {
  try {
    // Implementation
  } catch (error) {
    return {
      success: false,
      error: `Operation failed: ${error.message}`,
      details: { errorType: error.constructor.name },
    };
  }
}
```

### 4. Logging for Debugging
```typescript
execute: async (params, context) => {
  console.log(`[${context.agentName}] Calling ${toolId} with:`, params);
  try {
    const result = await doWork(params);
    console.log(`[${context.agentName}] ${toolId} succeeded:`, result);
    return { success: true, data: result };
  } catch (error) {
    console.error(`[${context.agentName}] ${toolId} failed:`, error);
    return { success: false, error: error.message };
  }
}
```

### 5. Timeout Safety
```typescript
execute: async (params, context) => {
  const timeout = params.timeout || 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const result = await operation({ signal: controller.signal });
    return { success: true, data: result };
  } finally {
    clearTimeout(timeoutId);
  }
}
```

### 6. Input Validation
```typescript
execute: async (params, context) => {
  // Validate required params
  if (!params.query) {
    return { success: false, error: "query is required" };
  }
  
  // Validate types
  if (typeof params.limit !== "number") {
    return { success: false, error: "limit must be a number" };
  }
  
  // Validate ranges
  if (params.limit < 1 || params.limit > 100) {
    return { success: false, error: "limit must be 1-100" };
  }
  
  // Safe to proceed
}
```

---

## Testing Tools

### Unit Test Example
```typescript
import { describe, it, expect } from "bun:test";
import { readFileTool } from "./my-tools.js";

describe("readFileTool", () => {
  it("reads file successfully", async () => {
    const result = await readFileTool.execute(
      { path: "/tmp/test.txt", encoding: "utf-8" },
      { agentName: "test", api: {}, chainId: "test" }
    );
    
    expect(result.success).toBe(true);
    expect(result.data.content).toBeDefined();
  });
  
  it("returns error for missing file", async () => {
    const result = await readFileTool.execute(
      { path: "/nonexistent/file.txt" },
      { agentName: "test", api: {}, chainId: "test" }
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

---

## Migration: From Raw Functions to UnifiedTool

### Before
```typescript
// Scattered across multiple files
async function readFile(path) {
  return fs.readFileSync(path, "utf-8");
}

// Called directly
const content = await readFile(params.path);
```

### After
```typescript
// Single definition
const readFileTool: UnifiedTool = {
  id: "files.read",
  name: "Read File",
  description: "Read file contents",
  parameters: [{ name: "path", type: "string", required: true }],
  execute: async (params, context) => {
    try {
      const content = await fs.promises.readFile(params.path);
      return { success: true, data: { content } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },
};

// Registered once
registry.register(readFileTool);

// Called via ontology
// (SAR middleware handles it automatically)
```

**Benefits:**
- One definition, used by SAR + LangChain + ontology
- Clear error handling
- Consistent interface
- Discoverable in registry

---

## Tool Categories

### File Operations
- `files.read`
- `files.write`
- `files.delete`
- `files.list`

### Shell Operations
- `shell.exec`
- `shell.background`

### Knowledge Operations
- `ontology.search`
- `memory.store`
- `memory.retrieve`

### Skill Operations
- `skills.list`
- `skills.run`

### API Operations
- (Custom per integration)

---

## FAQ

**Q: Can I use async/await in tool execute?**  
A: Yes, execute is async and can await operations.

**Q: What if my tool needs configuration?**  
A: Pass via parameters or ToolContext.metadata.

**Q: Can tools call other tools?**  
A: Yes, via context.api (but avoid circular dependencies).

**Q: How do I timeout a tool?**  
A: Use AbortController or setTimeout pattern (see examples).

**Q: Can I use the same tool in SAR and LangChain?**  
A: Yes, that's the point of UnifiedToolInterface.

**Q: What happens if a tool fails?**  
A: Return `{ success: false, error: "message" }`. SAR middleware will handle gracefully.

---

## Summary

1. **Define** tools using `UnifiedTool`
2. **Register** with `UnifiedToolRegistry` or ontology
3. **Use** in SAR chains (middleware calls automatically)
4. **Error handling** always return `ToolResult`
5. **Testing** write unit tests for each tool

**Next:** Read [SAR_BEST_PRACTICES.md](SAR_BEST_PRACTICES.md) to learn how to use tools in agents.
