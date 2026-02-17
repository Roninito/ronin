# Writing Agents

Agents are TypeScript/JavaScript class files placed in the `agents/` directory. Each agent must:

1. Export a default class that extends `BaseAgent`
2. Implement the `execute()` method
3. Optionally define static properties for scheduling, file watching, or webhooks

## Basic Agent Structure

```typescript
import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

export default class MyAgent extends BaseAgent {
  // Optional: Schedule using cron expression
  static schedule = "0 */6 * * *"; // Every 6 hours
  
  // Optional: Watch files for changes
  static watch = ["**/*.log", "data/**/*.json"];
  
  // Optional: HTTP webhook path
  static webhook = "/webhook/my-agent";

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    // Your agent logic here
    // Access API via this.api
    const response = await this.api.ai.complete("Hello!");
    await this.api.memory.store("key", response);
  }

  // Optional: Handle file changes
  async onFileChange(path: string, event: "create" | "update" | "delete"): Promise<void> {
    console.log(`File ${event}: ${path}`);
  }

  // Optional: Handle webhook requests
  async onWebhook(payload: unknown): Promise<void> {
    console.log("Webhook received:", payload);
  }
}
```

## Available API

Agents receive an `api` object with the following capabilities:

### `api.ai`
- `complete(prompt, options?)` - Get AI completion from Ollama
- `stream(prompt, options?)` - Stream AI responses
- `chat(messages, options?)` - Chat with messages

### `api.memory`
- `store(key, value)` - Store a value
- `retrieve(key)` - Retrieve a value
- `search(query, limit?)` - Search memories by text
- `addContext(text, metadata?)` - Add context text
- `getRecent(limit?)` - Get recent memories
- `getByMetadata(metadata)` - Get memories by metadata

### `api.files`
- `read(path)` - Read a file
- `write(path, content)` - Write a file
- `list(dir, pattern?)` - List files in directory
- `watch(pattern, callback)` - Watch files for changes

### `api.db`
- `query<T>(sql, params?)` - Execute SELECT query
- `execute(sql, params?)` - Execute INSERT/UPDATE/DELETE
- `transaction(fn)` - Execute in transaction

### `api.http`
- `get(url, options?)` - Make GET request
- `post(url, data, options?)` - Make POST request

### `api.events`
- `emit(event, data, source)` - Emit an event (source is required, e.g. agent name)
- `on(event, handler)` - Listen to events
- `off(event, handler)` - Remove event listener

When using tool-enabled chat or `callTools`, the AI can emit events via the `local.events.emit` tool. The event `source` defaults to `"ai"` unless the AI passes `source` in the tool args or the caller passes `metadata: { agentName: "..." }` in the tool context.

### `api.plugins`
- `call(pluginName, method, ...args)` - Call a plugin method
- `has(pluginName)` - Check if plugin is loaded
- `list()` - List all loaded plugins

### Plugin Direct APIs

Many plugins have direct API access for type-safe usage:

- `api.git.*` - Git operations
- `api.shell.*` - Shell commands
- `api.scrape.*` - Web scraping
- `api.torrent.*` - Torrent management
- `api.telegram.*` - Telegram Bot API
- `api.discord.*` - Discord Bot API
- `api.langchain.*` - LangChain integration
- `api.rag.*` - RAG (Retrieval-Augmented Generation) for document storage and semantic search
- `api.email.*` - Email management

**Example with RAG:**
```typescript
async execute(): Promise<void> {
  // Initialize RAG namespace
  await this.api.rag?.init("my-docs");
  
  // Add documents
  await this.api.rag?.addDocuments("my-docs", [
    { content: "Document content here..." }
  ]);
  
  // Query with RAG
  const result = await this.api.rag?.query("my-docs", "What is this about?", {}, this.api);
  console.log(result.response);
}
```

See [docs/PLUGINS.md](docs/PLUGINS.md) for complete plugin documentation and [docs/RAG.md](docs/RAG.md) for RAG-specific documentation.

## Cron Schedule Format

> 📖 **For a comprehensive guide with detailed examples, tables, and troubleshooting, see [CRON_SCHEDULING.md](docs/CRON_SCHEDULING.md)**

Cron expressions use the format: `minute hour day month weekday`

- `*` - Every value
- `*/N` - Every N (e.g., `*/6` means every 6)
- `N` - Specific value

Examples:
- `"* * * * *"` - Every minute
- `"0 */6 * * *"` - Every 6 hours
- `"0 9 * * 1-5"` - Every weekday at 9 AM
- `"0 0 1 * *"` - First day of every month at midnight

## File Watching

Use glob patterns to watch files:
- `"**/*.log"` - All .log files recursively
- `"data/**/*.json"` - All .json files in data directory
- `"config.json"` - Specific file

## Webhooks

When an agent defines a `static webhook` path, it will receive HTTP POST requests at that path. The webhook server runs on port 3000 by default (configurable via `WEBHOOK_PORT` environment variable).

## Standard header bar (HTML UIs)

For agent-served HTML pages, use the shared header bar so all UIs look consistent. Import `getHeaderBarCSS` and `getHeaderHomeIconHTML` from `../src/utils/theme.js`; include the CSS in your page `<style>` and the home icon as the first child of `.header`. Structure:

- Wrapper: `<div class="header">`
- First child: `${getHeaderHomeIconHTML()}` (lime green home icon linking to `/`)
- Left: `<h1>Page Title</h1>`
- Right (optional): `<div class="header-meta">...</div>` for text/status, or `<div class="header-actions">...</div>` for buttons/links

Example: `<div class="header">${getHeaderHomeIconHTML()}<h1>Ronin Analytics</h1><div class="header-meta"><span>Updated 1m ago</span></div></div>`. Keep the header full-width (no body padding); use a `.page-content` or `.container` with max-width and padding for the main content below.

