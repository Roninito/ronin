# Writing Duties

> See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the conceptual model (Tool /
> Skill / Duty, the SAR loop, event bus). This file is the practical "how do I
> write one" reference.

A **Duty** is the unit of work in Ronin — a class file that gets loaded,
optionally scheduled/watched/webhook-wired, and run. Duties live in the
`duties/` directory (default `./duties`, plus an external directory —
default `~/.ronin/duties`, overridable with `RONIN_EXTERNAL_DUTY_DIR` or
`ronin config --external-duty-dir`). Both are auto-discovered by `start`,
`run`, and `list`.

**Note on naming:** Ronin's Duty concept used to be called "Agent." The
directory (`agents/` → `duties/`) and core classes (`BaseAgent` → `BaseDuty`,
etc.) were renamed, but several existing duty files still carry their old
`*-agent.ts` names and class names (`duties/example-agent.ts`,
`duties/test-agent.ts`, `duties/tool-calling-agent.ts`, and others — see
`ARCHITECTURE.md` §4 for the full list). That's legacy naming debt, not a
second concept — they all `extends BaseDuty` like everything else here. Name
new duty files descriptively; don't use an `-agent` suffix.

Each duty file must:

1. Export a default class that extends `BaseDuty`
2. Implement the `execute()` method
3. Optionally define static properties for scheduling, file watching, or webhooks

## Basic Duty Structure

