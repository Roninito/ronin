# Ronin Coding Guidelines

Single source of truth for how we write and refactor Ronin code. Aligns with the Semantic Agent Runtime (SAR) and supports the refactory agent.

## SAR alignment

- **Middleware-driven flow**: Prefer ordered middleware (ontology resolve → inject → trim → token guard → AI tool loop) over ad-hoc loops. See [SAR Coding guide V1.md](SAR%20Coding%20guide%20V1.md) and the implementation in `src/chain/`, `src/executor/`, `src/middleware/`.
- **Executor and Chain**: For tool-calling agents, use `this.use()` and `this.createChain()` from BaseAgent. Run with a `ChainContext` (messages, ontology, budget); keep tools behind the Executor and filter by ontology where relevant.
- **Serializable context**: Chain context must be persistable (messages, ontology, budget, phase). Do not put non-serializable handles in context that is saved.
- **Capability shaping**: Use ontology (domain, relevantSkills) so the AI sees only allowed tools for the current task.

## Code style and environment

- **TypeScript**: Agents and plugins are TypeScript. Use strict typing where practical.
- **Agents**: Live in `agents/`, extend `BaseAgent`, implement `execute()`. Follow [AGENTS.md](../AGENTS.md) for structure, optional `schedule`, `watch`, `webhook`.
- **API**: Use the `api` instance from the constructor (ai, memory, files, db, http, events, plugins, tools, config). No hardcoded secrets; use config, memory, or environment variables.

## Tasks and the Todo agent

**Always use tasks for work that should be tracked.**

The todo agent (tasking) is the state authority for task cards. You do not call it directly; you emit events and it reacts.

- **Create a task**: Emit `PlanProposed` with:
  - `id` (plan/task id)
  - `title`, `description`, `tags` (e.g. `["refactor"]`), `source` (your agent name)
  - Optional: `sourceChannel`, `sourceUser`
- **Update the task**: Emit `TaskAppendDescription` with:
  - `planId`, `content` (string to append), `timestamp`
- **Complete**: Emit `PlanCompleted` with `id`, `result` (and optional metadata).
- **Fail**: Emit `PlanFailed` with `id`, `error` (and optional metadata).

Refactory and any agent doing tracked work must create a task at start (or use an existing planId) and ask the todo agent to update status by emitting these events.

## Inter-agent communication

- **Prefer events**: Use the event bus for communication between agents. Emit domain events (e.g. `PlanProposed`, `SendTelegramMessage`, `TaskAppendDescription`) instead of calling another agent's code or shared I/O directly when a dedicated agent owns that capability.
- **Facilitator agents**: For shared capabilities (e.g. Telegram, Discord, task cards), one agent should "own" the integration. Other agents request the action by emitting an event; the facilitator agent handles the event and performs the API call or state update. This keeps credentials, resolution logic, and retries in one place and avoids duplication (e.g. every agent resolving `telegram_bot_id` / `telegram_chat_id`).

## Refactoring agents toward SAR

- Prefer converting agent logic into a Chain plus middleware stack instead of a single long `execute()` with manual tool loops.
- Use `this.use(middleware)` and `this.createChain().withContext(ctx).run()`.
- Keep tool execution behind the Executor; use ontology to restrict which tools the model sees for the current domain.
- When adding new tool-calling behavior, consider registering tools with the Executor (or the global router with a clear namespace) so the AI tool loop can drive execution.
