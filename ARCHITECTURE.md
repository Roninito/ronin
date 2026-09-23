# Ronin Architecture

> **Status:** Canonical. This is the single source of truth for Ronin's
> conceptual model and current state. Where any other document disagrees
> with this one — including anything outside this repository — **this
> document wins**. Superseded material lives in `docs/history/`, labeled as
> historical record, never as current guidance. See §12.

---

## 1. The one idea

Everything in Ronin is a **Duty running the SAR loop**.

There is no separate "agent runtime," "plan engine," and "behavior tree" running
in parallel. There is one execution model — **SAR** (Sense → Act → Report)
— and every unit of work is an instance of it. Coordination, scheduling, and
planning are not other paradigms; they are Duties whose job happens to be
coordinating, scheduling, or planning *other* Duties.

```
            ┌──────────────────────── Duty ────────────────────────┐
            │                                                       │
  Sensors ──►  SENSE  ──►  ACT  ──►  REPORT  ──► (effects) ────────┤
            │    ▲                                    │             │
            │    └──────────────── loop ──────────────┘             │
            └───────────────────────────────────────────────────────┘
                         persona · tool allowlist · budget · memory
```

- **Sense** — poll inputs, dequeue jobs, and build the execution context (sensor id,
  event name, schedule tick, queue depth, job id, message window, workflow guidance).
- **Act** — do the work: reason, decide, call the model router, execute Tools/Skills/MCP,
  and record calls + results. `reasoning` is a sub-field of Act, never its own phase.
- **Report** — document, log, emit, and persist what was done. This phase is output-only:
  it never does new work. Every trace leaves a non-empty `report` artifact.

**There is no built-in Duty that assigns work to other Duties.** Duties
coordinate only by emitting and listening for events on the shared bus (§6).
"MNGR" is not an internal coordinating Duty — it's the name of a separate,
external application Ronin optionally talks to over HTTP. See §6 for exactly
what that integration is.

---

## 2. The three concepts

Ronin has **three first-class concepts.** Two are capabilities (the things a Duty
can invoke); one is the decider. Everything else is packaging, typing, or
engine-internal plumbing (§5).

| Concept | Definition | Was called |
|---------|------------|------------|
| **Tool** | An atomic, typed, in-process capability (Bun/TS). Single typed input → typed output. MCP-exportable. Hot-path, model-callable via function-calling. | plugin methods |
| **Skill** | A markdown-defined, declarative, **language-agnostic** capability. May be multi-step or out-of-process; can shell out to Python/shell, not just Bun. Discoverable via its manifest. | skills, techniques |
| **Duty** | A SAR loop instance with a persona, an allowlist of Skills + Tools, a budget, and memory. The thing that *decides*. (Formerly "Agent.") | agents |

The Tool/Skill split is the one capability boundary worth keeping: **Tool** =
fast, typed, in-runtime; **Skill** = portable, declarative, language-agnostic.

**technique was removed** (not deferred — deleted) because it was a third
synonym for Skill that bought nothing and, unlike Skill, couldn't cross
language boundaries. `src/techniques/` is gone; all authored `.technique`
files were converted to `SKILL.md` format; the `technique` CLI verb is gone.

### Supporting structure (not capability concepts)

| Concept | Definition |
|---------|------------|
| **Tool Pack** | A namespaced bundle of Tools plus the adapter code backing them. Auto-discovered. Formerly "plugin." |
| **Duty Preset** | The markdown file that declares a Duty: persona + the Skills/Tools it may use + budget. |
| **Workflow** | A markdown file (`workflows/<name>.md`) describing a category of work: purpose, standards/expectations, and steps. Discoverable like a Skill, but not callable — it only ever contributes read-only guidance text into a running SAR chain's context (`createWorkflowContextMiddleware`, §3). Hand-edited; never compiled or validated; the human-in-the-loop counterpart to Contract's compiled phase automation. See `docs/WORKFLOWS_PLAN.md`. |
| **Schema** | The typed I/O contracts that Tools and Duties conform to. Cross-cutting. |

