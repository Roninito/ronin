> **Status: executed (August 2026), moved from the Desktop into version control.**
> All four phases below landed — see `../../ARCHITECTURE.md` §4, §13 for
> current state. Historical record only; nothing below is live guidance.

# Ronin — Architecture Changes Plan (Execution)

> **Audience:** Claude Code CLI (the coder agent executing this work).
> **Companion doc:** `ARCHITECTURE.md` describes the full end-state vision.
> **This doc executes only the 2-day, low-risk subset of that vision.** Anything
> in `ARCHITECTURE.md` not listed here is explicitly **out of scope** — see §8.
>
> **Prime directive:** Make changes that improve conceptual clarity *without*
> touching the coupled task-engine storage cluster. When in doubt, stop and leave
> a `TODO(architecture)` comment rather than guessing. Keep the build green after
> every phase.

---

## 1. Timebox & scope

| In scope (do this) | Out of scope (do NOT do — §8) |
|--------------------|-------------------------------|
| `Agent → Duty` hard rename | Removing `technique` |
| Provider consolidation (dedupe grok/gemini/langchain) | Removing/demoting `kata` |
| SAR envelope at the runner (make SAR universal) | `contracts/ → schema/` rename |
| Doc consolidation | Migrating all 52 duties' internals to SAR |
| Land `ARCHITECTURE.md` | Touching `*/storage-v2.ts` or `*/parser-v2.ts` |

Target: **~2 focused days.** Each phase is independently shippable and reversible.

---

## 2. New architecture — overview (target state)

Three first-class concepts. Everything else is packaging or typing.

- **Tool** — atomic, typed, in-process (Bun/TS) capability. Already implemented:
  `src/tools/` (`ToolRouter`, `ToolChat`, `UnifiedToolInterface`, adapters,
  `providers/LocalTools`). *Do not rebuild — consolidate onto it.*
- **Skill** — markdown-defined, language-agnostic capability (`skills/*/SKILL.md`).
  Already implemented and populated. *Keep as-is.*
- **Duty** — a unit of work that runs the **SAR loop** (Sense → Analyze → Respond).
  Formerly "Agent."

**The key architectural move: SAR is enforced as an envelope, not per-duty code.**
Today SAR is optional middleware that only 5 of 57 duties use. Instead of
rewriting 52 duties, the **runner** (`AgentRegistry`) will execute every duty
inside a SAR chain that applies budget, logging, and model-resolution middleware.
A duty's `execute()` becomes the Respond phase of a standard envelope. Duties may
later opt into richer Sense/Analyze phases via `createChain()`, but all duties get
SAR governance for free immediately.

```
        ┌──────────────── SAR envelope (runner-applied) ───────────────┐
trigger ►  SENSE (memory, trigger ctx) ► ANALYZE (model-resolve) ►      │
        │  RESPOND = duty.execute()  ► tokenGuard / tracking / logging  │
        └───────────────────────────────────────────────────────────────┘
```

Providers (Grok, Gemini, OpenAI, Anthropic, Ollama) are **adapters behind the
router** — never duties, never user-facing plugins.

---

## 3. Ground-truth current state (measured — do not re-discover)

- Runtime: **Bun**. CLI entry `src/cli/index.ts`. No `build`/`test` npm scripts.
- `package.json` version **1.2.0**, private, **zero external dependents** → the
  hard rename is safe; no deprecation alias required.
- Base class `src/agent/Agent.ts`: `abstract execute()`. SAR is optional via
  `use()` / `createChain()`. **Only 5/57 duties use SAR**
  (`chatty`, `messenger`, `refactory`, `skill-maker`, `tool-calling-agent`).
- SAR engine is real: `packages/sar` (`Executor`, `Chain`, `MiddlewareStack`,
  middleware: `tokenGuard`, `smartTrim`, `modelResolution`, `executionTracking`,
  `ontologyInject`, `persistChain`). `src/chain` and `src/executor` are
  **re-export shims** to `@ronin/sar`.
