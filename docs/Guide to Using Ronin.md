# A Guide to Using Ronin

If you’ve ever wished your automations behaved less like brittle scripts and more like a helpful teammate, Ronin is for you. It’s a Bun‑powered agent system where TypeScript/JavaScript agents can think (via AI), remember, schedule themselves, watch your files, expose web routes, and call your own tools. You write code; Ronin supplies the structure, the runtime, and the plumbing.

This guide is a long, comfortable tour of the system. We’ll start with the big ideas, then move into the practical flow of building and running agents. Along the way, we’ll talk about the “secret sauce” (plugins, memory, HTTP routes) and where the project is ripe for improvement. If you’re already familiar with the basics, skim the headings and stop where something sparks an idea.

---

## What Ronin Is (and Isn’t)

Ronin is a **framework for long‑running, scheduled, and event‑driven agents** written in TypeScript/JavaScript. It’s built on Bun, so it uses native features like cron, file watching, and HTTP serving. That means you can build an agent that:

- Runs hourly to fetch new data
- Watches a directory for changes
- Exposes a webhook or UI
- Calls AI tools when it needs to reason
- Remembers what it did yesterday

Ronin is **not** a full-blown app framework or a monolith. It’s a focused system that takes the recurring pieces of agent work — scheduling, memory, tool calling, hosting — and makes them consistent.

If you’ve used a task runner, a cron job, or a background worker, Ronin will feel familiar. The difference is that it treats intelligence as a first‑class feature and integrates it into the runtime instead of bolting it on later.

---

## The Mental Model: Agents, Memory, Tools, and Routes

At the heart of Ronin is the **agent**: a class that extends `BaseAgent` and implements `execute()`.

Agents can have:

- **Schedule**: cron expression like `0 * * * *`
- **Watch**: file patterns to react to changes
- **Webhook**: an HTTP endpoint to receive requests
- **Memory**: a persistent SQLite store for state and history
- **Plugins**: tools for shell, git, and your custom logic

Think of an agent as a job that can *wake up* for multiple reasons: time, file change, web request, or manual run. The runtime handles the wakeups; your code handles the behavior.

### Where Memory Lives

Ronin uses a shared SQLite database (`ronin.db`) to store:

- key/value memories
- conversation history
- per‑agent state

This is core system data, not agent‑specific files. For the schema and details, see [MEMORY_DB.md](./MEMORY_DB.md).

### Where Data Files Live

Some agents manage their own data files. For example, the Fishy agent keeps its database and tracking JSON in `~/.ronin/data`. The core idea is simple: **agent data belongs outside the repo** so you can update the code without dragging private or heavy data around. If you need details on a specific agent’s storage, look for its environment variables or read its header comments.

---

## A Quick Tour of the Project Structure

Here’s the mental map you’ll carry around:

- `src/` is the engine room: agent runtime, APIs, memory, plugins, CLI.
- `agents/` is your local, in‑repo agent folder.
- `~/.ronin/agents` is your external agent folder (loaded by default).
- `plugins/` is where tool extensions live.
- `docs/` is where you find guides, architecture, and reference docs.

You can see the system’s structure in the main README, but the short version is: **agents and plugins are meant to be swapped in and out without changing the core.**

---

## Your First Agent: From Idea to Running Code

Let’s make an agent that checks a log file every hour and keeps a short memory of what it saw. It’s a small example, but it’s enough to show how everything clicks together.

### 1) Create the Agent

You can use the AI‑assisted creator:

```bash
ronin create agent "scan a log file for errors and store a summary"
```

Or write one manually in `./agents` or `~/.ronin/agents`. Here’s a trimmed version:

```typescript
import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

export default class LogScanAgent extends BaseAgent {
  static schedule = "0 * * * *"; // hourly
  static watch = ["logs/**/*.log"]; // optional

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    const log = await this.api.files.read("logs/app.log");
    const errorLines = log
      .split("\n")
      .filter(line => line.toLowerCase().includes("error"));

    const summary = {
      timestamp: new Date().toISOString(),
      errors: errorLines.slice(-10),
    };

    await this.api.memory.store("latest_errors", summary);
    console.log("Stored error summary:", summary);
  }
}
```

