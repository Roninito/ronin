---
name: List All Skills
description: List every installed skill with its meta (_meta.json) and full description (skill.md/SKILL.md).
---

# List All Skills

Lists all AgentSkills from the skills directory (e.g. ~/.ronin/skills and project skills root). For each skill returns metadata (slug, version, ownerId, publishedAt when present) and the full skill description (frontmatter + body from skill.md or SKILL.md).

## When to Use

- See what skills are installed
- Get full docs for each skill (name, description, abilities)
- Inspect skill meta (version, slug) for tooling or discovery

## Requirements

- None (reads from filesystem only)

## Abilities

### list
List all skills with meta and full description. Scans the current skills root (sibling of this skill) and the user global skills dir (~/.ronin/skills). Returns slug, meta (slug, version, ownerId, publishedAt when present), name, description, and fullDescription for each skill.
- Input: none (reads from filesystem)
- Output: { skills: Array<{ slug, meta: { slug?, version?, ownerId?, publishedAt? }, name, description, fullDescription }> }
- Run: bun run scripts/list.ts
