# Ronin Hybrid Intelligence Architecture

## Overview

Ronin's Hybrid Intelligence system enables local AI orchestration with selective cloud delegation. The local LLM (Ollama) remains the orchestrator while delegating specialized tasks to cloud models when necessary.

**Key Principles:**
- **Sovereignty First**: All orchestration logic remains local
- **AI Agnostic**: No hard dependency on any single provider
- **Tool-Based Delegation**: Cloud models are tools, not authorities
- **Policy Governed**: All cloud calls pass through cost estimation and validation
- **Swappable**: Every Ronin instance can use different providers or run offline

## Architecture

```
User Query
    ↓
Local Ollama Model (Orchestrator)
    ↓
Tool Router
    ↓
├─ Local Tools (memory, files, shell, reasoning)
├─ MCP Tools (filesystem, web search, github, sqlite)
├─ Cloud Tools (research, vision, image-gen via OpenAI/Anthropic)
└─ Agent Tools (WebResearcher, custom agents)
    ↓
Results Aggregated
    ↓
Local Model Finalizes Response
```

## Quick Start

### 1. Basic Tool Usage

```typescript
// In any agent
const result = await this.api.tools.execute(
  "local.memory.search",
  { query: "AI agents", limit: 5 }
);

if (result.success) {
  console.log(result.data);
}
```

### 2. Tool-Enabled Chat

```typescript
import { toolChat } from "../src/tools/ToolChat.js";

const result = await toolChat(
  this.api,
  [{ role: "user", content: "Research the latest Bun.js features" }],
  { enableTools: true }
);

console.log(result.response);
console.log("Tools used:", result.toolCalls.map(tc => tc.name));
console.log("Cost:", result.cost);
```

### 3. Using Workflows

```typescript
// Run a pre-built workflow
const result = await this.api.tools.executeWorkflow(
  "research-and-visualize",
  { topic: "AI agents", depth: 2 },
  { conversationId: "chat-123" }
);
```

### 4. Agent as Tool Provider

```typescript
// In your agent's onMount()
this.api.tools.register({
  name: "agent.MyAgent.capability",
  description: "Does something useful",
  parameters: {
    type: "object",
    properties: {
      input: { type: "string" }
    }
  },
  provider: "agent.MyAgent",
  handler: async (args, context) => {
    // Your implementation
    return { success: true, data: result };
  },
  riskLevel: "low",
  cacheable: true
});
```

## Available Tools

### Local Tools

| Tool | Description | Risk Level |
|------|-------------|------------|
| `local.memory.search` | Search Ronin's memory | Low |
| `local.file.read` | Read files from disk | Medium |
| `local.file.list` | List directory contents | Low |
| `local.shell.safe` | Execute safe shell commands | Medium |
| `local.http.request` | Make HTTP requests | Low |
| `local.reasoning` | Local LLM reasoning | Low |

### Cloud Tools (requires API keys)

| Tool | Description | Provider |
|------|-------------|----------|
| `cloud.research` | Web research and summarization | OpenAI |
| `cloud.image.generate` | Generate images from prompts | OpenAI (DALL-E) |
| `cloud.vision.analyze` | Analyze images | OpenAI (GPT-4V) |
| `cloud.audio.transcribe` | Speech-to-text | OpenAI (Whisper) |
| `cloud.audio.synthesize` | Text-to-speech | OpenAI (TTS) |
| `cloud.reasoning` | Advanced reasoning with large models | OpenAI |

### Agent Tools

| Tool | Description | Provider |
|------|-------------|----------|
| `agent.WebResearcher.research` | Deep web research | WebResearcherAgent |
| `agent.WebResearcher.summarize` | Text summarization | WebResearcherAgent |

### MCP Tools

MCP (Model Context Protocol) tools are provided by external MCP servers. These tools are dynamically registered when MCP servers are enabled.

**Tool Naming**: `mcp_<server>_<tool>`

**Filesystem Server** (`mcp_filesystem_*`):
- `mcp_filesystem_read_file` - Read file contents
- `mcp_filesystem_write_file` - Write file contents
- `mcp_filesystem_list_directory` - List directory contents
- `mcp_filesystem_create_directory` - Create directories
- `mcp_filesystem_delete_file` - Delete files

**Web Search Server** (`mcp_brave-search_*`):
- `mcp_brave-search_web_search` - Search the web via Brave Search API