If you want a deeper walkthrough on agent structure, read [AGENTS.md](../AGENTS.md).

### 2) Run It Manually

```bash
ronin run log-scan-agent
```

The runtime loads agents from `./agents` and `~/.ronin/agents` by default. If your agent name doesn’t show up, use `ronin list` to confirm it was discovered.

### 3) Start the Scheduler

```bash
ronin start
```

When running, Ronin starts the webhook server, watches files, and schedules agents based on their cron expressions.

If you’re new to cron, don’t guess — skim [CRON_SCHEDULING.md](./CRON_SCHEDULING.md).

---

## File Watching: React to Change Without Polling

File watchers turn your agent into a “listen and react” process:

```typescript
static watch = ["data/**/*.json", "logs/*.log"];

async onFileChange(path, event) {
  console.log(`File ${event}: ${path}`);
}
```

This is perfect for workflows like:

- Parse new reports as they land
- Trigger cleanup after a file is edited
- Update an index when new content is added

Think of `watch` as a lightweight alternative to a file system daemon. It’s built into the runtime; you only write the response.

---

## Webhooks and HTTP Routes

Ronin starts a webhook server on port 3000 by default. Agents can opt into webhooks or register custom routes.

### Webhooks (simple, one‑way)

Give your agent a static webhook path:

```typescript
static webhook = "/webhook/ingest";

async onWebhook(payload) {
  console.log("Received:", payload);
}
```

Now you can `POST` to `http://localhost:3000/webhook/ingest` and your agent will respond.

### Custom Routes (full control)

Agents can register routes via the HTTP API, which is how the Fishy agent provides a full web UI. The advantage is that you control the response and can serve HTML, JSON, or anything else:

```typescript
this.api.http.registerRoute("/hello", () => {
  return new Response("Hello from Ronin");
});
```

If you want to see all registered routes, `ronin listRoutes` (or `/api/routes`) will tell you. It’s a quick, delightful way to understand what’s live.

---

## Plugins: Your Agent’s Superpowers

Plugins are the tool system. They’re the bridge between “pure logic” and real operations like shell commands, git, databases, or anything you can express as a function.

Every plugin exports a name, a description, and a set of methods. For example, the built‑in `shell` plugin can run commands; the `git` plugin can read status and diffs.

To see what’s available:

```bash
ronin plugins list
```

To create your own:

```bash
ronin create plugin my-plugin
```

Then implement methods that do work and return JSON‑serializable results.

If you want a reference guide, see [PLUGINS.md](./PLUGINS.md).

---

## Tool Calling: Let AI Pick the Tools

This is the part that feels a little magical: you can give the AI a goal, and it can choose which plugin methods to use to achieve it. Ronin wraps plugin methods into “tools” that the AI can call.

Here’s what it looks like at a high level:

```typescript
const { toolCalls, message } = await this.api.ai.callTools(
  "Check git status and summarize any changes",
  []
);

for (const toolCall of toolCalls) {
  const [pluginName, methodName] = toolCall.name.split("_");
  const result = await this.api.plugins.call(pluginName, methodName, toolCall.args);
  // Use result in your agent logic
}
```

That’s a lot of power in a few lines. To learn the details, read [TOOL_CALLING.md](./TOOL_CALLING.md).

---

## AI Providers: Local and Remote

Ronin works beautifully with local models via Ollama, but it also supports remote AI providers (Grok and Gemini).

- Local: set `OLLAMA_URL` and `OLLAMA_MODEL`
- Remote: set API keys via env vars or `ronin config`

If you want remote AI setup, see [REMOTE_AI](./REMOTE_AI.md) and the CLI configuration section in [CLI.md](./CLI.md).

