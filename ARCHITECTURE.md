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
in parallel. There is one execution model — **SAR** (Sense → Analyze → Respond)
— and every unit of work is an instance of it. Coordination, scheduling, and
planning are not other paradigms; they are Duties whose job happens to be
coordinating, scheduling, or planning *other* Duties.

```
            ┌──────────────────────── Duty ────────────────────────┐
            │                                                       │
  Sensors ──►  SENSE  ──►  ANALYZE  ──►  RESPOND  ──► (effects) ────┤
            │    ▲                                        │         │
            │    └──────────────── loop ──────────────────┘         │
            └───────────────────────────────────────────────────────┘
                         persona · tool allowlist · budget · memory
```

- **Sense** — pull signal from Sensors (events, schedules, files, channel msgs).
- **Analyze** — reason over signal + memory, using the model router. Decide.
- **Respond** — execute Tools, emit events, write memory.

**MNGR** is just the Duty whose Respond actions assign work to other Duties.

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
| **Workflow** | A markdown file (`workflows/<name>.md`) describing a category of work: purpose, standards/expectations, and steps. Discoverable like a Skill, but not callable — it only ever contributes read-only guidance text into a running SAR chain's context (`createWorkflowContextMiddleware`, §3). Hand-edited; never compiled or validated; the human-in-the-loop counterpart to Kata's compiled automation. See `docs/WORKFLOWS_PLAN.md`. Unrelated to the older, in-memory `WorkflowDefinition`/`WorkflowEngine` in `src/tools/` (a tool-step orchestration pipeline used by `duties/tool-orchestrator.ts`) — that naming overlap predates this feature and is a candidate for a future cleanup pass, not addressed here. |
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

stack.use(createChainLoggingMiddleware({ level: "info" }));
stack.use(createModelResolutionMiddleware(modelRegistry));
stack.use(createSmartTrimMiddleware({ recentCount: 50 }));
stack.use(createTokenGuardMiddleware({ maxTokens: 12000 }));
stack.use(createWorkflowContextMiddleware());  // pulls in a matching workflows/*.md guidance doc, if any
stack.use(createExecutionTrackingMiddleware());

const chain = new Chain(executor, stack, `duty:${dutyName}`);
chain.withContext({ messages: [], metadata: { dutyName, ... } });
await chain.run();
await dutyInstance.execute();  // Respond phase
```

**Opt-out:** if a duty already has `this.middleware` and `this.executor`
attached (via `use()`/`createChain()`), it manages its own SAR and skips the
runner-applied envelope.

**Known gap (pre-existing, not introduced by Workflow):** for most duties,
the runner-applied envelope's `chain.run()` and `dutyInstance.execute()` are
separate calls with no data threaded between them — `ctx.messages` built by
the envelope's middleware is not passed into `execute()` unless a duty
explicitly builds its own chain via `use()`/`createChain()` and reads from
it (a few duties do — `messenger.ts`, `tool-calling-agent.ts`,
`skill-maker.ts`, `refactory.ts`). `duties/chatty.ts`'s main `/chat` request
handling is also route-driven and bypasses `executeDuty()` entirely, so
`createWorkflowContextMiddleware` running there is a no-op in practice.
Workflow context for live chat is therefore wired directly into
`duties/chatty.ts`'s own message assembly (a `discoverWorkflow()` call
against the live user message before `buildSystemPrompt()`), not through
this envelope. `DutyRegistry.ts` also currently has a duplicate
`executeDuty()` method definition (harmless — JS class semantics mean the
second one silently wins) worth cleaning up in a future pass.

---

## 4. Capability migration (complete)

| Current | Reclassified as | Status |
|---------|-----------------|--------|
| `agents/` | **Duty** | ✅ Renamed to `duties/`. Agent → Duty hard rename complete. |
| `plugins/` | **Tool Pack** | ✅ Kept as bundles. Each plugin method is a registered Tool. |
| `skills/` | **Skill** | ✅ Kept. Language-agnostic markdown defs. |
| `techniques/` | **Skill** | ✅ Removed. Converted to SKILL.md format. Technique execution code deleted. |
| `katas/`, `contracts/`, `src/task/` | **Engine-internal** (§5) | ✅ Kept permanently — see §5, this is not a removal candidate. |

**Provider plugins:**
- `plugins/grok.ts` → ✅ Removed. Provider is now an adapter behind ToolRouter.
- `plugins/gemini.ts` → ✅ Removed. Provider is now an adapter behind ToolRouter.
- `plugins/langchain.ts` → ✅ Kept (used by agent-creator-orchestrator for graph workflows).
- `plugins/gemini-cli.ts` → ✅ Kept (used by coder-bot for CLI tooling).

---

## 5. Engine internals: Contract → Kata → Task → Skills/Tools

**This corrects earlier drafts of this document, which framed kata as a
removal candidate ("the one remaining open call to drop"). That framing was
wrong and is retired.** Measured from the source (`src/task/engine.ts`
hard-depends on `KataRegistry`; `src/realms/` is a whole distributed kata
registry; `agents/dojo-agent.ts` has dozens of kata references): kata, task,
and contract are not vestigial — they are a working execution engine,
actively developed and extended. Only `technique` was ever vestigial, and
it's the thing that was actually removed (§4).

```
  Contract ──targets──► Kata ──spawns──► Task ──runs phases──► Skills / Tools
  (WHEN: schedule/       (compiled        (a running        (leaf
   trigger)              phase-machine)   instance of a      capabilities)
                                           kata)
