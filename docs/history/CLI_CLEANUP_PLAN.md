> **Status: archived (August 2026), moved from the Desktop into version control.**
> Historical record only — see `../../ARCHITECTURE.md` for current state.
> Correction: this plan's "technique... Remove in Phase R1" call was executed;
> kata/task/contract are **not** slated for removal (they're the permanent
> execution engine, reclassified engine-internal — see `../../ARCHITECTURE.md` §5),
> contradicting this plan's "Deferred Execution Engine" framing in spirit only
> (the commands themselves are accurately listed as kept).

# CLI Cleanup Plan

## Current State Analysis

### Commands (50 total)

**Core (Keep):**
- `start`, `stop`, `restart`, `kill` — process management
- `run`, `list`, `status` — duty management
- `create duty`, `create skill`, `create plugin` — creation
- `config` — configuration
- `ask` — AI queries
- `docs` — documentation viewer
- `init` — initialization
- `interactive` / `i` — REPL
- `daemon` — daemon management

**Integrations (Keep):**
- `realm connect`, `realm status`, `realm discover` — distributed mesh
- `mcp` — MCP server management
- `cloudflare` / `cf` — Cloudflare tunnels
- `os` — desktop mode (macOS)
- `client` — Electron desktop client

**Skills & Plugins (Keep):**
- `skills list`, `skills run` — skill management
- `plugins list`, `plugins info` — plugin inspection
- `routes` / `listRoutes` — HTTP routes

**AI & Scheduling (Keep):**
- `ai` / `models` — AI/model management
- `schedule` — schedule management
- `emit` — event emission
- `kdb` — knowledge DB queries

**Utility (Keep):**
- `version`, `update`, `doctor`
- `cancel` — cancel duty creation

**Deferred Execution Engine (Keep - Part of task/kata/contract cluster):**
- `kata list`, `kata show`, `kata create`, `kata test`, `kata validate`, `kata build`
- `task list`, `task show`, `task cancel`, `task retry`
- `contract list`, `contract show`, `contract create`, `contract execute`, etc.

**Vestigial (Remove in Phase R1):**
- `technique` — all subcommands (list, show, create, test, validate, register, deprecate, delete)

## Recommendations

### Phase 1: Update Help Text (Immediate)
The help text in `src/cli/index.ts` should accurately reflect current state:
- `technique` commands should be in a "Deferred" section
- Group commands logically

### Phase 2: Remove Technique CLI (Per ARCHITECTURE_REMOVALS_PLAN.md Phase R1)
This is a separate project that requires:
1. Migrate authored `.technique` files to Skills
2. Remove `src/cli/commands/technique.ts`
3. Remove technique imports from `src/cli/index.ts`
4. Remove technique startup hook in `src/cli/commands/start.ts`
5. Delete `src/techniques/` directory

### Phase 3: Reorganize Help (Optional)
Group commands by category:
```
Core:
  start, run, list, status, config, create, init

Duty Management:
  run <duty>, list, status

Creation:
  create duty, create skill, create plugin

Integrations:
  realm, mcp, cloudflare, os, client

Knowledge:
  kdb, docs, ask

Execution Engine (Advanced):
  kata, task, contract

Plugins & Skills:
  plugins, skills, routes
```

## Estimated Impact

| Action | Files Changed | Risk |
|--------|---------------|------|
| Update help text | 1 (src/cli/index.ts) | Low |
| Remove technique CLI | ~10 | Medium (requires R0 substrate extraction first) |
| Reorganize help | 1 | Low |

## Next Steps

1. **Update help text now** — clarify which commands are core vs. deferred
2. **Do NOT remove technique CLI yet** — requires Phase R0 (substrate extraction) from ARCHITECTURE_REMOVALS_PLAN.md
3. **Create "Deferred" section in help** — technique commands go there until removed