Also, if you’re running Ollama locally and want GPU help, [OLLAMA_GPU.md](./OLLAMA_GPU.md) is worth a look.

---

## Configuration: Keep It Predictable

Ronin supports two configuration styles:

1) **Environment variables** (great for CI or servers)
2) **Config file** (`~/.ronin/config.json`) managed by `ronin config`

For example:

```bash
ronin config --grok-api-key "sk-xxxxx"
ronin config --external-agent-dir ~/.ronin/agents
```

You can always check current settings:

```bash
ronin config --show
```

The docs that cover this in detail are [CLI.md](./CLI.md) and the README.

---

## Possibilities: What Agents Can Do

Once you understand the building blocks, you’ll see the system in a different light. Agents aren’t just cron jobs. They can be:

### 1) Team Assistants

- A “Daily Status” agent that reads Jira, Slack, and git logs and posts a summary.
- A “Release Guardian” agent that checks dependencies, tests, and changelogs.

### 2) Data Pipelines

- A “Data Harvest” agent that runs nightly, fetches, normalizes, and stores.
- A “Classifier” agent that adds labels or tags to new records.

### 3) Local Automations

- A “Workspace Hygiene” agent that cleans folders and archives old files.
- A “Media Processor” agent that converts and organizes assets.

### 4) Web‑Backed Tools

Because agents can register routes, you can build small internal tools without building a whole web app:

- A dashboard
- A lookup API
- A knowledge base

The Fishy agent is a working example of this idea. It’s a local agent that serves a web UI and API at `/fishy`.

---

## Plugin Improvement Ideas: The Road Ahead

Ronin’s plugin system is already useful, but it’s also a great place to evolve the core. If you’re thinking about improving the ecosystem, here are a few high‑value directions:

### 1) Schema‑Typed Tools

Right now, tools are described by name and a generic argument shape. A stronger schema system could:

- enforce argument types
- provide better tool descriptions to AI
- auto‑generate docs

This could be as simple as a JSON schema per method or as rich as TypeScript‑to‑schema generation.

### 2) Permissions and Sandboxing

Tool calls are powerful, and power wants guardrails. A permission system could let you:

- require approval for certain tools
- deny access to destructive actions
- apply scopes per agent

### 3) Testing Harnesses for Plugins

Plugins are code, so they deserve tests. A small testing harness could:

- mock `AgentAPI` resources
- provide fixture data
- make plugin development faster and safer

### 4) Tool Caching and Memoization

Some tools (like expensive HTTP calls) can benefit from caching. A first‑class cache layer could reduce cost and latency.

### 5) Observability

When agents call tools, you want to understand what happened:

- Which tools were called
- How long they took
- What succeeded or failed

Structured logging or a timeline view would make the system feel more transparent and professional.

### 6) Plugin Marketplace

Once the system matures, a curated list of plugins (or a registry) would allow teams to share capabilities without copying code.

This is more of a community idea than a core change, but it’s the kind of “growth multiplier” that turns a tool into a platform.

---

## Scheduling Strategies That Don’t Bite Back

Cron is powerful, but it can also be a source of accidental chaos. A few guidelines keep things sane:

### 1) Stagger Expensive Jobs

If you have multiple agents that hit APIs or process large datasets, don’t schedule them all at `0 * * * *`. Spread them out: `5 * * * *`, `15 * * * *`, `35 * * * *`. Your CPU will breathe a sigh of relief.

### 2) Use Short‑Run, Small‑Work Units

Agents that do a tiny bit of work repeatedly are easier to manage than giant jobs that run once a day. It’s like brushing your teeth: a little every day beats a dental emergency.

### 3) Guard Your Runs

Use memory to prevent duplicate work:

```typescript
const lastRun = await this.api.memory.retrieve("my_agent_last_run");
if (lastRun && Date.now() - Number(lastRun) < 5 * 60 * 1000) {
  return; // skip if too soon
}
await this.api.memory.store("my_agent_last_run", Date.now());
```

