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
- `emit(event, data)` - Emit an event
- `on(event, handler)` - Listen to events
- `off(event, handler)` - Remove event listener

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

