# Knowledge Retrieval Guide: Plain Markdown Memory

## Overview

Ronin stores everything an agent might need to recall — notes, conversation transcripts, per-duty scratch state, and reference material synced from docs/tools/skills — as plain markdown files under `memory/`. There is no database, no vector store, no knowledge graph. Retrieval is a text search over files, not a query language.

This replaces two earlier, more complex systems that used to live here:
- **RAG (vector embeddings)** — removed entirely; vendor lock-in on the embeddings provider and re-embedding costs on every provider switch weren't worth it for what amounted to text search.
- **Ontology (a SQLite knowledge graph of nodes/edges)** — removed in favor of plain files. Structured relationships that used to be graph edges are now `[[wikilink]]`-style references inside note bodies: to find what's "related" to something, grep for `[[its-slug]]`.

**Why:** a database or graph makes it hard to see, at a glance, what's actually stored — including things that shouldn't be there (a stray secret, a stale entry). A directory of markdown files is inspectable with `cat` and `grep`, diffable, and has no schema to keep in sync with the code that reads it.

---

## Storage layout

```
memory/
  notes/<slug>-<hash8>.md      # store()/retrieve() key-value entries + addContext() freeform notes
  conversations/<duty>.md      # append-only per-duty conversation transcript
  blackboards/<duty>.md        # per-duty scratch/working state
```

`memory/` lives next to `ronin.db` (project root by default) and is gitignored — it's local state, not something to commit.

A note file looks like this:

```markdown
---
key: "tool-local.memory.search"
kind: "kv"
createdAt: "2026-09-04T12:00:00.000Z"
updatedAt: "2026-09-04T12:00:00.000Z"
---

​```json
{ "name": "local.memory.search", "summary": "Search Ronin's memory notes." }
​```
```

or, for a freeform note:

```markdown
---
kind: "note"
createdAt: "2026-09-04T12:00:00.000Z"
tags: ["skills"]
related: ["[[skill-refactor]]"]
---

Skill-maker created a new skill "refactor" after three failed attempts at parsing bash args — see [[skill-refactor]] for the working version.
```

There's no enforced schema beyond `key`/`kind`/timestamps — add whatever frontmatter fields are useful, and read them back as plain text.

## What gets stored where

- **`refdoc-*`** — reference docs (from `docs/`, `AGENTS.md`, etc.), synced by `ronin doctor ingest-docs`
- **`tool-*`** — every registered tool, synced by `duties/tools-indexer.ts` and `ronin doctor ingest-docs`
- **`skill-*`** — installed AgentSkills, synced by `duties/skill-maker.ts` (on creation) and `ronin doctor ingest-docs`
- **`codebase-file-*`** — TypeScript file summaries (exports, imports, complexity), by `duties/codebase-analyzer.ts`, overwritten daily
- **`system-current`** — current OS/CPU/memory snapshot, by `duties/system-info-collector.ts`, overwritten every 6h
- **`obsidian-<vault>-*`** — Obsidian vault note metadata (title, tags, wikilinks), by `duties/obsidian-vault-indexer.ts`
- **`artifact-*`** — artifact state mirrors, by `duties/artifact-manager.ts` and the `artifact_*` tools
- **freeform / ad hoc** — anything a duty writes via `api.memory.addContext()` or `api.memory.store()` with its own key convention (e.g. `messenger.ts`'s `conversation:<channel>:<user>`)

## Retrieving knowledge

There's one real pattern: **`local.memory.search(query, limit?)`** — a case-insensitive text search over `memory/notes/`, exposed to agents as a chat tool and to code as `api.memory.search()`. That's it. No separate "structured lookup" path — a `tool-local.memory.search.md` note and a freeform note about a past conversation are searched the same way.

```typescript
// From duty code:
const hits = await api.memory.search("refactor", 10);

// From an agent's chat tool call:
local.memory.search({ query: "refactor", limit: 10 })
```

Conversation transcripts and blackboards are duty-scoped and read directly, not searched:

```typescript
const history = await api.memory.getConversations("messenger", 50);
const scratch = await api.memory.getBlackboard("skill-maker");
```

## Relationships (instead of a graph)

A note can reference another by slug with `[[wikilink]]` syntax, in its `related` frontmatter or its body. There is no traversal API — "what's related to X" means searching for `[[x-slug]]` across `memory/notes/`. This is a deliberate simplification: most of what the old ontology graph's edges were used for (grouping a tool with its domain, linking a doc to the tool it describes) reads just as well as a sentence in the note body.

## Keeping it from growing unbounded

High-churn keys (tool call caches, per-call results, analytics counters) are the one place file-per-entry storage can bloat over time. `duties/db-cleanup.ts` runs nightly and prunes `tool.cache.*` (every run), `tool.result.*` (older than 3 days), and `analytics.*` (older than 14 days) via `api.memory.forgetByKeyPrefix()`. Duties that index the same thing repeatedly (codebase files, system info, tools, skills) use a **stable, deterministic key** so re-indexing overwrites the existing note instead of creating a new one — that's the file-system-native equivalent of a TTL, and it's why most of `memory/notes/` never grows past "one file per real thing," even without expiry logic.

## Best practices

1. **Use a stable key for anything re-indexed on a schedule.** `store("tool-local.memory.search", ...)` overwrites; `addContext("indexed a tool", ...)` accumulates a new file every run.
2. **Put the searchable text in the body, not just frontmatter.** `local.memory.search` matches the whole file, but a human skimming `memory/notes/` benefits from readable prose.
3. **Reference, don't duplicate.** Link to a doc's `sourcePath` instead of copying its full content into every note that mentions it (except `refdoc-*` notes, which intentionally embed the full doc for fast recall).
4. **Never write secrets into a note.** The whole point of moving off a database was making stored content visible — that only helps if nothing sensitive ends up there in the first place.

## See also

- [MEMORY_DB.md](MEMORY_DB.md) — the `api.memory` method reference and directory layout in more detail
- [Obsidian Integration Guide](OBSIDIAN_INTEGRATION.md) — vault configuration
- [LANGCHAIN_WHEN_TO_USE.md](LANGCHAIN_WHEN_TO_USE.md) — for when structured chains, not memory, are the right tool