If you need more cron examples, [CRON_SCHEDULING.md](./CRON_SCHEDULING.md) is the canonical reference.

---

## Designing for Safety and Clarity

When your agents can run shell commands and write files, safety matters. A few habits help:

- **Be explicit about paths** (avoid relative surprises).
- **Log decisions, not just actions** (future you will be grateful).
- **Fail fast** on missing data or config.
- **Use read‑only dry‑runs** for anything destructive.

If you’re writing a plugin that can delete files or modify external systems, consider adding a `confirm` flag or a `dryRun` mode.

---

## When a Route Is Better Than a CLI

Sometimes the simplest way to surface an agent’s output is an HTTP route. If you have a set of data that you want to browse or filter, a tiny HTML view can be more useful than command‑line output.

The Fishy agent is a living example: it serves a polished HTML UI and JSON API from the same agent. That pattern — a local agent that exposes a miniature web UI — is one of the most compelling things Ronin enables.

If you want to see all routes in your running instance, use:

```bash
ronin listRoutes
```

---

## Practical Workflow: A Day in Ronin

Here’s a simple, repeatable workflow that works well for teams:

1) Create or update agents in `./agents` for project‑specific work.
2) Keep personal or shared agents in `~/.ronin/agents`.
3) Add plugins when you need reusable functionality.
4) Run `ronin list` to verify discovery.
5) Run `ronin start` to activate schedules and webhooks.
6) Use `/status` and `/api/status` to check runtime health.

This workflow keeps your codebase clean and your automation habits consistent.

---

## The Agent API Toolbox: What You Can Actually Do

Every agent receives an `api` object. Think of it as your Swiss Army knife. Here’s what’s inside, and where it shines:

### `api.ai`

Use it when you need reasoning, summarization, or tool calling. It supports chat‑style interactions as well as function calling. Good use cases:

- Summarize reports
- Draft emails or release notes
- Classify incoming data
- Decide which tool to use

See [REMOTE_AI](./REMOTE_AI.md) for provider setup, and [TOOL_CALLING.md](./TOOL_CALLING.md) for tool usage.

### `api.files`

Great for automations that touch the filesystem:

- Read and write content
- List directory contents
- Watch paths for changes

It’s the missing link between “intelligence” and “real world changes.”

### `api.db`

If your agent needs structured storage beyond `ronin.db`, the database API gives you simple query and execute helpers. Fishy uses this to manage its own SQLite database.

### `api.http`

Your agent can act as a client too. You can fetch data from APIs, call webhooks, or submit updates to other systems. This is the glue for integrating with the rest of your world.

### `api.memory`

This is where persistence becomes easy. It’s a shared store across agents and across runs, which makes it perfect for:

- Remembering last run timestamps
- Storing summaries
- Keeping user preferences

If you want to understand the underlying database, [MEMORY_DB.md](./MEMORY_DB.md) has the schema.

### `api.plugins`

This is how you call custom tools (or built‑ins) from within code. If you have logic that needs git status or shell execution, the plugin API turns that into a simple method call.

---

## Memory Patterns: Make State a Feature, Not a Bug

The difference between a smart agent and a clever script is memory. Here are a few patterns that work well in practice:

### 1) Last‑Run Checkpoints

Store the last run timestamp and only process new data. This prevents duplicates and keeps runtimes fast.

### 2) Summaries Over Raw Data

Don’t store raw payloads unless you need them. Store summaries, counts, or IDs. You’ll thank yourself later when you want to search memory.

### 3) Conversation History

If your agent interacts with a person, store the conversation. It makes follow‑up runs feel coherent rather than robotic.

---

## Building a Plugin: The Friendly Way

Plugins are just modules that export a name, description, and methods. What makes them useful is that **they can be called both directly and by AI**.

Here’s a tiny example of a plugin that returns the current time:

