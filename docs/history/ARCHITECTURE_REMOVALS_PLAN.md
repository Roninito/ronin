> **Status: R0/R1 executed, R3 executed (August 2026); R2 optional and not
> confirmed done. Moved from the Desktop into version control.** See
> `../../ARCHITECTURE.md` §5 for the current, authoritative framing of
> kata/task/contract as the permanent execution engine — this plan's own
> conclusion (§1, §7: "do not delete kata") is what's now canonical, not a
> historical curiosity. Historical record only; if any operational detail
> below (line numbers, file sizes) disagrees with the current repo, the repo
> wins.

# Ronin — Removals & Decoupling Plan (Execution, Pass 2)

> **Audience:** Claude Code CLI.
> **Runs AFTER** `ARCHITECTURE_CHANGES_PLAN.md` (rename + provider dedupe + SAR
> envelope) has landed and is green.
> **Companion:** `ARCHITECTURE.md` (target model).
>
> **This plan is written to be reasoned about, not executed blindly.** Each
> removal states *why* it is safe, *what evidence* supports it, and *what would
> break* if done wrong. If your investigation contradicts a claim here, trust the
> code, stop, and record the discrepancy under §9 rather than forcing the change.

---

## 1. The finding that reshapes this plan

The `technique / kata / contract / task` folders are **not four redundant
capability layers.** They are a working execution engine plus one vestigial
member. Measured from the source:

```
  Contract ──targets──► Kata ──spawns──► Task ──runs phases──► Skills / Tools
  (WHEN: schedule/       (compiled        (a running        (leaf
   trigger; contracts_v2  phase-machine;   instance of a      capabilities)
   .target_kata)         the exec graph)   kata)

  Technique ─── intended mid-tier composition, but NOT executed at runtime.
              Only techniques/types.ts + techniques/migrations.ts are used by
              others — as the SHARED SCHEMA for the whole cluster.
```

**Evidence:**
- `src/task/engine.ts`: `spawn(kataName, kataVersion)` → a Task *is* a running
  kata; `currentPhase: kata.initial`. Task depends on `KataRegistry` + `KataStorage`.
- `src/contract/…`: `contracts_v2.target_kata` — a contract schedules a kata.
- `src/realms/types.ts`: an entire subsystem — "Distributed Kata Registry &
  Distribution" — built on `CompiledKata`.
- `agents/dojo-agent.ts`: **42** kata references (the Dojo builds katas).
- `techniques/executor.ts | parser.ts | loader.ts` are imported **only** by
  `src/cli/commands/technique.ts` and `src/cli/commands/start.ts` (the loader).
  **No duty, no engine executes techniques.**
- `techniques/types.ts` is a god-module exporting `Kata*`, `Contract*`, `Task*`,
  and `Trigger*` types; `techniques/migrations.ts` (`runTechniqueMigrations`)
  creates the tables for **all** of them. Its own header comment: *"New tables are
  additive — existing kata_definitions, tasks, and contracts…"*

**Conclusions that drive every phase below:**
1. **Remove `technique` the capability** — vestigial, low risk.
2. **Keep `kata`, `task`, `contract`** — they are the engine. Do **not** delete kata.
3. **Extract the shared substrate** out of `techniques/` first, or removing
   technique will break kata/task/contract persistence.
4. **Reclassify kata** as engine-internal (an execution graph), not a user-facing
   capability concept. Full kata removal is a separate, large project (§7).

---

## 2. Scope

| Do (this plan) | Do NOT (separate project — §7) |
|----------------|--------------------------------|
| Extract shared types/migrations out of `techniques/` | Remove or rewrite `kata` runtime |
| Delete `technique` capability (executor/parser/loader/storage/CLI) | Rewrite `task/engine.ts` execution model |
| Migrate authored `.technique` files → Skills | Touch `realms/` distribution |
| Optional: drop orphaned `techniques` tables (data) | Migrate `dojo-agent` off katas |
| Reclassify kata in docs | Remove `contract` or `task` |

---

## 3. Guardrails

1. **Substrate extraction is mechanical and behavior-preserving.** When moving
   types and the migration function, **do not change the SQL or table/column
   names.** The migrations are `CREATE TABLE IF NOT EXISTS` (idempotent) — keep
   them so existing SQLite data survives untouched.
2. Do **not** modify the *logic* of `kata/`, `task/`, or `contract/` engines —
   only their *import paths* (away from `techniques/`).
3. Phase R2 (dropping tables) is **destructive** and **optional/last**. Require a
   DB backup and explicit confirmation before running it.
