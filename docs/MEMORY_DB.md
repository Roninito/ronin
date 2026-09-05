# Ronin Memory (memory/)

Ronin's memory is plain markdown/text files under a `memory/` directory — no database, no query language. It lives next to `ronin.db` (project root by default) and is gitignored, same as the db. `ronin.db` itself only holds unrelated tables now (contracts, tasks, katas, usage) — memory/conversation/blackboard content is never stored there.

## Layout

```
memory/
  notes/<slug>-<hash8>.md      # store()/retrieve() key-value entries + addContext() freeform notes
  conversations/<duty>.md      # append-only per-duty conversation transcript
  blackboards/<duty>.md        # per-duty scratch/working state — read/write/append/overwrite
```

Every note is a markdown file with YAML frontmatter (key, kind, timestamps, tags) and a body — a `store()` entry's value round-trips through a fenced ` ```json ` block; an `addContext()` note is just prose. Relationships between notes are plain `[[wikilink]]` references, not a graph — "related" means grepping for `[[target-slug]]` across `memory/notes/`.

## API (`api.memory`, see `src/memory/Memory.ts`)

- `store(key, value)` / `retrieve(key)` — exact-round-trip key/value storage
- `search(query, limit?)` — case-insensitive text search over `memory/notes/`
- `addContext(text, metadata?)` / `getRecent(limit?)` — freeform notes, most-recent-first
- `forget(key)` / `forgetByKeyPrefix(prefix, updatedBefore?)` / `countByKeyPrefix(prefix)` — cleanup for high-churn keys (see `duties/db-cleanup.ts`)
- `addConversation(duty, role, content)` / `getConversations(duty, limit?)` — per-duty transcript log
- `getBlackboard(duty)` / `setBlackboard(duty, content)` / `appendBlackboard(duty, content)` — per-duty scratch state

Agents reach this from chat via the `local.memory.search` tool.

## Inspecting it

Since it's just files, read them directly — `cat memory/notes/*.md`, `grep -r "token" memory/` — no query language required. The `ronin kdb` CLI also wraps common lookups: `ronin kdb stats`, `ronin kdb memory search <query>`, `ronin kdb conversation <duty>`, `ronin kdb blackboard <duty>`.

## Notes

- `memory/` is separate from data files under `~/.ronin/data`.
- The parent directory tracks `--db-path`: passing a custom db path puts `memory/` alongside it.
