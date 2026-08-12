---
name: find-skills
description: Helps discover and install agent skills when asked things like "how do I do X", "find a skill for X", "is there a skill that can...", or when extending Ronin's capabilities. Use this when the requested functionality might exist as an installable skill.
---

# Find Skills

Discover and install skills using Ronin's own `ronin skills` CLI — not a third-party package manager. `ronin skills discover` searches both skills already installed locally (`~/.ronin/skills/` and the project's `skills/`) and, by default, remote skill listings on skills.sh and playbooks.com.

## When to Use This Skill

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Wants to extend Ronin with a new capability
- Wants to know what skills are already installed

## Commands

**Search local + remote skills:**
```bash
ronin skills discover [query]
```
Returns JSON: an array of `{ name, description, provider, repo?, ref? }`. `provider` is `"local"`, `"skills.sh"`, or `"playbooks.com"`. Omit the query (or pass nothing) to list everything.

**List only what's already installed:**
```bash
ronin skills list
```

**Inspect a skill's abilities before installing/using it:**
```bash
ronin skills explore <skill-name> [--scripts]
```

**Install a skill found via discover** (use the `ref` field from a remote result, or any git URL):
```bash
ronin skills install skills.sh:<owner>/<repo>/<skill> [--name <local-name>]
ronin skills install playbooks.com:<owner>/<repo>/<skill> [--name <local-name>]
ronin skills install <git-repo-url> [--name <local-name>]
```
Clones into `~/.ronin/skills/<name>` (or the project's `skills/` dir depending on config).

**Update an installed (git-backed) skill:**
```bash
ronin skills update <skill-name>
```

**Run an ability directly (mostly for testing after install):**
```bash
ronin skills use <skill-name> --ability=<ability-name> --params='{"key":"value"}'
```

## How to Help

1. Run `ronin skills discover <query>` with keywords from the request.
2. If a local match already covers it, mention it — no install needed.
3. If a remote match is the best fit, show its name/description and the `ronin skills install ...` command (built from its `ref`), and offer to run it.
4. If nothing relevant turns up, say so and offer to help directly instead — don't imply a skill must exist for every task.