```typescript
const timePlugin = {
  name: "time",
  description: "Date/time utilities",
  methods: {
    now: async () => {
      return { iso: new Date().toISOString() };
    }
  }
};

export default timePlugin;
```

Drop it in `plugins/` and it’ll show up in `ronin plugins list`. If you want a deeper dive, [PLUGINS.md](./PLUGINS.md) is the official reference.

---

## AI Definitions: A Handy Local Registry

Ronin includes a simple CLI registry for AI model definitions stored at `~/.ronin/ai-models.json`.

Why is this useful? Because you can name models in human terms and run them consistently:

```bash
ronin ai add qwen3 --model qwen3:4b --description "Fast local model"
ronin ai list
ronin ai run qwen3
```

This is a small feature, but it’s a great example of how Ronin turns “a clever trick” into a repeatable workflow.

---

## Deployment and Daemons: Let It Run

Agents are meant to live. If you want Ronin to run in the background:

- On Linux, use `systemd`
- On macOS, use `launchd`
- On Windows, use Task Scheduler or NSSM

The README includes step‑by‑step instructions. The key detail: **environment variables aren’t loaded automatically** when you run as a daemon, so you’ll want to set them explicitly in your service definition.

---

## Debugging and Troubleshooting

When an agent doesn’t behave, start with the basics:

1) `ronin list` — Is the agent discovered?
2) `ronin status` — Is the system running?
3) `/api/status` — Does the server respond?
4) `ronin listRoutes` — Are HTTP routes registered?

If the issue involves file paths, remember the defaults:

- Local agents: `./agents`
- External agents: `~/.ronin/agents`
- Fishy data: `~/.ronin/data`

When in doubt, check [CLI.md](./CLI.md) and [AGENTS.md](../AGENTS.md).

---

## Design Philosophy: Why Ronin Feels Different

Most automation tools are either too low‑level (scripts) or too heavy (full frameworks). Ronin sits in the middle. It gives you structure without locking you in.

The core ideas are:

- **Small, focused agents**
- **Clear, predictable scheduling**
- **Memory as a first‑class feature**
- **Tools that can be called by code or AI**
- **Routes for when you need a UI**

In other words: Ronin is practical, not magical. But it leaves just enough room for magic when you want it.

---

## A Catalog of Agent Patterns

If you’re looking for ideas, here are patterns that show up again and again:

### 1) The Curator

Collects items, filters them, and stores the best ones. Examples: “top GitHub issues,” “high‑priority alerts,” “weekly highlights.”

### 2) The Janitor

Keeps things tidy: delete old files, archive logs, normalize names, purge caches.

### 3) The Messenger

Watches for events and sends notifications. Combine file watching, webhooks, and a messaging plugin, and you’ve built a polite but persistent nudge.

### 4) The Librarian

Builds and maintains a local database (like Fishy). These agents are slower to build but become lasting internal tools.

### 5) The Translator

Takes an input format and produces an output format. Reports to Markdown, raw data to JSON, logs to summaries. These agents are fantastic glue.

Each pattern is just a blend of the same ingredients: schedule, memory, tools, and routes.

---

## Next Steps and Where to Read More

If you only read one extra doc, start with:

- [AGENTS.md](../AGENTS.md) — agent structure and API overview

Then explore:

- [CLI.md](./CLI.md) — command reference
- [PLUGINS.md](./PLUGINS.md) — plugin development
- [TOOL_CALLING.md](./TOOL_CALLING.md) — AI tool calling
- [CRON_SCHEDULING.md](./CRON_SCHEDULING.md) — cron syntax
- [MEMORY_DB.md](./MEMORY_DB.md) — how memory is stored
- [OLLAMA_GPU.md](./OLLAMA_GPU.md) — local model performance
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system layout

Ronin is already a capable system, but the best part is that it’s yours. You can take it in any direction: personal automation, team productivity, or experimental AI workflows. The system won’t fight you — it will quietly show up every hour, watch your files, answer your webhooks, and keep its memory. That’s not a bad teammate to have around.


