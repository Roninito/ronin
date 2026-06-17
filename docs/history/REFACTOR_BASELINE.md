# Refactor Baseline — recorded 2026-06-17

Branch: `refactor/duty-architecture`

## tsc --noEmit
Pre-existing errors: **849** (all pre-existing; zero introduced by this refactor).
Notable pre-existing errors include RTCIceServer/MediaStream DOM types, estimateTokens not found,
workflows/examples.ts module resolution, WorkflowEngine undefined index, ToolRouter arg count.
Do not fix these — only ensure Phase changes introduce no new errors.

## bun test
**66 pass, 0 fail** across 6 files (139ms).

## bun run ronin list
**66 agents** loaded successfully.

## bun run ronin --help
CLI boots and prints help text.

## Key codebase facts (corrections to ARCHITECTURE_CHANGES_PLAN.md)
1. `@ronin/agent` is a live tsconfig path alias (`"@ronin/*": ["src/*"]`) — must update to `@ronin/duty` in Phase 1.
2. Lifecycle events (`AgentLifecycleEvent`, `AgentTaskStartedEvent`, etc.) live in `src/tools/types.ts`, not `src/agent/`.
3. `AgentConstructor` and `AgentMetadata` are in `src/types/agent.ts`.
4. `AgentFileMetadata` / `loadAgentFileMetadata` are in `src/cli/utils/agent-metadata.ts`.
5. `langchain` plugin is actively used by `agent-creator-orchestrator.ts` for graph features — leave as Tool with TODO(architecture).
6. `AgentRegistry.ts` is 2101 lines.
7. ~10 agents import via `@ronin/agent/index.js`; the rest use relative `../src/agent/index.js`.
