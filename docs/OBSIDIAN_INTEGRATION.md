# Obsidian Vault Integration Guide

## Overview

Phase 6 adds Obsidian vaults as a third memory source (alongside in-memory `api.memory` and the Phase 5 ontology system). This allows Ronin agents to access your personal Obsidian knowledge base while maintaining security through folder-level access controls.

**Key Benefits:**
- ✅ Direct access to your personal notes
- ✅ Metadata extraction (tags, frontmatter, links)
- ✅ Daily automatic indexing
- ✅ Folder-level access control
- ✅ No vendor lock-in (pure local file system)
- ✅ Integrates with ontology search

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
4. **Store** — Create ontology nodes for each note
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

**Note:** Full content is NOT indexed. Only metadata is stored in ontology for fast querying.

---

## Using Vault Notes in Agents

### Get All Notes from a Vault

```typescript
import { getObsidianVaultNotes } from "../src/ontology/schemas.js";

async execute(): Promise<void> {
  const notes = await getObsidianVaultNotes(this.api, "main-vault");
  
  for (const note of notes) {
    console.log(`${note.title} (${note.tags.join(", ")})`);
  }
}
```

### Search Vault Notes by Title

```typescript
import { searchObsidianNotes } from "../src/ontology/schemas.js";

async execute(): Promise<void> {
  const results = await searchObsidianNotes(this.api, "AI", "main-vault");
  
  for (const note of results) {
    console.log(`Found: ${note.title}`);
    console.log(`  Path: ${note.relative_path}`);
    console.log(`  Tags: ${note.tags.join(", ")}`);
  }
}
```

### Get Notes by Tag

```typescript
import { getObsidianNotesByTag } from "../src/ontology/schemas.js";

async execute(): Promise<void> {
  const notes = await getObsidianNotesByTag(this.api, "ai-research", "main-vault");
  console.log(`Found ${notes.length} notes tagged with "ai-research"`);
}
```

### Get Backlinks (Notes Linking to a Note)

```typescript
import { getObsidianBacklinks } from "../src/ontology/schemas.js";

async execute(): Promise<void> {
  // Find all notes that link to "AI.md"
  const backlinks = await getObsidianBacklinks(this.api, "AI", "main-vault");
  
  for (const note of backlinks) {
    console.log(`${note.title} links to AI`);
  }
}
```

### Note Metadata Structure

```typescript
interface ObsidianNoteMetadata {
  vault_id: string;      // e.g., "main-vault"
  file_path: string;     // Absolute path
  relative_path: string; // Path within vault
  title: string;         // Note title
  tags: string[];        // All tags
  wikilinks: string[];   // [[...]] references
  frontmatter?: {        // Parsed YAML header
    [key: string]: any;
  };
  created_at: number;    // Timestamp in ms
  modified_at: number;   // Timestamp in ms
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

## Integration with Knowledge Layers

### Three-Layer Knowledge System

Ronin now has three complementary knowledge sources:

```
Layer 1: System Info (Phase 5A)
  └─ Hardware, OS, runtime (updated every 6 hours)

Layer 2: Codebase (Phase 5C)
  └─ Exports, imports, file structure (updated daily)

Layer 3: Obsidian Vaults (Phase 6)
  └─ User notes, research, documentation (updated daily)
```

### Example: Combined Query

```typescript
async execute(): Promise<void> {
  // Get system capabilities
  const system = await getSystemCapabilities(this.api);
  
  // Get available tools
  const tools = await getAvailableTools(this.api, "code");
  
  // Get relevant research from vaults
  const research = await searchObsidianNotes(this.api, "code-generation");
  
  // Combine for context
  const context = {
    system,
    tools,
    userKnowledge: research
  };
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

If you used RAG before (Phase 2-5):
1. RAG data is gone (embeddings removed)
2. Obsidian vaults are the recommended replacement
3. Import any valuable content into Obsidian
4. Configure vaults in config
5. Ontology will index on next schedule

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

Ontology queries are fast:
- By tag: < 50ms
- By title: < 50ms
- By title pattern: < 100ms
- Full vault: < 200ms

### Storage

Metadata storage in ontology:
- ~500 bytes per note (metadata + frontmatter)
- 1000 notes ≈ 500 KB
- No additional external storage

---

## Future Enhancements

Possible Phase 7+ improvements:
- **Real-time sync** — Watch files for changes
- **Full-text search** — Index note content
- **Backlink graph visualization** — Show relationships
- **Auto-summary** — LLM-generated note summaries
- **Multi-vault relationships** — Link between vaults