```typescript
import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";

export default class MyDuty extends BaseDuty {
  // Optional: Schedule using cron expression
  static schedule = "0 */6 * * *"; // Every 6 hours

  // Optional: Watch files for changes
  static watch = ["**/*.log", "data/**/*.json"];

  // Optional: HTTP webhook path
  static webhook = "/webhook/my-duty";

  constructor(api: DutyAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    // Your duty logic here
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

A duty's ID (the name you pass to `ronin run <id>`, `ronin schedule apply
<id>`, etc.) is its filename without the extension — `duties/my-duty.ts`
loads as `my-duty`.

**Route/event-only duties are valid.** A duty doesn't need `execute()` to do
anything meaningful — one that only registers HTTP routes or event listeners
in its constructor (and has a `webhook`, `schedule`, `watch`,
`onWebhook`, or `onFileChange`) is accepted by the loader.

### Advanced: declarative topology hints

A duty's static class can also declare `events: { in, out }`, `beams:
{target, eventType}[]`, and `queries: { out, served }`. These exist for
tooling (e.g. the dependency dashboard) to reason about which duties talk to
which — **they are purely declarative and have no runtime effect on their
own.** Wiring an actual listener still requires calling `api.events.on(...)`
yourself in the constructor.

## Available API

Duties receive an `api` object with the following capabilities:

### `api.ai`
- `complete(prompt, options?)` - Get AI completion (routed to the configured tier/model)
- `stream(prompt, options?)` - Stream AI responses
- `chat(messages, options?)` - Chat with messages
- `callTools(prompt, tools, options?)` - Tool-calling loop. **`tools` is exactly
  what the model sees — nothing gets added automatically.** If you want plugin
  tools included, pass `api.tools.getSchemas()` (or a filtered subset of it)
  yourself. See `ARCHITECTURE.md` §7.1 for why (a prior version silently
  injected every plugin tool into every call regardless of what you passed).

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
- `registerRoute(path, handler)` - Register an HTTP route this duty serves

### `api.events`
- `emit(event, data, source)` - Emit an event (source is required, e.g. duty name)
- `on(event, handler)` - Listen to events
- `off(event, handler)` - Remove event listener

There is no built-in dispatcher that routes events to a "correct" duty —
cross-duty coordination is entirely by convention: two duties agree on an
event name (e.g. `PlanProposed`/`PlanApproved`, see `ARCHITECTURE.md` §6.2)
and each independently emits/listens for it. When using tool-enabled chat or
`callTools`, the AI can emit events via the `local.events.emit` tool. The
event `source` defaults to `"ai"` unless the AI passes `source` in the tool
args or the caller passes `metadata: { dutyName: "..." }` in the tool context.

### `api.plugins`
- `call(pluginName, method, ...args)` - Call a plugin method
- `has(pluginName)` - Check if plugin is loaded
- `list()` - List all loaded plugins

Every plugin method is also auto-registered as a model-callable tool
(`<pluginName>_<methodName>`, generic schema unless the plugin declares
`toolMetadata`) — see `ARCHITECTURE.md` §7.1. Chat discovers these lazily via
`local.tools.load_category(category)` rather than seeing all ~186 of them
upfront; a duty calling `api.ai.callTools()` directly can just pass the
specific ones it wants from `api.tools.getSchemas()`.

### Plugin Direct APIs

Plugins with type-safe direct accessors on `DutyAPI` today:

- `api.git.*` - Git operations
- `api.shell.*` - Shell commands
- `api.scrape.*` - Web scraping
- `api.torrent.*` - Torrent management
- `api.telegram.*` - Telegram Bot API
- `api.discord.*` - Discord Bot API
- `api.langchain.*` - LangChain integration (including `runAgent`, a real
  LangChain tool-calling `AgentExecutor` — the one place "agent" names an
  actual distinct concept rather than a legacy label for Duty)
- `api.realm.*` - WebRTC/WebSocket remote-access relay (call-sign based; see
  `plugins/realm.ts`)
- `api.reticulum.*` - Reticulum mesh networking (radio/LAN/wide-area)
- `api.email.*` - Email management

Everything else (Notion, Obsidian, Cloudflare, MCP, model-selector, etc.) is
reached via the generic `api.plugins.call(pluginName, method, ...args)`.

**Example (direct APIs):**
```typescript
async execute(): Promise<void> {
  const status = await this.api.git?.status();
  await this.api.shell?.exec("ls", ["-la"]);

  const botId = await this.api.telegram?.initBot("YOUR_TOKEN");
  await this.api.telegram?.sendMessage(botId, "@channel", "Hello!");
}
```

See [docs/PLUGINS.md](docs/PLUGINS.md) for complete plugin documentation.

### Data formats

For token-efficient duty memory snapshots, context dumps, and
ontology-friendly aggregation, see [docs/RONIN_SCRIPT.md](docs/RONIN_SCRIPT.md).
Ronin Script integrates with `api.memory` and the ontology (reference docs
and tools are synced via `ronin doctor ingest-docs`).

### A note on "AgentSkills"

Skills discovery (`ronin skills list/discover/explore/use`) follows
Anthropic's external **Agent Skills** spec (`SKILL.md` + scripts) — that's a
third-party name for a markdown-skill format, unrelated to whether Ronin
calls its own units of work "Duty" or "Agent." Don't read "AgentSkills" as
evidence that Ronin has an internal Agent concept distinct from Duty; it
doesn't (see `ARCHITECTURE.md` §2).

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

When a duty defines a `static webhook` path, it will receive HTTP POST requests at that path. The webhook server runs on port 3000 by default (configurable via `WEBHOOK_PORT` environment variable).

## Standard header bar (HTML UIs)

For duty-served HTML pages, use the shared header bar so all UIs look consistent. Import `getHeaderBarCSS` and `getHeaderHomeIconHTML` from `../src/utils/theme.js`; include the CSS in your page `<style>` and the home icon as the first child of `.header`. Structure:

- Wrapper: `<div class="header">`
- First child: `${getHeaderHomeIconHTML()}` (lime green home icon linking to `/`)
- Left: `<h1>Page Title</h1>`
- Right (optional): `<div class="header-meta">...</div>` for text/status, or `<div class="header-actions">...</div>` for buttons/links

Example: `<div class="header">${getHeaderHomeIconHTML()}<h1>Ronin Analytics</h1><div class="header-meta"><span>Updated 1m ago</span></div></div>`. Keep the header full-width (no body padding); use a `.page-content` or `.container` with max-width and padding for the main content below.