**GitHub Server** (`mcp_github_*`):
- `mcp_github_create_issue` - Create GitHub issues
- `mcp_github_create_pull_request` - Create pull requests
- `mcp_github_list_repositories` - List repositories
- `mcp_github_get_file_contents` - Get file contents from repos

**SQLite Server** (`mcp_sqlite_*`):
- `mcp_sqlite_query` - Execute SQL queries
- `mcp_sqlite_list_tables` - List database tables
- `mcp_sqlite_describe_table` - Get table schema

**Setup**: See [MCP.md](./MCP.md) for configuration and usage.

**Example**:
```typescript
// Use MCP filesystem tool
const files = await this.api.tools.execute(
  "mcp_filesystem_list_directory",
  { path: "/tmp" }
);

// Use MCP web search tool
const results = await this.api.tools.execute(
  "mcp_brave-search_web_search",
  { query: "Bun.js features 2026", count: 10 }
);
```

## Workflows

Pre-built multi-step workflows:

### 1. Research and Visualize
```typescript
{
  name: "research-and-visualize",
  steps: [
    { tool: "cloud.research", input: { query: "$args.topic" } },
    { tool: "cloud.image.generate", input: { prompt: "Diagram: $research.summary" } }
  ]
}
```

### 2. Code Review
Analyzes code for bugs, security issues, and improvements.

### 3. Create Documentation
Researches topic and creates comprehensive docs.

### 4. Analyze Data
Fetches data from APIs, analyzes, and visualizes.

### 5. Investigate Bug
Checks logs, code, and generates fix suggestions.

### 6. Create Content
Creates blog posts/articles with research and SEO.

## Configuration

Add to your `~/.ronin/config.json`:

```json
{
  "tools": {
    "enabled": true,
    "policies": {
      "maxMonthlyCost": 50.00,
      "maxDailyCost": 5.00,
      "maxPerToolCost": 2.00,
      "tools": {
        "cloud.image.generate": {
          "requireConfirmation": true
        },
        "cloud.reasoning": {
          "maxCallsPerHour": 10
        }
      }
    }
  },
  "cloud": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "defaultModel": "gpt-4",
      "models": {
        "research": "gpt-4",
        "vision": "gpt-4-vision-preview",
        "image": "dall-e-3"
      }
    }
  }
}
```

## Cost Tracking

Monitor tool usage costs:

```typescript
// Get current stats
const stats = this.api.tools.getCostStats();
console.log(`Daily: $${stats.daily}, Monthly: $${stats.monthly}`);

// Get detailed report (from ToolAnalyticsAgent)
const report = await toolAnalyticsAgent.getCostReport(30);
console.log(`Total: $${report.totalCost}`);
```

## Policy Enforcement

Automatic policies protect against runaway costs:

- **Cost Limits**: Max daily/monthly/per-tool spending
- **Rate Limits**: Max calls per hour/day per tool
- **Confirmation Required**: High-cost tools can require user confirmation
- **Context Restrictions**: Limit tools to specific contexts (chat, agent, etc.)

## Creating Custom Tools

```typescript
// Register a custom tool
this.api.tools.register({
  name: "custom.myTool",
  description: "What my tool does",
  parameters: {
    type: "object",
    properties: {
      param1: { type: "string" },
      param2: { type: "number", default: 10 }
    },
    required: ["param1"]
  },
  provider: "custom",
  handler: async (args, context) => {
    // Implementation
    return {
      success: true,
      data: { result: "success" },
      metadata: {
        toolName: "custom.myTool",
        provider: "custom",
        duration: 100,
        cached: false,
        timestamp: Date.now(),
        callId: context.conversationId
      }
    };
  },
  cost: {
    estimate: (args) => 0.01 // Estimated cost in USD
  },
  riskLevel: "low",
  cacheable: true,
  ttl: 3600 // Cache TTL in seconds
});
```

## Creating Custom Workflows

```typescript
import type { WorkflowDefinition } from "../src/tools/types.js";

const myWorkflow: WorkflowDefinition = {
  name: "my-workflow",
  description: "What this workflow does",
  steps: [
    {
      id: "step1",
      tool: "local.memory.search",
      input: { query: "$args.topic" },
      output: "searchResults"
    },
    {
      id: "step2",
      tool: "cloud.research",
      input: { query: "$searchResults[0].content" },
      output: "research",
      condition: "$searchResults.length > 0"
    },
    {
      id: "step3",
      tool: "local.reasoning",
      input: {
        prompt: "Synthesize findings",
        context: "$research.summary"
      }
    }
  ]
};

// Register it
this.api.tools.registerWorkflow(myWorkflow);

// Execute it
const result = await this.api.tools.executeWorkflow("my-workflow", { topic: "AI" });
```

