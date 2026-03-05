---
name: Recall
description: Find related prior context across Ronin memory artifacts, logs, and local project text.
---

# Recall

Searches for related historical context so Chatty can answer with evidence from prior runs.

## When to Use

- User asks "what did we do before", "recall", "remember", "history", or "context"
- You need to find matching content in `~/.ronin` logs or project files
- Memory/ontology results are insufficient and you need deeper text retrieval

## Abilities

### find-related
Find related snippets in `~/.ronin` and current project files using `rg`.
- Input: `query` (required), `limit` (optional, default 40)
- Output: `{ query, limit, results: [{ file, line, text }] }`
- Run: bun run scripts/find-related.ts --query={query} --limit={limit}