- Tool layer exists: `src/tools/ToolRouter.ts` (registers/routes tools with policy
  enforcement) + `src/tools/adapters/{Anthropic,OpenAI,Gemini,OllamaCloud,Cloud}Adapter.ts`.
- **Provider duplication:** `plugins/grok.ts`, `plugins/gemini.ts`,
  `plugins/gemini-cli.ts`, `plugins/langchain.ts` overlap the adapters above.
- `skills/*/SKILL.md` already markdown + language-agnostic (37 files).
- **COUPLED CLUSTER (do not touch):** `technique`, `kata`, `contract`, `task` share
  `*/storage-v2.ts` and `*/parser-v2.ts`. `kata` is imported by `src/task/engine.ts`,
  `src/realms/types.ts`, and the CLI. Removing either is a separate, later project.
- Large files to expect during rename: `agents/tasking.ts` (140KB),
  `agents/config-editor.ts` (90KB), `src/agent/AgentRegistry.ts` (78KB).

---

## 4. Guardrails — DO NOT TOUCH

1. Do **not** modify, move, or delete anything under: `src/technique*`,
   `techniques/`, `src/kata*`, `katas/`, `src/task/`, `src/contract/`, `contracts/`,
   or any `storage-v2.ts` / `parser-v2.ts`.
2. Do **not** rename `contracts/ → schema/` in this pass.
3. Do **not** rewrite the internal logic of duties beyond the mechanical rename and
   (for the 2–3 pilot duties only) the SAR-envelope opt-in.
4. Do **not** change public CLI behavior except the documented `agent → duty` verb
   rename.
5. If a change forces you into the coupled cluster to keep the build green, **stop**,
   revert that change, and record it under "Blocked" in the phase notes.

---

## 5. Global conventions

```bash
# Work on a dedicated branch
git checkout -b refactor/duty-architecture

# Verification (run after EVERY phase; all must pass before commit)
bunx tsc --noEmit -p tsconfig.json        # typecheck (zero errors)
bun test                                   # tests green (note pre-existing failures first)
bun run ronin list                         # smoke: duties still load
bun run ronin --help                       # smoke: CLI boots
```

- **Baseline first:** before Phase 0 changes, run the four commands above and
  record the starting state (pre-existing tsc/test failures) in
  `docs/history/REFRACTOR_BASELINE.md`. Do not "fix" unrelated pre-existing
  failures; only ensure you introduce no new ones.
- Commit per phase with message `refactor(duty): <phase> — <summary>`.
- After each phase, append a short result note to this file under §9 Progress Log.

---

## 6. Phases

### Phase 0 — Safety net & docs  *(≈2h, zero logic risk)*

**Objective:** Establish a green baseline, declare canonical docs, reduce noise.

**Steps:**
1. Create branch and record baseline (§5).
2. `mkdir -p docs/history`. Move these root files into `docs/history/` (move, do
   not delete): `PHASE2_SUMMARY.md`, `PHASE3_SUMMARY.md`, `IMPLEMENTATION_SUMMARY.md`,
   `MODEL_SELECTION_COMPLETE.md`, `MODEL_SELECTION_IMPLEMENTATION.md`,
   `SYNTHESIS_OPTIMIZATION.md`, `DATABASE_USAGE_MIGRATION.md`.
3. Place `ARCHITECTURE.md` at repo root as the canonical model doc (provided
   separately). Apply one correction: in its model-router section, note the router
   **already exists** (`src/tools/ToolRouter.ts`) and the task is *consolidation*,
   not building.
4. Add a top-of-README pointer: "Canonical architecture: see `ARCHITECTURE.md`."

**Acceptance:** Four verification commands pass; only the listed docs moved; README
links `ARCHITECTURE.md`.

---

### Phase 1 — `Agent → Duty` hard rename  *(≈0.5–1 day, high surface / low logic risk)*