## Tool Orchestrator Agent

The `ToolOrchestratorAgent` provides intelligent routing:

```typescript
// The orchestrator automatically selects tools based on query intent
const result = await toolOrchestrator.handleQuery(
  "Research the latest AI developments and create a summary",
  "conversation-123"
);

// Result includes:
// - response: Final AI response
// - toolsUsed: List of tools executed
// - cost: Total cost
// - duration: Execution time
```

Strategies automatically selected:
- **Research**: Uses web search and summarization
- **Code Analysis**: Reads files, checks patterns
- **File Operations**: Direct file manipulation
- **Memory**: Searches past conversations
- **Creation**: Research + content generation
- **Data Analysis**: HTTP requests + visualization

## Events

The tool system emits events for monitoring:

```typescript
// Tool called
this.api.events.on("tool.completed", (event) => {
  console.log(`${event.toolName}: ${event.success ? "success" : "failed"}`);
  if (event.cost) console.log(`Cost: $${event.cost}`);
});

// Policy violation
this.api.events.on("tool.policyViolation", (event) => {
  console.warn(`Policy violation: ${event.toolName} - ${event.reason}`);
});
```

## Offline Mode

Run completely offline (no cloud tools):

```bash
ronin start --offline
```

In offline mode:
- Cloud plugins are not registered
- Tool schema excludes cloud tools
- Only local tools available

## Architecture Components

### Core Components

1. **ToolRouter** (`src/tools/ToolRouter.ts`)
   - Tool registration and discovery
   - Policy enforcement
   - Cost tracking
   - Caching layer

2. **WorkflowEngine** (`src/tools/WorkflowEngine.ts`)
   - Multi-step workflow execution
   - Variable interpolation
   - Conditional steps

3. **CloudAdapter** (`src/tools/adapters/`)
   - Abstract base for cloud providers
   - OpenAIAdapter implementation
   - Extensible for Anthropic, Gemini, etc.

4. **ToolChat** (`src/tools/ToolChat.ts`)
   - High-level chat interface
   - Automatic tool selection
   - Conversation management

### Agents

1. **ToolOrchestratorAgent** (`agents/tool-orchestrator.ts`)
   - Smart query routing
   - Strategy selection
   - Conversation management

2. **ToolAnalyticsAgent** (`agents/tool-analytics.ts`)
   - Usage tracking
   - Cost reporting
   - Scheduled reports

3. **WebResearcherAgent** (`agents/web-researcher.ts`)
   - Example agent-as-tool-provider
   - Web research capabilities

## Best Practices

1. **Always check tool availability**:
   ```typescript
   if (this.api.tools.has("cloud.research")) {
     // Use cloud tool
   } else {
     // Fallback to local
   }
   ```

2. **Handle tool failures gracefully**:
   ```typescript
   const result = await this.api.tools.execute(...);
   if (!result.success) {
     // Try alternative or inform user
   }
   ```

3. **Use caching for expensive operations**:
   ```typescript
   cacheable: true,
   ttl: 3600 // 1 hour
   ```

4. **Provide good cost estimates**:
   ```typescript
   cost: {
     estimate: (args) => args.tokens * 0.00002
   }
   ```

5. **Set appropriate risk levels**:
   - `low`: Read-only operations
   - `medium`: File system, shell commands
   - `high`: Expensive cloud operations, destructive actions

## Troubleshooting

### Tool not found
```
Error: Tool 'cloud.research' not found
```
- Check if cloud provider is configured
- Verify API keys in config
- Check if offline mode is enabled

### Cost limit exceeded
```
Policy violation: Daily cost limit would be exceeded
```
- Adjust limits in config
- Review usage with ToolAnalyticsAgent

### Rate limit exceeded
```
Hourly rate limit exceeded for tool
```
- Wait before retrying
- Adjust rate limits in config
- Consider caching results

## Roadmap

### Phase 4 (Next)
- Additional cloud adapters (Anthropic, Gemini)
- Community tool marketplace
- Advanced analytics dashboard
- Distributed Ronin mesh support

### Phase 5 (Future)
- Autonomous budget management
- Capability-based tool selection
- Self-improving tool recommendations

## License

Part of the Ronin project. See main LICENSE file.