```

- **Contract** — binds a trigger (cron schedule, or an event with an optional
  condition guard) to a kata. `src/contract/engine.ts` (`CronEngine`,
  `ContractEngine`) and `src/contract/event-engine.ts` (`EventTriggerEngine`)
  evaluate triggers and spawn tasks. Contracts are drafted from plain English
  via `contract propose` (`src/contract/propose.ts`, mirrors `kata propose`'s
  AI-authoring pattern) and, from chat, via the `contracts.proposeReflex`
  tool — nothing registers automatically; every AI-drafted contract is staged
  as a pending proposal (`src/contract/proposal-storage.ts`) and only goes
  live once approved via an inline chat card or the `/contracts` dashboard
  page, never silently.
- **Kata** — a compiled phase-graph (DSL: `kata <name> vN`, `phase`, `run
  skill`, `next`). Pure action — no trigger or condition concept lives here;
  that's Contract's job entirely. **Kata is engine-internal, not a
  user-facing capability** — it is not presented alongside Tool/Skill/Duty as
  a fourth concept. A contributor drafts a kata only as a side effect of
  authoring a contract (`kata propose`, or inline kata drafting inside
  `contract propose`), not as a standalone concept to reach for.
- **Task** — a running instance of a kata; `src/task/engine.ts` spawns and
  advances it phase by phase.

**`contracts/` → `schema/` rename:** still deferred, out of scope for any
pass to date. Not a removal — a possible future rename of the shared-type
folder, unrelated to whether kata/contract/task stay (they do).

---

## 6. Orchestration: one spine, many sensors

There is one event bus and one scheduler. The three things that previously felt
like separate orchestration systems are reclassified:

| Previously | Now |
|------------|-----|
| Reactive triggers (cron, file-watch, webhook, contract event-triggers) | **Sensors.** They emit events into the bus; they do not run logic. |
| Behavior tree (SAR/MNGR) | **MNGR**, a coordinating Duty. Its tree is its Respond strategy; leaves are Tools. |
| Plan Workflow (Intent → Todo → Coder) | A **set of Duties** (Todo, Coder) plus Sensors, wired on the same bus. |

```
Sensors ──► [ event bus ] ──► Duties (each a SAR loop) ──► effects ──► bus
                                  ▲
                                MNGR (coordinating Duty)
```

**Rules:**
1. One scheduler. One bus. No Duty owns shared state except the designated
   state-authority Duty for its domain.
2. Sensors are dumb. Logic lives in Duties.
3. Cross-Duty communication is events only. No direct calls into another Duty's internals.

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

---

## 8. Safety boundary

Ronin shares OpenClaw's attack surface: shell execution + file access + inbound
channels. The `#ronin #plan` → Coder Bot path means **untrusted channel input
can propose executable work.**

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
│   ├── kata/           # engine-internal — compiled phase-graphs (§5)
│   ├── contract/        # engine-internal — trigger → kata binding, propose/approve flow (§5)
│   └── task/            # engine-internal — running kata instances (§5)
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
ronin kata propose "<intent>"       AI-drafts a kata from plain language
ronin contract propose "<intent>"   AI-drafts a trigger + kata from plain language
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
ronin kata list             Part of the execution engine
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

## 13. Migration notes (historical, all complete)

### Agent → Duty
- `BaseAgent` → `BaseDuty`, `AgentRegistry` → `DutyRegistry`, `AgentLoader` → `DutyLoader`
- `agents/` → `duties/`, `--agent-dir` → `--duty-dir`
- `setAgentState` → `setDutyState` (Memory); DB `agent_name` → `duty_name` columns

### Provider consolidation
- `plugins/grok.ts`, `plugins/gemini.ts` → removed, replaced by ToolRouter adapters
- `plugins/langchain.ts`, `plugins/gemini-cli.ts` → kept (real call sites)

### SAR envelope
- `DutyRegistry.executeDuty()` wraps all duties in a SAR chain
- Default budget: 12000 tokens, configurable per duty

### Technique removal
- `src/techniques/` deleted; substrate types moved to `src/types/shared.ts` and `src/database/migrations.ts`
- All `.technique` files converted to `SKILL.md`; `technique` CLI verb removed

---

**Last updated:** August 2026.