---

## 3. The SAR envelope (runner-applied)

**Every duty execution is wrapped in a SAR chain at the runner level** —
budget, logging, and model-resolution middleware apply uniformly, without
every duty having to opt in individually.

```ts
// DutyRegistry.executeDuty() wraps all duties:
const executor = new Executor(api);
const stack = new MiddlewareStack<ChainContext>();

// Sense: observability, model resolution, context window, budget, workflow guidance.
stack.use(createChainLoggingMiddleware({ level: "info" }));
stack.use(createModelResolutionMiddleware(modelRegistry));
stack.use(createSmartTrimMiddleware({ recentCount: 50 }));
stack.use(createTokenGuardMiddleware({ maxTokens: 12000 }));
stack.use(createWorkflowContextMiddleware());  // pulls in a matching workflows/*.md guidance doc, if any

// Act: do the work + track tool/skill execution.
stack.use(createExecutionTrackingMiddleware());
await dutyInstance.execute(ctx);  // context built by Sense reaches the duty

// Report: output-only record, always non-empty.
stack.use(createReportMiddleware({ dutyName, startTime, api }));

const chain = new Chain(executor, stack, `duty:${dutyName}`);
chain.withContext({ messages: [], metadata: { dutyName, ... } });
await chain.run();
```

**Opt-out:** if a duty already has `this.middleware` and `this.executor`
attached (via `use()`/`createChain()`), it manages its own SAR and skips the
runner-applied envelope.

**Defined handoff:** the runner-applied envelope passes the prepared
`ChainContext` into `dutyInstance.execute(ctx)`. Duties that self-manage SAR
may ignore the argument; those that want workflow/model-trimmed context get
it for free. `duties/chatty.ts`'s main `/chat` request handling is
route-driven and bypasses `executeDuty()` entirely, so its workflow context is
wired directly into its own message assembly (`discoverWorkflow()` before
`buildSystemPrompt()`), not through this envelope.

---

## 4. Capability migration

| Current | Reclassified as | Status |
|---------|-----------------|--------|
| `agents/` | **Duty** | ⚠️ Directory and core classes renamed (`duties/`, `BaseDuty`, `DutyRegistry`, `DutyLoader`, `DutyAPI`). The rename is **not** complete end-to-end — see note below. |
| `plugins/` | **Tool Pack** | ✅ Kept as bundles. Each plugin method is a registered Tool. |
| `skills/` | **Skill** | ✅ Kept. Language-agnostic markdown defs. |
| `techniques/` | **Skill** | ✅ Removed. Converted to SKILL.md format. Technique execution code deleted. |
| `contracts/`, `src/task/` | **Engine-internal** (§5) | ✅ Kept — phase graphs now live inline on contracts, no separate Kata layer. |
| `src/kata/` | — | ✅ Removed — see §5. Two orphaned `.kata` files remain under `katas/` as historical reference; nothing loads them anymore. |

**Known "Agent" leaks (not fixed, listed so nobody assumes otherwise):**
- Duty files/classes still named after "agent": `duties/example-agent.ts`
  (`ExampleAgent`), `duties/test-agent.ts` (`TestAgent`),
  `duties/tool-calling-agent.ts` (`ToolCallingAgent`), `duties/docs-agent.ts`
  (`DocsAgent`), `duties/dojo-agent.ts` (`DojoAgent`),
  `duties/agent-registry.ts` (class is actually named `DutyRegistry`, despite
  the filename), `duties/agent-dependency-dashboard.ts`
  (`AgentDependencyDashboard`), and `duties/tasking.ts`'s own class
  (`TodoAgent`). These all `extends BaseDuty` — they're ordinary Duties whose
  file/class names predate the rename.
- Live CLI output still says "agent": `ronin interactive` prints
  `Agents: N running`, `Agent Status:`, `run <agent-name>`
  (`src/cli/commands/interactive.ts`); `ronin schedule` help text says
  "Manage cron schedules for agents" (`src/cli/commands/schedule.ts`).
- `package.json`'s `description` field still reads "agent library" /
  "agent task files".

