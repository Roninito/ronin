> **Status: superseded (August 2026), moved from the Desktop into version control.**
> This was a third, independent `ARCHITECTURE.md` — living only on a
> contributor's Desktop, declaring itself "Status: Canonical" while two other
> copies existed in the repo (`ARCHITECTURE.md` at root, a second one at
> `docs/ARCHITECTURE.md`), none of the three in sync. This is exactly the
> failure mode `../../ARCHITECTURE.md` §12 now exists to prevent. Its ideas
> (the "one idea," the three-concept model, the capability migration table)
> were folded into the real root `../../ARCHITECTURE.md` along with
> corrections — notably, this draft's §7.1 treated dropping kata entirely as
> the *recommended* option; that call is reversed in the canonical doc (kata
> is kept, permanently, as engine-internal — see `../../ARCHITECTURE.md` §5).
> Renamed on archive (from `ARCHITECTURE.md`) to avoid a same-name collision
> with the two other archived files below.

# Ronin Architecture

> **Status:** Canonical. This document is the single source of truth for Ronin's
> conceptual model. Where any `*_SUMMARY.md`, `MODEL_SELECTION_*.md`, or
> `PHASE*.md` file disagrees with this one, **this document wins** and the other
> should be moved to `docs/history/`.

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

MNGR is just the Duty whose Respond actions assign work to other Duties.

---

## 2. The two nouns

Ronin has **three first-class concepts.** Two are capabilities (the things a Duty
can invoke); one is the decider. Everything else is packaging or typing.

| Concept | Definition | Was called |
|---------|------------|------------|
| **Tool** | An atomic, typed, in-process capability (Bun/TS). Single typed input → typed output. MCP-exportable. Hot-path, model-callable via function-calling. | plugin methods |
| **Skill** | A markdown-defined, declarative, **language-agnostic** capability. May be multi-step or out-of-process; can shell out to Python/shell, not just Bun. Discoverable via its manifest. The AgentSkills-style unit. | skills, techniques |
| **Duty** | A SAR loop instance with a persona, an allowlist of Skills + Tools, a budget, and memory. The thing that *decides*. (Formerly "Agent.") | agents |

The Tool/Skill split is the one capability boundary worth keeping: **Tool** =
fast, typed, in-runtime; **Skill** = portable, declarative, language-agnostic.
They are different tiers, not synonyms. `technique` is dropped because it was a
third synonym for Skill that bought nothing and (unlike Skill) couldn't cross
language boundaries.

Supporting structure (not capability concepts — do not let these grow their own
runtimes):

| Concept | Definition | Was called |
|---------|------------|------------|
| **Tool Pack** | A namespaced bundle of Tools plus the adapter code backing them. Auto-discovered. | plugin (the file/folder) |
| **Duty Preset** | The markdown file that declares a Duty: persona + the Skills/Tools it may use + budget. How a Duty is *defined*, not a capability itself. | (new — formalizes AGENTS.md / persona.md) |
| **Schema** | The typed I/O contracts that Tools and Duties conform to. Cross-cutting. Not a "thing the system does." | contract |

---

## 3. Capability migration table

The current tree carries **six** capability folders. They collapse to **Tool +
Skill + Duty** as follows. Each row is an action item.

| Current | Reclassify as | Action |
|---------|---------------|--------|
| `agents/` | **Duty** | **Hard rename** `Agent` → `Duty` across code, CLI, docs (single breaking PR — see §7.3). Rename folder to `duties/`. `ronin list` → lists duties. |
| `plugins/` | **Tool Pack** (containing **Tools**) | Keep as bundles, but the unit of capability is the Tool, not the plugin. Each plugin method becomes a registered Tool with a Schema. |
| `skills/` | **Skill** (keep) | Stays as-is, elevated to a first-class concept. Standardize on the markdown manifest format. Skills may invoke Python/shell, not just Bun — preserve that. |
| `techniques/` | **— DROPPED —** | Delete. A technique was a synonym for Skill that couldn't cross language boundaries. Migrate any existing techniques into Skills (md defs). |
| `katas/` | **— DROPPED / demoted —** | Remove as a runtime concept. A kata was "a combination of techniques" → now just "a combination of Skills," which a Duty Preset already expresses by listing them. If a bundle proves reused across 3+ duties, reintroduce only as a named `$ref` array in Preset config — never a class or folder. *(Final call: §7.1.)* |
| `contracts/` | **Schema** | Promote to the shared type layer. Tools/Duties import from here. Not a capability — a dependency everything else conforms to. |

**Net effect:** six capability abstractions → **Tool + Skill + Duty**, with three
structural supports (Tool Pack, Duty Preset, Schema). Two whole concepts
(technique, kata) are deleted outright. The number of capability concepts a
contributor must hold drops from six to three.

### Provider plugins are a special case

`grok`, `gemini` (and the AI side of `langchain`, `rag`) are **not** Tools or
Duties — they are **model providers** that leaked into the plugin system. Move
them behind the model router (§5). After migration:

- `grok` plugin → router adapter. Deleted as a user-facing plugin.
- `gemini` plugin → router adapter. Deleted as a user-facing plugin.
- `rag` → expose as Tools (`rag.query`, `rag.add`) backed by the router.
- `langchain` → expose as Tools, or delete if the router covers the use case.

---

## 4. Orchestration: one spine, many sensors

There is one event bus and one scheduler. The three things that previously felt
like separate orchestration systems are reclassified:

| Previously | Now |
|------------|-----|
| Reactive triggers (cron, file-watch, webhook) | **Sensors.** They emit events into the bus; they do not run logic. Sense pulls from them. |
| Behavior tree (SAR/MNGR, katas) | **MNGR**, a coordinating Duty. Its tree is its Respond strategy; leaves are Tools. |
| Plan Workflow (Intent → Todo → Coder) | A **set of Duties** (Todo, Coder) plus Sensors, wired on the same bus. Not a second engine. |

