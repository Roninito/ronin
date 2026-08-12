---
name: git
description: Git operations including AI commit-summary generation for review or changelogs.
---

# Git Skill

Generate formatted, AI-written summaries of recent commits. For ordinary git operations (status, log, diff, show, commit, push, pull, branch, checkout), use the `git` chat tools (git_status, git_log, git_diff, git_show, etc.) instead — this skill is specifically for the AI summarization step those tools don't do on their own.

## Abilities

### commit-summary
Generate an AI-written summary of recent commits, grouped and readable, for review or changelog use.
- Input: count (optional number, default 10), repoPath (optional string, defaults to cwd)
- Output: { success, summary: string, files_changed: number }. Requires Ollama running (optional env OLLAMA_HOST, default http://localhost:11434; OLLAMA_MODEL, default phi3).
- Run: bun run scripts/commit-summary.ts --count={count} --repoPath={repoPath}

## Requirements

- Git repository at repoPath (or the current working directory)
- Git CLI installed
- Ollama running and reachable at OLLAMA_HOST