**Provider plugins:**
- `plugins/grok.ts` → ✅ Removed. Provider is now an adapter behind ToolRouter.
- `plugins/gemini.ts` → ✅ Removed. Provider is now an adapter behind ToolRouter.
- `plugins/langchain.ts` → ✅ Kept (used by agent-creator-orchestrator for graph workflows).
- `plugins/gemini-cli.ts` → ✅ Kept (used by coder-bot for CLI tooling).

---

## 5. Engine internals: Contract → Task → Skills/Tools

**This corrects earlier drafts of this document (including an intermediate
draft that swung the other way and declared kata permanent, "actively
developed and extended").** Both framings are now moot: Kata was fully
removed. Investigation for that removal found the DSL/compiler/registry
layer wasn't actually delivering the things that would have justified
keeping it — conditional branching, parallel phases, and parent/child
data-threading were all either unimplemented or silently discarded despite
scaffolding suggesting otherwise — so a contract's phase graph now lives
inline on the contract itself, with no intermediate compiled artifact.
`technique` was vestigial and got removed (§4); so was `src/realms/`, a
*distributed* kata registry (central/local realms, version pinning, install
requests) that had zero callers anywhere in the codebase — confirmed by
grep, then deleted, ahead of the rest of `src/kata/` following the same day.

```
  Contract ──inline phases──► Task ──runs phases──► Skills / Tools
  (WHEN: schedule/trigger,     (a running instance   (leaf
   phase graph on the row)     of a contract)         capabilities)
```

- **Contract** — binds a trigger (cron schedule, or an event with an optional
  condition guard) directly to a phase graph. `src/contract/parser-v2.ts`
  parses `initial <phase>` / `phase <name>` blocks (`run skill`, `wait
  event`, `next`/`complete`/`fail`) straight into `Record<string,
  ContractPhase>`, stored as JSON on the `contracts_v2` row
  (`initial_phase`/`phases` columns) — no separate compiled artifact, no
  registry, no versioning layer. `src/contract/phase-compiler.ts` validates
  the graph (reachability, terminals, cycles) at parse time, so every caller
  (`cmdValidate`/`cmdRegister`/`ContractLoader`/`propose.ts`) gets it for
  free. `src/contract/engine.ts` (`CronEngine`, `ContractEngine`) and
  `src/contract/event-engine.ts` (`EventTriggerEngine`) evaluate triggers and
  spawn tasks. Contracts are drafted from plain English via `contract
  propose` (`src/contract/propose.ts`) and, from chat, via the
  `contracts.proposeReflex` tool, each drafting its own `phases` block
  directly (no shared reusable phase-sequence registry — two contracts
  wanting the same sequence each carry their own copy now) — nothing
  registers automatically; every AI-drafted contract is staged as a pending
  proposal (`src/contract/proposal-storage.ts`) and only goes live once
  approved via an inline chat card or the `/contracts` dashboard page, never
  silently.
- **Task** — a running instance of a contract's phase graph.
  `src/task/contract-task-engine.ts` (`ContractTaskEngine`) spawns tasks on
  `TaskStorageV2` and tracks `currentPhase`/`variables` directly on the task
  row (no re-deriving them from a registry lookup). `src/task/
  contract-task-executor.ts` (`ContractTaskExecutor`) runs consecutive `run`
  phases via `SkillAdapter` in one synchronous burst per call, stopping only
  at a `wait`/`complete`/`fail` phase — a real behavioral improvement over
  the old one-phase-per-poll executor, which could leave a multi-phase
  contract taking up to 30 minutes per hop. A `wait event` phase gets a real
  `waiting_for_event` task status, with in-memory listeners re-armed for any
  still-waiting task on duty construction and each poll tick, so a process
  restart no longer silently orphans a contract mid-wait (this matters
  directly for the Alpaca portfolio-sync contract's human-approval gate).

**`contracts/` → `schema/` rename:** still deferred, out of scope for any
pass to date. Not a removal — a possible future rename of the shared-type
folder, unrelated to the Kata removal above.

---

## 6. Orchestration: one spine, no dispatcher

There is one event bus and one scheduler. There is **no central coordinator
that assigns work across Duties.** Each Duty independently decides what to
react to; the only cross-Duty coordination mechanism is the event bus
(`api.events.emit`/`.on`), where any Duty can emit an event and any other
Duty can choose to listen for it. Nothing enforces that a listener exists,
and nothing routes work to a "free" Duty — coordination is whatever the
authors of two specific Duties agreed on by event name.

| Previously | Now |
|------------|-----|
| Reactive triggers (cron, file-watch, webhook, contract event-triggers) | **Sensors.** They emit events into the bus; they do not run logic. |
| Plan Workflow (Intent → Todo → Coder) | A **set of Duties** (`duties/tasking.ts`'s `TodoAgent`, `duties/coder-bot.ts`, `duties/manual-approval.ts`, `duties/alert-observer.ts`, `duties/log-observer.ts`) plus Sensors, wired on the same bus (§6.2). |

```
Sensors ──► [ event bus ] ──► Duties (each a SAR loop) ──► effects ──► bus
```

**Rules:**
1. One scheduler. One bus. No Duty owns shared state except the designated
   state-authority Duty for its domain.
2. Sensors are dumb. Logic lives in Duties.
3. Cross-Duty communication is events only. No direct calls into another Duty's internals.

### 6.1 What "MNGR" actually is

**MNGR is a separate, external application** (a sibling project outside this
repo), not an internal Ronin concept. Ronin's only relationship to it is a
one-shot registration handshake plus a webhook receiver:

- `plugins/mngr.ts` — a Tool Pack with three methods (`getConfig`, `register`,
  `listTasks`) that call the *external* MNGR app's HTTP API. The file's own
  header spells this out explicitly to prevent exactly the confusion this
  document used to cause.
- `duties/mngr-worker.ts` (`MngrWorkerDuty`) — registers Ronin's webhook URL
  with the external MNGR app hourly, and exposes `/api/agent/tasks` for MNGR
  to push tasks *into* Ronin. Every incoming task runs one hardcoded pipeline
  (resolve an `envoyProjectId`, call the `envoy` plugin, run a single
  `api.ai.chat()` call, draft an ENVOY email item). It is a single-purpose
  webhook handler for one integration, not a general task router.
- Configured via `MngrIntegrationConfig` (`src/config/types.ts`) —
  `baseUrl`, `registrationSecret`, `inboundToken`, `roninEndpointUrl`. No
  internal-coordinator config exists.

An internal coordinating Duty was proposed at one point and explicitly
dropped — see the comment above `handleDecomposeAPI` in `duties/tasking.ts`:
*"Decomposition intent (spec §9.3, renamed away from 'MNGR' — see the
integration plan for why: neither the aspirational coordinating Duty nor the
external MNGR app integration is a safe dependency here)."* That decomposition
endpoint does goal→Kanban-card breakdown with a single LLM call; it does not
dispatch to other Duties.

### 6.2 The closest things to "orchestration" that actually exist

- **`duties/tasking.ts` (`TodoAgent`)** — a self-contained Kanban/task-board
  Duty (~4800 lines). It listens for `PlanProposed`/`PlanApproved`, serves
  `/todo` and `/api/todo/*`, and can decompose a goal into cards via a single
  `api.ai.complete()` call. When a command needs code executed, it routes to
  an *external coding CLI* (`claude`, `opencode`, `qwen`, `cursor`, `gemini`
  — each a Plugin) via `src/tasking/executors.ts`, based on card labels or a
  keyword heuristic. It never dispatches to other Ronin Duties.
- **`duties/coder-bot.ts`** — reacts to `PlanApproved` events (tagged
  `#create`/`#build`/`#fix`/`#update`) and executes approved plans by
  shelling out to a real coding CLI (`claude`, `qwen`, `cursor`, `opencode`,
  `gemini` — each a Plugin). For duty creation specifically, it uses the
  same authoring instructions `duties/duty-executor.ts`'s draft was written
  against (`buildDutyAuthoringSystemPrompt()`), optionally handed a prior
  cheap draft as a reviewed starting point (`payload.draftCode`). It detects
  success by listening for `HotReloadService`'s real `duty_created`/
  `duty_reloaded` events (attached *before* the CLI runs, since the file
  write happens during execution) rather than regex-guessing a filename out
  of the CLI's text output.
- **Two independent Duty-*authoring* flows**, now converging on the same
  execution mechanism — `duties/agent-creator-orchestrator.ts`
  (LangGraph state machine, triggered by `create_agent`/`cancel_creation`
  events, still its own thing) and `duties/duty-executor.ts` (the
  chat-reachable `duties.proposeDuty` tool). `duty-executor.ts` drafts a
  cheap preview via a single `api.ai.complete()` call for the chat approval
  card, but **no longer writes that draft to disk on approval** — a
  single-completion draft has no compile-check or self-correction loop.
  Approval instead emits `PlanProposed` (a real, trackable Kanban card at
  `/todo`) then immediately `PlanApproved` (no second approval needed — the
  human already approved in chat) with the draft attached, handing the
  actual implementation to `coder-bot.ts`'s real CLI spawn above.
- **`api.langchain.runAgent`** (`plugins/langchain.ts`) — a real LangChain
  `AgentExecutor` (tool-calling loop), instantiated fresh per call. This is
  the one place "agent" means an actual distinct sub-concept (a bounded
  LLM+tools loop) rather than a legacy name for a Duty.

---

## 7. Model router

A single router is the only path to a model. Two public entry points:

```ts
api.ai.complete(prompt, opts)      // text in, text out
api.ai.callTools(prompt, opts)     // tool-calling loop
// ToolChat sits on top of these; it is not a third path.
```

- Providers (Ollama, Anthropic, Grok, Gemini, OpenAI) are **adapters** registered
  with the router, selected by tier (`local` / `smart` / `cloud`) or explicit
  `--model`.
- Privacy-first default: `local` (Ollama) unless a Duty's policy opts into cloud.

### 7.1 Tool discovery

`ToolRouter` (`src/tools/ToolRouter.ts`) is the single registry of every
model-callable tool: hand-written `local.*` tools (`LocalTools.ts`), external
MCP-server tools (`MCPClientManager`), and — via
`registerPluginToolsWithRouter()` in `src/api/index.ts` — every plugin method,
auto-wrapped at boot with a generic schema (real per-method schemas are
opt-in via a plugin's `toolMetadata`, see `src/plugins/base.ts` /
`toolGenerator.ts`; most plugins don't have one yet, so their tools get a
single untyped `args` array). `api.tools.list()`/`getSchemas()` return this
whole registry — currently ~200 tools total, ~186 of them plugin-generated.

**`api.ai.callTools()` no longer force-injects every plugin tool.** It used
to (`allTools = [...pluginTools, ...tools]`, unconditionally, regardless of
what the caller passed) — a bug fixed 2026-09, since it silently defeated
every caller's own curation (`duties/schedule-manager.ts` passing exactly one
tool, `duties/tasking.ts` filtering to a template's allowlist). Callers now
get exactly the tools they pass; anyone who wants the full plugin surface
gets it explicitly from `api.tools.getSchemas()`.

**Chat (`duties/chatty.ts`) doesn't show the model all ~200 tools every
turn** — that's 8-20k tokens of schema overhead on a path that bypasses the
`tokenGuard` middleware entirely (route-driven, not run through
`executeDuty()`). Only the bulk auto-wrapped `plugin:*` surface (~186 tools)
is gated — `local.*`, `mcp:*`, **and** duty-self-registered tools like
`contracts.proposeReflex` (provider `"contract-executor"`),
`duties.proposeDuty` (`"duty-executor"`), and `schedule.writeSchedule`
(`"schedule-manager"`) all stay always-visible (~35-40 tools combined) —
gating those too would have made several of the most important
chat-creation tools unreachable. Bulk plugin tools are grouped by category
(one category = one plugin)
and written as real markdown docs to `memory/notes/tools/<category>.md`
(`src/tools/toolDocs.ts`, generated once at boot and refreshed daily by
`duties/tools-indexer.ts`). Chat injects only the compact category index
(names + a few example tool names) into the system prompt, and the model
calls `local.tools.load_category(category)` to pull in a specific category's
real tool schemas before calling anything in it — the same "discover, then
use" shape Skills already use (`skills.discover` → `skills.use`),
generalized to plugin tools. `discord`/`telegram` are deliberately excluded
from this — their raw plugin methods need a `clientId`/`botId` obtained via
an `init*` call that's never offered to the model (see
`isPluginMethodSkipped`); `local.discord.*`/`local.telegram.*` already cover
the same ground with auto-init from config and are always visible.

Other `api.ai.callTools()` callers (`duties/messenger.ts`, the chain
templates using `createAiToolMiddleware`) still get the full uncapped
`ToolRouter` list via that middleware — they were not part of this pass and
may have the same token-bloat exposure chat had; not yet assessed.

---

## 8. Safety boundary

Ronin shares OpenClaw's attack surface: shell execution + file access + inbound
channels. Any tool-calling chat surface (e.g. the `/chat` UI in
`duties/chatty.ts`) can have the model call the `local.events.emit` tool to
emit `PlanProposed` (`src/tools/providers/LocalTools.ts`), which
`duties/tasking.ts`'s `TodoAgent` turns into a Kanban card. **This means chat
input can propose executable work** — but it cannot execute it unapproved:
`duties/manual-approval.ts` gates the step from `PlanProposed` to
`PlanApproved`, and only `PlanApproved` is what `duties/coder-bot.ts` acts on
by shelling out to a coding CLI. (There is no dedicated "Intent Ingress" duty
watching a channel for a hashtag — `PlanProposed` is only ever emitted by an
AI tool call, by whatever duty/chat surface chose to make one.)

Hardening:

1. **Per-run budgets.** Every Duty run has a hard cap on steps and tokens (tokenGuard).
2. **Tool trust tiers.** (Planned) Tag Tools `safe` / `guarded` / `dangerous`.
3. **Provenance on events.** Every event carries its origin.
4. **Approval is an event.** Model approval as a first-class event with trusted provenance.
5. **Remote access whitelist.** `RouteGuard` (`plugins/cloudflare/src/RouteGuard.ts`)
   is wired into the real HTTP server (`src/duty/DutyRegistry.ts`'s `fetch`
   handler) — a no-op until a route policy exists (`ronin cloudflare route
   init`), then a fail-closed whitelist gating every request, local included.
   See `docs/REMOTE_ACCESS.md`.

---

## 9. Target tree (current)

```
ronin/
├── src/
│   ├── duty/           # BaseDuty, DutyLoader, DutyRegistry
│   ├── tools/          # ToolRouter + adapters + LocalTools
│   ├── api/            # DutyAPI, unified interface to all subsystems
│   ├── chain/          # Chain, Executor — re-export from @ronin/sar
│   ├── middleware/     # tokenGuard, modelResolution, executionTracking, etc.
│   ├── memory/         # SQLite store (duty_state, conversations, memories)
│   ├── contract/        # engine-internal — trigger + inline phase graph, propose/approve flow (§5)
│   ├── task/            # engine-internal — running contract-task instances (§5)
│   ├── mesh/            # cross-instance discovery (Reticulum) — separate Ronin installs finding each other, not inter-Duty coordination. Exists, not wired into any duty-dispatch path.
│   └── os/              # Desktop Mode: menubar/tray, OS installers. Additive UI layered on top of duties after they register routes — doesn't run or manage them.
├── duties/             # Your Duties
├── plugins/            # Capability plugins (langchain, gemini-cli, cloudflare, etc.)
├── skills/             # Markdown Skill defs — language-agnostic
├── workflows/          # Markdown Workflow SOPs — guidance only, never compiled (§2)
├── contracts/          # .contract DSL source files (planned rename to schema/, deferred)
├── packages/sar/       # @ronin/sar — Executor, Chain, MiddlewareStack
└── docs/
    ├── ARCHITECTURE.md   # This document — canonical
    ├── REMOTE_ACCESS.md  # Cloudflare tunnel + dashboard-as-PWA guide
    └── history/          # Archived, point-in-time — never authoritative (§12)
```

---

## 10. Key files

| File | Purpose |
|------|---------|
| `src/duty/Duty.ts` | `BaseDuty` class with optional SAR (`use()`, `createChain()`) |
| `src/duty/DutyRegistry.ts` | Duty registry + scheduler + webhook server + SAR envelope in `executeDuty()` + RouteGuard enforcement in `fetch()` |
| `src/duty/DutyLoader.ts` | Discovers and loads duty files |
| `src/types/duty.ts` | `interface Duty`, `DutyMetadata`, `DutyConstructor` |
| `src/api/ai.ts` | AIAPI — single path to models via ToolRouter |
| `src/tools/ToolRouter.ts` | Tool registration and execution with policy enforcement |
| `src/memory/Memory.ts` | SQLite store with `duty_name` columns |
| `src/contract/engine.ts`, `event-engine.ts`, `propose.ts` | Contract trigger evaluation, event sensors, AI-authoring |
| `duties/contract-executor.ts` | Owns the contract/cron/event engines, the `contracts.proposeReflex` tool, and the `/contracts` review page |
| `plugins/cloudflare/src/RouteGuard.ts`, `QuickTunnel.ts` | Route whitelist enforcement; real anonymous quick tunnels |
| `packages/sar/` | Executor, Chain, MiddlewareStack — the shared SAR machinery |
| `plugins/mngr.ts`, `duties/mngr-worker.ts` | The external-MNGR-app integration — registration handshake + inbound task webhook. See §6.1. |
| `src/mesh/MeshDiscoveryService.ts` | Cross-instance service discovery over Reticulum — see §9, dormant/unwired |

---

## 11. CLI commands (current)

### Core
```
ronin start                 Start and schedule all duties
ronin run <duty>            Run a specific duty manually
ronin list                  List all available duties
ronin status                Show runtime status
ronin stop / restart / kill Manage running instances
```

### Creation
```
ronin create duty [desc]    AI-powered duty creation
ronin create skill "desc"   AI-powered skill creation
ronin create plugin <name>  Create a new plugin template
ronin contract propose "<intent>"   AI-drafts a trigger + phase graph from plain language
ronin workflow propose "<description>"   AI-drafts a Workflow SOP from plain language
ronin workflow list / show / new / edit  Manage workflows/*.md directly (no compile step)
```

### Configuration
```
ronin config --show         Show current configuration
ronin config --init        Initialize user directories
ronin config --duty-dir    Set duty directory
```

### Remote access
```
ronin cloudflare route init          Opt into the route whitelist (required before any tunnel)
ronin cloudflare route add <path>    Whitelist a path (--auth none|token, --methods)
ronin cloudflare tunnel temp [ttl]   Real anonymous quick tunnel, prints URL + QR code
```
See `docs/REMOTE_ACCESS.md` for the full walkthrough.

### Engine (kept, engine-internal — §5)
```
ronin task list             Part of the execution engine
ronin contract list         Part of the execution engine
```

See `ronin --help` for the full command list.

---

## 12. Documentation policy

This file is the only canonical architecture document. Rules that exist
specifically because they were violated before:

- **Nothing outside this git repository is ever authoritative** — not a
  file on someone's Desktop, not another machine, not a chat transcript. A
  prior pass kept planning docs (`ARCHITECTURE_CHANGES_PLAN.md`,
  `ARCHITECTURE_REMOVALS_PLAN.md`) only on a contributor's Desktop; they went
  stale and conflicted with the real repo state because nothing forced them
  to stay in sync. Both are now archived in `docs/history/` instead, marked
  with their execution status, so this can't recur at that location.
- **`docs/history/` is a point-in-time archive, never live guidance.** If a
  file there disagrees with this document, this document wins.
- When this document itself falls out of date, fix it in the same change
  that changes the engine — don't defer it to a cleanup pass.

---

## 13. Migration notes

### Agent → Duty
- `BaseAgent` → `BaseDuty`, `AgentRegistry` → `DutyRegistry`, `AgentLoader` → `DutyLoader`
- `agents/` → `duties/`, `--agent-dir` → `--duty-dir`
- `setAgentState` → `setDutyState` (Memory); DB `agent_name` → `duty_name` columns
- **Not fully done** — see the "Known Agent leaks" note under §4 for what
  still says "agent" in file names, class names, and live CLI output.

### Provider consolidation
- `plugins/grok.ts`, `plugins/gemini.ts` → removed, replaced by ToolRouter adapters
- `plugins/langchain.ts`, `plugins/gemini-cli.ts` → kept (real call sites)

### SAR envelope
- `DutyRegistry.executeDuty()` wraps all duties in a SAR chain: Sense → Act → Report
- Default budget: 12000 tokens, configurable per duty
- Runner passes the prepared `ChainContext` into `dutyInstance.execute(ctx)`
- Report middleware guarantees a non-empty `ctx.report` artifact

### Technique removal
- `src/techniques/` deleted; substrate types moved to `src/types/shared.ts` and `src/database/migrations.ts`
- All `.technique` files converted to `SKILL.md`; `technique` CLI verb removed

### Realms removal
- `src/realms/` (distributed kata registry: central/local realms, version
  pinning, install requests) deleted outright — confirmed zero callers
  anywhere in `src`/`duties`/`plugins` before removal. Not a rename, not a
  merge: the functionality it would have provided (sharing katas across
  multiple people/instances) had no real user. Local kata management (then
  living in `src/kata/`) was itself removed later the same day — see the
  Kata removal below; nothing distribution-shaped survives either path.
- Not to be confused with `plugins/realm.ts` (singular), a real, live,
  actively-used WebRTC/WebSocket remote-access relay with its own CLI
  commands (`ronin realm connect/discover/status`) — that one stays.

### Kata removal
- `src/kata/` (DSL parser, compiler, versioned registry) deleted in full.
  What it delivered — compile-time phase-graph validation and immutable
  checksummed artifacts — wasn't worth the layer: branching, parallel
  phases, and parent/child data-threading all looked implemented but weren't
  actually wired through Kata, so nothing about those was lost. A contract's
  phase graph now lives inline on the contract row (`initial_phase`/`phases`
  JSON columns on `contracts_v2`); `src/task/{engine,executor,
  child-coordinator,parallel-coordinator,storage,types}.ts` (the old,
  Kata-coupled task pipeline) and `src/cli/commands/kata.ts` went with it,
  replaced by `src/task/contract-task-{engine,executor}.ts` on
  `TaskStorageV2`. See §5 for the current shape.
- The three live contracts that targeted a kata (`daily-morning-briefing`,
  `on-discord-mention`, `portfolio-sync`) were rewritten with inline phases;
  `portfolio-sync`'s kata-version mismatch (contract asked for v1, only v2
  existed — silently failing every 15 minutes during market hours) was fixed
  in the same pass. Two orphaned `.kata` files with no contract targeting
  them (`codebase-digest.kata`, `research-and-save.kata`) are left in
  `katas/` untouched, as inert historical reference.

---

**Last updated:** September 2026 — corrected the MNGR/orchestration claims in
§1 and §6 to match the actual code (MNGR is an external app, not an internal
coordinating Duty; there is no cross-Duty dispatcher), stopped overclaiming
the Agent→Duty rename as complete (§4, §13), documented `src/mesh/` and
`src/os/` (§9, previously undocumented), deleted `src/realms/` — a
same-name-different-thing collision with `plugins/realm.ts` that had zero
callers (see "Realms removal" above) — and, later the same day, removed
`src/kata/` itself and rewrote §5 to describe Contract → Task directly, with
phase graphs inline on the contract (see "Kata removal" above).
