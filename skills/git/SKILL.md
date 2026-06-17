---
name: Git Operations
description: Git operations including commit summary generation
---

# Git Skill

Perform git operations including generating formatted commit summaries.

## Operations

### commit-summary
Generate a formatted summary of recent commits for review or changelog.

**Description:** Scrape a git log and return a concise AI summary of changes.

**Inputs:**
- `count` (number, optional) - Number of recent commits to summarize (default: 10)

**Outputs:**
- `summary` (string) - Formatted summary of commits
- `files_changed` (number) - Total files changed across commits

## Requirements

- Git repository in current working directory
- Git CLI installed