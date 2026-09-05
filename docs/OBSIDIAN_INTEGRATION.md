# Obsidian Vault Integration Guide

## Overview

Obsidian vault integration lets Ronin agents access your personal Obsidian knowledge base, alongside Ronin's own file-backed memory (`memory/notes/`), while maintaining security through folder-level access controls.

**Key Benefits:**
- ✅ Direct access to your personal notes
- ✅ Metadata extraction (tags, frontmatter, links)
- ✅ Daily automatic indexing
- ✅ Folder-level access control
- ✅ No vendor lock-in (pure local file system)
- ✅ Indexed metadata is searchable via `local.memory.search`

---

## Configuration

### Setup in config.json

```json
{
  "obsidian": {
    "vaults": [
      {
        "id": "main-vault",
        "path": "/Users/yourname/Documents/Obsidian/Main",
        "enabled": true,
        "allowedFolders": [
          "Projects",
          "Research/AI",
          "Research/LLMs",
          "Reference",
          "Templates"
        ]
      },
      {
        "id": "work-vault",
        "path": "/Users/yourname/Documents/Obsidian/Work",
        "enabled": false,
        "allowedFolders": [
          "Public",
          "Documentation"
        ]
      }
    ]
  }
}
```

### Configuration Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique vault identifier (use lowercase, no spaces) |
| `path` | string | Absolute path to vault root directory |
| `enabled` | boolean | Enable/disable vault indexing |
| `allowedFolders` | string[] | Folders within vault that Ronin can access (whitelist) |

### Access Control

Only folders in `allowedFolders` are indexed. For example:

```
/Users/yourname/Documents/Obsidian/Main/
├── Projects/          ✅ Accessible (in allowedFolders)
│   ├── AI.md
│   └── WebApp.md
├── Personal/          ❌ Not accessible (not in allowedFolders)
│   └── Private.md
├── Research/AI/       ✅ Accessible (in allowedFolders)
│   └── Papers.md
└── Reference/         ✅ Accessible
    └── Tools.md
```

---

## How Indexing Works

### Daily Schedule

The `obsidian-vault-indexer` agent runs automatically:
- **Schedule:** Daily at 2 AM
- **Duration:** Seconds to minutes (depends on vault size)
- **Log location:** Check agent output in dashboard

### Indexing Process

For each enabled vault:

1. **Discover** — Find all `.md` files in whitelisted folders
2. **Parse** — Extract frontmatter, title, tags, links
3. **Extract Metadata:**
   - Title (from frontmatter or first `#` heading)
   - Tags (from `frontmatter.tags` and `#hashtags` in content)
   - Wikilinks (`[[like this]]` references)
   - Timestamps (created, modified)
4. **Store** — Write a memory note per vault note, `memory/notes/obsidian-<vault_id>-<relative_path>.md`, keyed so re-indexing overwrites rather than accumulates
5. **Report** — Log statistics (indexed count, errors)

### What Gets Indexed

| Field | Source | Indexed |
|-------|--------|---------|
| Title | Frontmatter or first h1 | ✅ Yes |
| Content | File body | ❌ No (metadata only) |
| Frontmatter | YAML header | ✅ Yes (metadata) |
| Tags | Frontmatter + #hashtags | ✅ Yes |
| Wikilinks | `[[...]]` references | ✅ Yes |
| Timestamps | File metadata | ✅ Yes |

**Note:** Full note content is NOT indexed, only metadata — kept in the memory note's frontmatter/JSON body for fast text search via `local.memory.search`.

---

## Using Vault Notes in Agents

There's no separate query API for indexed vault notes — they're memory notes like any other, found with `api.memory.search`. See `duties/obsidian-vault-indexer.ts` for the indexing logic and exactly what's stored in each note.

### Find notes from a vault

```typescript
async execute(): Promise<void> {
  const hits = await this.api.memory.search("obsidian-main-vault", 20);
  for (const hit of hits) {
    console.log(hit.key, hit.text?.slice(0, 100));
  }
}
```

### Search vault notes by topic

```typescript
async execute(): Promise<void> {
  const hits = await this.api.memory.search("AI", 10);
  // Filter to obsidian-indexed notes if needed
  const vaultHits = hits.filter((h) => h.key?.startsWith("obsidian-"));
}
```

### Note Metadata Structure

Each indexed note's value (round-tripped via `api.memory.store`/`retrieve`) looks like:

```typescript
interface ObsidianNoteMetadata {
  source_agent: "obsidian-vault-indexer";
  vault_id: string;       // e.g., "main-vault"
  file_path: string;      // Absolute path
  relative_path: string;  // Path within vault
  title: string;          // Note title
  has_frontmatter: boolean;
  frontmatter?: {          // Parsed YAML header
    [key: string]: any;
  };
  tags: string[];          // All tags
  wikilinks: string[];     // [[...]] references
  backlinks: string[];
  created_at: number;      // Timestamp in ms
  modified_at: number;     // Timestamp in ms
  last_indexed_at: string; // ISO timestamp
}
```

