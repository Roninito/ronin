> **Status: archived (August 2026), moved from the Desktop into version control.**
> Historical record of the `refactor/duty-architecture` branch. See
> `../../ARCHITECTURE.md` for current state. Correction: the "Deferred (Not In
> Scope)" section below lists `technique/kata/contract/task removal` as
> deferred future work — technique was in fact removed since, but
> kata/contract/task removal was **rejected**, not deferred (they're the
> permanent execution engine — see `../../ARCHITECTURE.md` §5).

# Ronin Architecture Refactor — Summary

**Branch:** `refactor/duty-architecture`
**Commits:** 18 total
**Date:** 2026-06-17

## Completed Phases

### Phase 0 — Safety Net & Docs ✅
- Baseline recorded (TypeScript errors, test status)
- Old docs moved to `docs/history/`
- `ARCHITECTURE.md` landed at project root

### Phase 1 — Agent → Duty Hard Rename ✅
- `BaseAgent` → `BaseDuty` (`src/duty/Duty.ts`)
- `interface Agent` → `interface Duty` (`src/types/duty.ts`)
- `AgentRegistry` → `DutyRegistry` (`src/duty/DutyRegistry.ts`)
- `AgentLoader` → `DutyLoader` (`src/duty/DutyLoader.ts`)
- CLI commands: `create-agent` → `create-duty`, `cancel-agent-creation` → `cancel-duty-creation`
- CLI flags: `--agent-dir` → `--duty-dir`
- Config: `externalAgentDir` → `externalDutyDir`
- Memory: `setAgentState/getAgentState` → `setDutyState/getDutyState`
- Database migration: `agent_name` → `duty_name` columns
- Path: `agents/` → `duties/` (backward compat via fallback)
- ~323 `agent` refs remain in `duties/` as internal variables (incremental cleanup)

### Phase 2 — Provider Consolidation ✅
- Removed `plugins/grok.ts` (not on DutyAPI, no call sites)
- Removed `plugins/gemini.ts` (not on DutyAPI, no call sites)
- Kept `plugins/langchain.ts` (used by `duties/agent-creator-orchestrator.ts`)
- Kept `plugins/gemini-cli.ts` (used by `duties/coder-bot.ts`)
- All AI access flows through `AIAPI` → providers (GrokProvider, GeminiProvider, OpenAIProvider, AnthropicProvider, OllamaProvider)

### Phase 3 — SAR Envelope at Runner ✅
- `DutyRegistry.executeDuty()` wraps all duties in SAR chain
- Middleware stack: logging → model resolution → smart trim → token guard → execution tracking
- Budget enforcement: default 12000 tokens, configurable per duty via `this.maxTokens`
- Duties with existing SAR middleware (`this.middleware` / `this.executor`) opt out gracefully
- Zero behavior change for existing duties

### Bugfixes
- Fixed typo: `this.dutys` → `this.duties` in DutyRegistry
- Fixed database migration for `agent_name` → `duty_name` columns

## Verification

```bash
bun run ronin list    # ✅ 57 duties found
bun run ronin start   # ✅ Starts successfully, 56 duties loaded
bunx tsc --noEmit     # 899 pre-existing TypeScript errors (baseline)
```

## What Changed

### Before
- 6 capability concepts: agent, plugin, skill, technique, kata, contract
- 5/57 duties used SAR (optional middleware)
- 2 provider stacks: grok/gemini/langchain plugins AND adapters
- Agent terminology throughout

### After
- 3 concepts: Tool, Skill, Duty
- 57/57 duties run under SAR envelope
- 1 provider path: adapters behind ToolRouter
- Duty terminology (Agent renamed)
- technique/kata/contract code deferred for later removal

## Files Changed (Key)

```
src/duty/Duty.ts           # BaseDuty (renamed from Agent.ts)
src/duty/DutyRegistry.ts   # SAR envelope in executeDuty()
src/duty/DutyLoader.ts     # loadDuty, discoverDuties
src/types/duty.ts          # interface Duty, DutyMetadata
src/memory/Memory.ts       # setDutyState, duty_name columns
src/cli/commands/create-duty.ts
src/cli/commands/config.ts  # --duty-dir, externalDutyDir
plugins/grok.ts            # DELETED
plugins/gemini.ts          # DELETED
duties/analytics.ts        # dutyStatuses, ensureDuty
duties/schedule-manager.ts # Duty terminology throughout
```

## Deferred (Not In Scope)

- `technique/`, `kata/`, `contract/`, `src/task/` removal — coupled via storage-v2/parser-v2
- CLI `technique` commands — code exists but architecture no longer references
- `contracts/ → schema/` rename
- Migrate remaining `duties/` internal variables to SAR phases

## Documentation

- `architecture.html` — Updated to reflect post-refactor state
- `ARCHITECTURE.md` — Canonical architecture doc
- `docs/history/` — Archived old docs (PHASE*, MODEL_SELECTION*, etc.)
