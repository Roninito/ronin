# Ronin Architecture

> **Status:** Canonical (Post-Refactor, June 2026).
> This document describes the current architecture after the Agent→Duty rename,
> provider consolidation, and SAR envelope implementation.

---

## 1. The One Idea

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

## 2. The Three Concepts

Ronin has **three first-class concepts.** Two are capabilities (the things a Duty
can invoke); one is the decider. Everything else is packaging or typing.

| Concept | Definition | Was called |
|---------|------------|------------|
| **Tool** | An atomic, typed, in-process capability (Bun/TS). Single typed input → typed output. MCP-exportable. Hot-path, model-callable via function-calling. | plugin methods |
| **Skill** | A markdown-defined, declarative, **language-agnostic** capability. May be multi-step or out-of-process; can shell out to Python/shell, not just Bun. Discoverable via its manifest. | skills, techniques |
| **Duty** | A SAR loop instance with a persona, an allowlist of Skills + Tools, a budget, and memory. The thing that *decides*. (Formerly "Agent.") | agents |

The Tool/Skill split is the one capability boundary worth keeping: **Tool** =
fast, typed, in-runtime; **Skill** = portable, declarative, language-agnostic.

**technique was dropped** because it was a third synonym for Skill that bought
nothing and (unlike Skill) couldn't cross language boundaries.

### Supporting Structure (not capability concepts)

| Concept | Definition |
|---------|------------|
| **Tool Pack** | A namespaced bundle of Tools plus the adapter code backing them. Auto-discovered. Formerly "plugin." |
| **Duty Preset** | The markdown file that declares a Duty: persona + the Skills/Tools it may use + budget. |
| **Schema** | The typed I/O contracts that Tools and Duties conform to. Cross-cutting. |

---

## 3. The SAR Envelope (Runner-Applied)

**Every duty execution is wrapped in a SAR chain at the runner level.**

```ts
// DutyRegistry.executeDuty() wraps all duties:
const executor = new Executor(api);
const stack = new MiddlewareStack<ChainContext>();

stack.use(createChainLoggingMiddleware({ level: "info" }));
stack.use(createModelResolutionMiddleware(modelRegistry));
stack.use(createSmartTrimMiddleware({ recentCount: 50 }));
stack.use(createTokenGuardMiddleware({ maxTokens: 12000 }));
stack.use(createExecutionTrackingMiddleware());

const chain = new Chain(executor, stack, `duty:${dutyName}`);
chain.withContext({ messages: [], metadata: { dutyName, ... } });
await chain.run();
await dutyInstance.execute();  // Respond phase
```

This means:
- Budget enforcement (token guard) applies to **every** duty
- Model resolution is centralized
- Execution tracking is universal
- Duties can opt into richer Sense/Analyze phases via `createChain()`

**Opt-out:** If a duty already has `this.middleware` and `this.executor` attached,
it skips the envelope (for duties that manage their own SAR).

---

## 4. Capability Migration (Complete)

| Current | Reclassified as | Status |
|---------|-----------------|--------|
| `agents/` | **Duty** | ✅ Renamed to `duties/`. Agent → Duty hard rename complete. |
| `plugins/` | **Tool Pack** | ✅ Kept as bundles. Each plugin method is a registered Tool. |
| `skills/` | **Skill** | ✅ Kept. Language-agnostic markdown defs. |
| `techniques/` | **— DROPPED —** | ⏳ Deferred (code exists, CLI removed in future pass). |
| `katas/` | **— DEFERRED —** | ⏳ Not a runtime concept; removal is separate project. |
| `contracts/` | **Schema** | ⏳ Planned rename to `schema/` (deferred). |

**Provider plugins:**
- `plugins/grok.ts` → ✅ Removed. Provider is now an adapter behind ToolRouter.
- `plugins/gemini.ts` → ✅ Removed. Provider is now an adapter behind ToolRouter.
- `plugins/langchain.ts` → ✅ Kept (used by agent-creator-orchestrator for graph workflows).
- `plugins/gemini-cli.ts` → ✅ Kept (used by coder-bot for CLI tooling).

---

## 5. Orchestration: One Spine, Many Sensors

There is one event bus and one scheduler. The three things that previously felt
like separate orchestration systems are reclassified:

| Previously | Now |
|------------|-----|
| Reactive triggers (cron, file-watch, webhook) | **Sensors.** They emit events into the bus; they do not run logic. |
| Behavior tree (SAR/MNGR, katas) | **MNGR**, a coordinating Duty. Its tree is its Respond strategy; leaves are Tools. |
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

## 6. Model Router

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

## 7. Safety Boundary

Ronin shares OpenClaw's attack surface: shell execution + file access + inbound
channels. The `#ronin #plan` → Coder Bot path means **untrusted channel input
can propose executable work.**

Hardening:

1. **Per-run budgets.** Every Duty run has a hard cap on steps and tokens (tokenGuard).
2. **Tool trust tiers.** (Planned) Tag Tools `safe` / `guarded` / `dangerous`.
3. **Provenance on events.** Every event carries its origin.
4. **Approval is an event.** Model approval as a first-class event with trusted provenance.

---

## 8. Deferred Removals

The `technique / kata / contract / task` cluster is **not deleted** in this refactor.
It shares a storage substrate (`storage-v2.ts`, `parser-v2.ts`), making removal a
separate project. See `ARCHITECTURE_REMOVALS_PLAN.md` for the detailed extraction plan.

**Current status:**
- `technique` CLI exists but is vestigial (not executed at runtime). Planned removal: Phase R1.
- `kata`, `task`, `contract` CLIs are **kept** — they are the execution engine.
- `techniques/`, `katas/`, `contracts/` directories exist but are not part of the core architecture.

---

## 9. Target Tree (Current)

```
ronin/
├── src/
│   ├── duty/           # BaseDuty, DutyLoader, DutyRegistry (renamed from agent/)
│   ├── tools/          # ToolRouter + adapters + LocalTools
│   ├── api/            # DutyAPI, unified interface to all subsystems
│   ├── chain/          # Chain, Executor — re-export from @ronin/sar
│   ├── middleware/     # tokenGuard, modelResolution, executionTracking, etc.
│   ├── memory/         # SQLite store (duty_state, conversations, memories)
│   ├── technique/      # DEFERRED — coupled to kata/contract/task
│   ├── kata/           # DEFERRED — used by src/task/engine.ts
│   ├── contract/       # DEFERRED — shares storage-v2 with kata
│   └── task/           # DEFERRED — runtime uses kata/contract
├── duties/             # Your Duties (renamed from agents/)
├── plugins/            # Capability plugins (langchain, gemini-cli, etc.)
├── skills/             # Markdown Skill defs — language-agnostic
├── techniques/         # DEFERRED — not referenced by architecture
├── katas/              # DEFERRED — not referenced by architecture
├── contracts/          # DEFERRED — planned rename to schema/
├── packages/sar/       # @ronin/sar — Executor, Chain, MiddlewareStack
└── docs/
    ├── ARCHITECTURE.md   # This document
    └── history/          # Archived PHASE*/SUMMARY/MODEL_SELECTION docs
```

---

## 10. Key Files (Post-Refactor)

| File | Purpose |
|------|---------|
| `src/duty/Duty.ts` | `BaseDuty` class with optional SAR (`use()`, `createChain()`) |
| `src/duty/DutyRegistry.ts` | Duty registry + scheduler + webhook server + **SAR envelope in `executeDuty()`** |
| `src/duty/DutyLoader.ts` | Discovers and loads duty files |
| `src/types/duty.ts` | `interface Duty`, `DutyMetadata`, `DutyConstructor` |
| `src/api/ai.ts` | AIAPI — single path to models via ToolRouter |
| `src/tools/ToolRouter.ts` | Tool registration and execution with policy enforcement |
| `src/memory/Memory.ts` | SQLite store with `duty_name` columns (migrated from `agent_name`) |
| `packages/sar/` | Executor, Chain, MiddlewareStack — the shared SAR machinery |

---

## 11. CLI Commands (Current)

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
```

### Configuration
```
ronin config --show         Show current configuration
ronin config --init        Initialize user directories
ronin config --duty-dir    Set duty directory
```

### Deferred (Technique/Kata/Contract/Task)
```
ronin technique list        # DEFERRED — vestigial, planned removal
ronin kata list             # KEPT — part of execution engine
ronin task list             # KEPT — part of execution engine
ronin contract list         # KEPT — part of execution engine
```

See `ronin --help` for full command list.

---

## 12. Migration Notes

### Agent → Duty (Complete)
- `BaseAgent` → `BaseDuty`
- `AgentRegistry` → `DutyRegistry`
- `AgentLoader` → `DutyLoader`
- `agents/` → `duties/`
- `--agent-dir` → `--duty-dir`
- `setAgentState` → `setDutyState` (Memory)
- Database: `agent_name` → `duty_name` columns

### Provider Consolidation (Complete)
- `plugins/grok.ts` → Removed
- `plugins/gemini.ts` → Removed
- `plugins/langchain.ts` → Kept (graph workflows)
- `plugins/gemini-cli.ts` → Kept (CLI tooling)
- All AI access through `AIAPI` → providers

### SAR Envelope (Complete)
- `DutyRegistry.executeDuty()` wraps all duties in SAR chain
- Logging, model resolution, token guard, execution tracking middleware
- Default budget: 12000 tokens, configurable per duty

---

**Last updated:** June 2026 (Post-Refactor)
**Branch:** `refactor/duty-architecture`