**Objective:** Rename the concept everywhere, one breaking pass, no alias.

**Rename map (symbols):**

| From | To |
|------|----|
| `BaseAgent` | `BaseDuty` |
| `interface Agent` | `interface Duty` |
| `AgentRegistry` | `DutyRegistry` |
| `AgentLoader` | `DutyLoader` |
| `AgentConstructor` | `DutyConstructor` |
| `AgentMetadata` / `AgentFileMetadata` | `DutyMetadata` / `DutyFileMetadata` |
| `AgentLifecycleEvent`, `AgentTask{Started,Progress,Completed,Failed}Event`, `AgentMetricEvent` | `Duty…` equivalents |
| `LoadAgentOptions`, `CreateAgentOptions`, `CancelAgentCreationOptions` | `LoadDutyOptions`, `CreateDutyOptions`, `CancelDutyCreationOptions` |
| `AgentAPI` | `DutyAPI` *(high churn — rename in same pass; it's the object passed to every duty)* |

**Paths:**

| From | To |
|------|----|
| `src/agent/` | `src/duty/` (`Agent.ts → Duty.ts`, `AgentLoader.ts → DutyLoader.ts`, `AgentRegistry.ts → DutyRegistry.ts`) |
| `agents/` | `duties/` |
| `src/cli/commands/create-agent.ts` | `create-duty.ts` |
| `src/cli/commands/cancel-agent-creation.ts` | `cancel-duty-creation.ts` |

**CLI verbs:** `agent → duty`, `create-agent → create-duty`,
`cancel agent-creation → cancel duty-creation`. Update help text and any
`ronin list` labels ("agents" → "duties").

**Steps:**
1. Move folders/files with `git mv` (preserves history).
2. Codemod identifiers using the rename map (whole-word, case-sensitive). Suggested:
   `grep -rl '<symbol>' src duties tests | xargs sed -i 's/\b<symbol>\b/<new>/g'`
   — one symbol at a time, longest names first to avoid partial overlaps.
3. Fix import paths broken by the folder moves (`../agent/ → ../duty/`).
4. Update `AGENTS.md` → `DUTIES.md` (rename + retitle), and persona files
   referencing "agent" terminology where it denotes the concept (not prose).
5. Keep `agents/` references in the **coupled cluster** working: if `src/task` or
   `src/kata` import Agent types, update only the *symbol*, never the cluster logic.

**Acceptance:** Four verification commands pass. `grep -rnE '\b(BaseAgent|AgentRegistry|AgentLoader)\b' src duties` returns nothing. `bun run ronin list` lists duties. `bun run ronin duty <name>` (or equivalent run verb) executes one duty end-to-end.

> **Note:** This is the highest-surface phase. Commit it alone, verify, then proceed.

---

### Phase 2 — Provider consolidation  *(≈0.5 day)*

**Objective:** One provider path. Providers live behind the router/adapters; the
`plugins/` provider files become thin compatibility shims or are removed.

**Steps:**
1. Grep for usage of each provider surface across `duties/` and `src/`:
   `api.grok`, `api.gemini`, `api.langchain`, and direct imports of
   `plugins/grok.ts` / `gemini.ts` / `gemini-cli.ts` / `langchain.ts`.
2. For each used surface, **preserve the call signature** but reimplement internals
   to delegate to the router/adapter (`src/tools/adapters/GeminiAdapter.ts`, etc.,
   via `ToolRouter`). Do not break `api.gemini(...)` call sites — back them with the
   adapter.
3. If a provider plugin has **no** remaining call sites, delete it.
4. `langchain`: if the router/adapters cover the use, shim then delete; if a duty
   relies on LangChain-specific graph features, leave it as a Tool (not a provider)
   and add a `TODO(architecture)` to evaluate later. Do **not** force-remove.
5. Ensure all model access flows through `ToolRouter`'s tiering
   (`local`/`smart`/`cloud`); keep `local` (Ollama) as the privacy-first default.

**Acceptance:** Verification commands pass. No duty imports `plugins/grok.ts`,
`plugins/gemini.ts`, or `plugins/gemini-cli.ts` directly. `bun run ronin ai list`
(or model list verb) still resolves providers. A smoke call through one adapter
succeeds (or fails identically to baseline if no key configured).

---

### Phase 3 — SAR envelope at the runner  *(≈0.5–1 day, the core win)*

**Objective:** Make SAR universal by wrapping every duty execution in a SAR chain
at the runner level — **without** modifying the 52 duties' internals.

**Read first:** `packages/sar/src/index.ts`, `packages/sar/src/executor/Executor.ts`,
`packages/sar/src/chain/Chain.ts`, `packages/sar/src/middleware/{tokenGuard,executionTracking,modelResolution}.ts`.
Wire to the actual exported API; the shape below is intent, not literal code.

**Steps:**
1. In the runner (`DutyRegistry.executeDuty()`, formerly `AgentRegistry.executeAgent()`
   ~line 727), build a default SAR envelope around the duty call:
   - Create an `Executor(api)` and a `MiddlewareStack` with `modelResolution`,
     `tokenGuard`, and `executionTracking` (logging).
   - Run `duty.execute()` as the **Respond** step inside a `Chain` so budget +
     tracking apply uniformly.
2. Add a per-run **budget**: a hard cap on steps/tokens read from config
   (default conservative). On breach, abort the chain and emit a failure event.
   Reuse `tokenGuard`; add a step counter if absent.
3. Make the envelope a **no-op-safe wrapper**: a plain `execute()` duty must behave
   identically to today, just with budget/logging/model-resolution applied around it.
   Verify against 3 plain duties (e.g. `web-researcher`, `system-info-collector`,
   `db-cleanup`) and the 5 existing SAR duties — no behavior regressions.
4. **Pilot opt-in (2–3 duties only):** convert `web-researcher` (and one other
   simple duty) to express Sense/Analyze/Respond explicitly via `createChain()`,
   as the reference pattern for future migrations. Document the pattern in
   `DUTIES.md`.
5. Do **not** convert the remaining duties in this pass.

**Acceptance:** Verification commands pass. Every duty now executes through the
envelope (add a log line / metric proving the chain wraps the call). The 3 plain +
5 SAR duties show no behavior change. A duty exceeding the configured budget aborts
cleanly with a failure event. `DUTIES.md` documents the opt-in SAR pattern.

---

## 7. Verification & rollback

- After each phase: run §5 commands, commit only if green.
- Rollback unit is the phase commit (`git revert <phase commit>`); phases are
  ordered so each is independently revertible.
- If Phase 1 (rename) destabilizes the build beyond ~2h of fixups, prefer landing
  it as a single squashed commit after the build is green rather than many partials.

---

## 8. Out of scope — future phases (DO NOT start here)

These are real but riskier; they need their own plan after this lands:

- **Remove `technique`** — coupled via `storage-v2`/`parser-v2` to kata/task/contract.
- **Remove/demote `kata`** — `src/task/engine.ts` and CLI depend on it.
- **`contracts/ → schema/`** rename — part of the coupled cluster.
- **Migrate all 52 duties** to explicit SAR phases (Phase 3 only adds the envelope +
  a 2–3 duty pilot).
- **Tool trust tiers** (`safe`/`guarded`/`dangerous`) + event provenance — security
  hardening from `ARCHITECTURE.md` §6; do after the envelope exists.

---

## 9. Progress log  *(agent appends here)*

- [x] Phase 0 — baseline recorded; docs consolidated; ARCHITECTURE.md landed.
- [x] Phase 1 — Agent→Duty rename; build green; smoke passed.
- [x] Phase 2 — provider consolidation; single router path.
- [x] Phase 3 — SAR envelope live; budgets enforced; pilot duties converted.
