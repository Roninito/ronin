# Architecture Note (2026-06-17)

> **Status: resolved and archived (August 2026).** The update this note
> calls for happened — see `../../ARCHITECTURE.md` (canonical). This file is
> kept only as historical record of that transition; nothing below is
> current guidance. Note that this note's own "Technique/Kata/Contract/Task
> deferred" framing is also now superseded: technique was removed, but
> kata/contract/task are permanent (the execution engine), not deferred for
> removal — see `../../ARCHITECTURE.md` §5.

**This document is outdated and preserved for historical reference.**

The canonical architecture is now:
- `architecture.html` (visual diagram on Desktop)
- `docs/ARCHITECTURE.md` — **needs update to reflect post-refactor state**

## Key Changes (Post-Refactor)

1. **Agent → Duty rename complete**
   - `BaseAgent` → `BaseDuty`
   - `AgentRegistry` → `DutyRegistry`
   - `AgentLoader` → `DutyLoader`
   - `src/agent/` → `src/duty/`
   - `agents/` → `duties/`
   - CLI: `create-agent` → `create-duty`

2. **SAR is now universal**
   - Every duty runs inside SAR envelope at `DutyRegistry.executeDuty()`
   - Middleware: logging → model resolution → smart trim → token guard → execution tracking
   - No longer optional middleware — enforced at runner level

3. **Provider consolidation**
   - `plugins/grok.ts` removed
   - `plugins/gemini.ts` removed
   - All AI access through `AIAPI` → providers (GrokProvider, GeminiProvider, etc.)

4. **Technique/Kata/Contract/Task deferred**
   - Code still exists (`src/technique/`, `katas/`, `contracts/`, `src/task/`)
   - CLI commands still exist (`ronin technique list`, etc.)
   - Coupled via `storage-v2.ts`, `parser-v2.ts` — removal is a separate project
   - Architecture no longer references them as core concepts

## Update Required

The main `docs/ARCHITECTURE.md` still references:
- Agent terminology (should be Duty)
- Technique/Kata as core concepts (should note they're deferred)
- Agent execution flow (should be Duty execution with SAR envelope)

See `docs/history/REFACTOR_SUMMARY.md` for complete change log.