```
Sensors ──► [ event bus ] ──► Duties (each a SAR loop) ──► effects ──► bus
                                  ▲
                                MNGR (coordinating Duty)
```

**Rules:**
1. One scheduler. One bus. No Duty owns shared state except the designated
   state-authority Duty for its domain (e.g. Todo owns the kanban).
2. Sensors are dumb. Logic lives in Duties.
3. Cross-Duty communication is events only. No direct calls into another Duty's
   internals. (This principle is already correct in the Plan Workflow — make it
   universal.)

---

## 5. Model router (finish this once)

A single router is the only path to a model. There are two public entry points:

```ts
api.ai.complete(prompt, opts)      // text in, text out
api.ai.callTools(prompt, opts)     // tool-calling loop
// ToolChat sits on top of these; it is not a third path.
```

- Providers (Ollama, Anthropic, Grok, Gemini, OpenAI) are **adapters** registered
  with the router, selected by tier (`local` / `smart` / `cloud`) or explicit
  `--model`.
- Privacy-first default stays: `local` (Ollama) unless a Duty's policy opts into
  cloud.
- **The router already exists** (`src/tools/ToolRouter.ts` + adapters in
  `src/tools/adapters/`). The task for Phase 2 is *consolidation* — routing the
  duplicate provider plugins (grok, gemini, langchain) behind the existing
  ToolRouter adapters — not building a new router.
- `MODEL_SELECTION_COMPLETE.md` and `MODEL_SELECTION_IMPLEMENTATION.md` have been
  archived to `docs/history/`.

---

## 6. Safety boundary (new, non-optional)

Ronin shares OpenClaw's attack surface: shell execution + file access + inbound
channels (Telegram/Discord). The `#ronin #plan` → Coder Bot path means **untrusted
channel input can propose executable work.** Manual approval is currently the only
gate. Hardening required:

1. **Per-run budgets.** Every Duty run has a hard cap on steps and tokens. Exceeding
   it aborts the loop. (Loop-guard against runaway SAR cycles.)
2. **Tool trust tiers.** Tag Tools `safe` / `guarded` / `dangerous`
   (`shell.exec`, `file.write` are `dangerous`). A Duty's allowlist must explicitly
   grant a tier. Channel-triggered Duties default to `safe` only.
3. **Provenance on events.** Every event carries its origin (sensor, channel, user).
   `dangerous` Tools refuse events whose provenance is an untrusted channel unless
   an approval event with a trusted origin is present.
4. **Approval is an event, not a side door.** Keep the existing approval API, but
   model approval as a first-class event with trusted provenance so it audits
   cleanly.

---

## 7. Decisions

### 7.1 Kata — the one remaining open call
`technique` is **dropped** (folded into Skill). That leaves kata, which was
defined as "a combination of techniques" → now "a combination of Skills." Two
options:

- **Drop entirely (recommended).** A Duty Preset already lists the Skills/Tools a
  Duty uses — that *is* the reuse mechanism. No kata concept, no `katas/` folder.
- **Demote to config shorthand.** If you have a concrete case of 3+ duties sharing
  an identical Skill bundle, allow a named `$ref` array inside Preset config
  (e.g. `skills: [$ref: recon-bundle]`). Still no class, no folder, no loader —
  just a reusable list.

Default to drop; reach for the `$ref` only when real duplication appears.

### 7.2 Skill format — LOCKED
Skills are **markdown-defined and language-agnostic.** A Skill may invoke Python,
shell, or any executable, not just Bun. This is the property that justified
keeping Skill over technique — preserve it as a hard requirement.

### 7.3 Naming sweep — LOCKED: hard rename
`Agent` → `Duty` is a **hard rename in one breaking PR.** Touches the base class,
loader, registry, CLI verbs, AGENTS.md, and persona files. No deprecated alias —
the project is pre-1.0 and self-hosted, so absorb the break once and move on.

---

## 8. Target tree (after migration)

```
ronin/
├── src/
│   ├── sar/            # the loop: Sense / Analyze / Respond
│   ├── duty/           # base Duty, loader, registry   (was agent/)
│   ├── tools/          # Tool registry + Schema binding
│   ├── router/         # model router + provider adapters (was grok/gemini plugins)
│   ├── bus/            # event bus + sensors (cron, file-watch, webhook, channels)
│   ├── memory/         # single store (SQLite/Drizzle)
│   └── index.ts
├── duties/             # your Duties               (was agents/)
├── tool-packs/         # bundled Tools             (was plugins/)
├── skills/             # markdown Skill defs (Python/shell/Bun)  (kept)
├── presets/             # Duty Preset md files (persona + skills + tools + budget)
├── schema/             # shared contracts          (was contracts/)
└── docs/
    ├── ARCHITECTURE.md # this file — canonical
    └── history/        # archived PHASE*/SUMMARY/MODEL_SELECTION docs
```

---

## 9. Migration order (suggested)

1. Land this `ARCHITECTURE.md`; move contradicting docs to `docs/history/`.
2. Promote `contracts/` → `schema/`. (No behavior change; unblocks the rest.)
3. Build the model router; convert grok/gemini plugins to adapters.
4. Establish the Tool registry; register plugin methods as Tools.
5. Rename `Agent` → `Duty` (the breaking PR).
6. Migrate `techniques/` into `skills/` (md defs); delete `techniques/`. Drop
   `katas/` (or demote to Preset `$ref` per §7.1). Formalize `presets/`.
7. Unify sensors onto one bus; fold Plan Workflow in as Duties.
8. Add budgets + tool trust tiers (§6).