---

## Vault Organization Best Practices

### Naming Conventions

Use clear, searchable names:

```
✅ Good
├── Projects/
│   ├── AI-Research.md
│   └── WebApp-2024.md
├── Research/
│   ├── LLM-Papers.md
│   └── Prompt-Engineering.md
└── Reference/
    ├── Tool-CLI-Guide.md
    └── Language-Reference.md

❌ Avoid
├── stuff/
│   ├── note1.md
│   └── note2.md
├── temp/
│   └── ideas.md
```

### Frontmatter Format

Use consistent YAML:

```yaml
---
title: Understanding Transformers
tags:
  - ai-research
  - deep-learning
  - nlp
created: 2024-01-15
status: complete
---

# Understanding Transformers

Content here...
```

### Linking Strategy

Use wikilinks consistently:

```markdown
This relates to [[LLM-Papers]] and [[Prompt-Engineering]].

See also: [[../Reference/Tool-CLI-Guide|Tool Guide]]
```

Backlinks will be discovered automatically:
- `[[AI-Research]]` creates a backlink relationship
- Use `[[file|display text]]` syntax for custom labels

---

## Troubleshooting

### Vault Not Being Indexed

**Symptom:** Agent logs show no notes indexed

**Checks:**
1. Is vault `enabled: true` in config?
2. Does vault path exist? `ls /path/to/vault`
3. Are folders in `allowedFolders` spelled correctly?
4. Does vault have `.md` files in those folders?

### High Memory Usage

**Symptom:** Indexing takes a long time

**Causes:**
- Very large vaults (1000s of notes)
- Large markdown files with complex frontmatter

**Solutions:**
- Start with smaller subset of folders
- Run agent manually off-hours if needed
- Check file sizes: `find /vault -name "*.md" -size +1M`

### Tags or Frontmatter Not Parsed

**Symptom:** Tags appear empty even with frontmatter

**Checks:**
1. Is YAML frontmatter between `---` delimiters?
2. Are tags in correct format? `tags: [tag1, tag2]` or `tags:\n  - tag1\n  - tag2`
3. Check for special characters or encoding issues

### Wikilinks Not Discovered

**Symptom:** Backlinks empty

**Checks:**
1. Are links in format `[[note-title]]`?
2. Are linked notes in indexed folders?
3. Links with paths work: `[[../path/to/note]]`

---

## Integration with Other Memory Notes

Obsidian-indexed notes live in the same `memory/notes/` directory as everything else Ronin indexes — system info (`system-current`, every 6h), codebase files (`codebase-file-*`, daily), tools (`tool-*`) and skills (`skill-*`). They're all searched the same way, via `api.memory.search`.

### Example: Combined Query

```typescript
async execute(): Promise<void> {
  const system = await this.api.memory.retrieve("system-current");
  const tools = await this.api.memory.search("code", 10);
  const research = await this.api.memory.search("code-generation", 10);

  const context = { system, tools, userKnowledge: research };
}
```

---

## Migration from Other Tools

### From Notion

If you used Notion before:
1. Export notes from Notion as markdown
2. Place in Obsidian vault folder
3. Add folder to `allowedFolders`
4. Next daily sync will index them

### From RAG (Removed)

RAG (vector embeddings) was removed from Ronin entirely — no re-embedding needed, there's simply nothing left to migrate. If you used it for personal knowledge:
1. Obsidian vaults are the recommended replacement for that use case
2. Import any valuable content into Obsidian
3. Configure vaults in config
4. The `obsidian-vault-indexer` duty will index it into `memory/notes/` on its next daily run

---

## Optional vs Required

**Important:** Obsidian vault integration is **optional**.

- If no vaults configured → agent skips silently
- No performance penalty if disabled
- Configuration saved in `obsidian` field (optional in config.json)

**Confirmation Flow:**
- `ronin doctor` checks if `obsidian.vaults` exists
- If exists and populated → agent runs daily
- If not configured → safely skipped

---

## Performance Notes

### Index Time

Typical performance:
- 100 notes: < 1 second
- 500 notes: 2-5 seconds
- 1000+ notes: 5-15 seconds

Depends on:
- Disk speed
- Frontmatter complexity
- File size
- System load

### Query Time

`local.memory.search` walks `memory/notes/` and matches text — fast at the note counts this produces (hundreds to low thousands of files); see [KNOWLEDGE_RETRIEVAL_GUIDE.md](KNOWLEDGE_RETRIEVAL_GUIDE.md) for the tradeoffs of that approach at larger scale.

### Storage

Metadata storage as memory notes:
- One markdown file per vault note (metadata + frontmatter, not full content)
- ~500 bytes–1KB per note on disk
- No additional external storage — just files under `memory/notes/`

---

## Future Enhancements

Possible Phase 7+ improvements:
- **Real-time sync** — Watch files for changes
- **Full-text search** — Index note content
- **Backlink graph visualization** — Show relationships
- **Auto-summary** — LLM-generated note summaries
- **Multi-vault relationships** — Link between vaults