4. If extraction reveals a runtime caller of the technique *executor* that this
   plan missed, stop and re-scope — the "vestigial" claim would be wrong.

---

## 4. Global conventions

```bash
git checkout -b refactor/remove-technique     # branch off the post-pass-1 main
# Verify after each phase:
bunx tsc --noEmit -p tsconfig.json
bun test
bun run ronin list
bun run ronin kata list        # cluster CLIs still work
bun run ronin task list
bun run ronin contract list
```

Back up the dev DB before R2: `cp ronin.db ronin.db.bak` (and any `~/.ronin/data/*.db`).

---

## 5. Module sizes (effort reference)

| Module | LOC | Disposition |
|--------|-----|-------------|
| `src/techniques/` | 1366 | **split:** extract substrate, delete the rest |
| `src/kata/` | 1394 | keep; repoint imports only |
| `src/contract/` | 1511 | keep; repoint imports only |
| `src/task/` | 1678 | keep; repoint imports only |
| `src/cli/commands/technique.ts` | ~20KB | **delete** |
| `src/cli/commands/{kata,task,contract}.ts` | 21/11/34KB | keep; repoint imports |

---

## 6. Phases

### Phase R0 — Extract the shared substrate  *(the keystone — do first)*

**Why:** `techniques/types.ts` and `techniques/migrations.ts` are the schema for
kata/task/contract. Until they live in a neutral home, technique cannot be removed.

**Steps:**
1. Create `src/persistence/` (neutral; not tied to any capability).
2. Move the **shared** exports out of `src/techniques/types.ts` into
   `src/persistence/schema.ts`:
   - Kata: `KataRowV2`, `KataListFilters`, `KataDependency`
   - Contract: `ContractV2Definition`, `ContractV2Row`, `ContractListFilters`,
     `TriggerType`, `TriggerConfig`, `*TriggerConfig`, `FailureAction`,
     `FailureConfig`, `RetryConfig`, `AlertConfig`, `BackoffType`
   - Task: `TaskV2Row`, `TaskV2Status`, `TaskPhaseRow`, `PhaseStatus`,
     `TaskListFilters`
   - Shared: `SchemaField`, `SchemaDefinition` (if used by kata/contract)
   - **Leave behind** the technique-only types: `TechniqueStep`, `TechniqueAST`,
     `CompositeTechniqueAST`, `CustomTechniqueAST`, `TechniqueDefinition`,
     `TechniqueRow`, `TechniqueListFilters`, `TechniqueDependency`, `ReturnMapping`.
3. Move `techniques/migrations.ts` → `src/persistence/migrations.ts`; rename
   `runTechniqueMigrations` → `runStoreMigrations`. **Keep all SQL identical.**
   (It already creates technique + kata + contract + task tables; that's fine —
   it stays one idempotent migration runner. The `techniques`/`technique_dependencies`
   table creation stays for now; removed in R2.)
4. Repoint imports in:
   `src/kata/storage-v2.ts`, `src/task/storage-v2.ts`, `src/contract/storage-v2.ts`,
   `src/contract/parser-v2.ts`, `src/cli/commands/{kata,task,contract}.ts`
   from `../techniques/types.js` → `../persistence/schema.js` and
   `../techniques/migrations.js` → `../persistence/migrations.js`.
5. Build green. **No behavior change.** Same tables, same data, same SQL.

**Acceptance:** `grep -rE "from .*techniques/(types|migrations)" src` returns **only**
`src/techniques/*` and `src/cli/commands/technique.ts` (the soon-to-be-deleted
capability). The four verification commands pass; cluster CLIs unchanged.

---

### Phase R1 — Remove the technique capability

**Why safe:** after R0, nothing outside the technique capability itself imports
`techniques/`. The executor is referenced only by its own CLI + the start loader.

**Steps:**
1. Find and migrate authored techniques: locate `*.technique` files and any
   registered techniques (`ronin technique list`). For each, author an equivalent
   `skills/<name>/SKILL.md` (language-agnostic — Python/shell allowed). Record the
   mapping in `docs/history/TECHNIQUE_TO_SKILL.md`.
2. Remove the startup hook: delete the technique `loader` call in
   `src/cli/commands/start.ts`.
3. Delete `src/cli/commands/technique.ts` and unregister the `technique` verb in
   `src/cli/index.ts`.
4. Delete `src/techniques/` (`executor.ts`, `parser.ts`, `loader.ts`, `storage.ts`,
   `index.ts`, the technique-only `types.ts` remnants, `migrations.ts` — already
   moved in R0).
5. Remove `technique` from any docs/help text; update `ARCHITECTURE.md` migration
   table to mark technique **DONE**.

**Acceptance:** `grep -riE "\btechnique\b" src` returns nothing outside comments /
the schema's vestigial `depends_on_technique` column. `bun run ronin --help` shows
no `technique` verb. Build + tests green. `ronin kata/task/contract list` still work.

---

### Phase R2 — Schema cleanup  *(destructive · optional · last)*

**Why optional:** the `techniques` and `technique_dependencies` tables and the
`kata_dependencies.depends_on_technique` column become orphaned after R1. They do
no harm if left; drop them only for tidiness.

**Steps (only after DB backup + confirmation):**
1. Add a forward migration in `src/persistence/migrations.ts`:
   - `DROP TABLE IF EXISTS technique_dependencies;`
   - `DROP TABLE IF EXISTS techniques;`
   - Rebuild `kata_dependencies` without `depends_on_technique` (SQLite needs
     create-new → copy → drop-old → rename; preserve `depends_on_skill`,
     `depends_on_tool`, and the `UNIQUE` constraint minus the technique column).
2. Gate it behind a version check so it runs once and is idempotent on re-run.

**Acceptance:** fresh DB and migrated existing DB both end with no `techniques*`
tables and a `kata_dependencies` table lacking `depends_on_technique`; all cluster
CLIs pass; `ronin kata show <name>` renders dependencies (skills/tools) correctly.

---

### Phase R3 — Reclassify kata  *(documentation, no code removal)*

**Why:** kata is the engine's compiled execution graph, not a user-facing
capability tier. Stop presenting it alongside Tool/Skill/Duty; present it as
engine-internal so the three-concept model stays clean.

**Steps:**
1. In `ARCHITECTURE.md`, add a short "Engine internals" note: *Contract schedules →
   Kata (compiled phase-graph) → Task (a run) → Skills/Tools*. Kata is how the SAR
   engine sequences multi-phase work; it is not something a contributor authors as
   a capability.
2. Optionally rename the user-facing term in help text from "kata" to "phase graph"
   / "flow" while keeping the code identifier `Kata` (avoid a churny rename of a
   1394-LOC subsystem + realms + dojo unless you want the §7 project).
3. **Do not remove kata.**

**Acceptance:** docs describe the three capability concepts (Tool/Skill/Duty) with
kata clearly placed as engine-internal. No code change required.

---

## 7. Out of scope — full kata removal (a separate large project)

If kata is ever to be removed entirely, scope it on its own. Cost, from the code:
- **Rewrite `src/task/engine.ts`** — Tasks are spawned from katas; the phase model
  would need a replacement execution primitive (e.g. SAR compositions).
- **Migrate `agents/dojo-agent.ts`** — 42 kata references; the Dojo's build target
  changes.
- **Delete or re-found `src/realms/`** — the distributed registry exists to share
  katas across instances; it loses its subject.
- **Re-home `contract.target_kata`** — contracts would target the new primitive.

Recommendation: **do not.** Reclassify (R3) instead. Kata as the engine's compiled
phase-graph is a legitimate primitive; only its *framing* as a user capability was
the problem, and R3 fixes that for free.

---

## 8. Net result after this plan

- Capability concepts presented to contributors: **Tool · Skill · Duty** (kata is
  engine-internal, not in the list).
- `techniques/` gone; its schema lives in a neutral `src/persistence/`.
- Authored techniques re-expressed as language-agnostic Skills.
- The execution engine (Contract → Kata → Task → Skills/Tools) intact and
  decoupled from the dead capability.
- No data loss; one optional destructive cleanup gated behind backup.

---

## 9. Progress log  *(agent appends)*

- [x] R0 — substrate extracted (landed in `src/database/migrations.ts`, not the
      originally-planned `src/persistence/` path — same move, different location);
      cluster decoupled; green.
- [x] R1 — technique capability removed; techniques migrated to skills.
- [ ] R2 — (optional) orphaned technique tables/column dropped; not confirmed done.
- [x] R3 — kata reclassified as engine-internal in docs (`../../ARCHITECTURE.md` §5).
- Discrepancy vs this plan: R0 targeted `src/persistence/` explicitly; the actual
  execution used `src/database/migrations.ts` instead (`runEngineMigrations`, not
  `runStoreMigrations`). Functionally equivalent, confirmed via `git log`.
