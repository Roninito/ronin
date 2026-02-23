# Knowledge Retrieval Guide: Ontology + Markdown

## Overview

Ronin uses a simple, powerful approach to knowledge retrieval:
- **Ontology** (structured) — For entity/skill lookup and semantic search
- **Markdown** (archival) — For documentation, examples, and full-text search
- **No embeddings** — No vendor lock-in, no re-embedding costs

This guide explains how to store, organize, and retrieve knowledge without RAG.

---

## Why No RAG (Embeddings)?

### The RAG Problem
```
RAG (Vector Embeddings):
├─ Vendor Lock-In: Ollama embeddings hardcoded
│  └─ Switch providers? Re-embed 1000s of vectors
├─ Maintenance: Custom implementation = bugs/support
├─ Cost: Regeneration expensive (time + compute)
└─ Isolation: Separate from ontology, parallel system
```

### The Better Approach
```
Ontology + Markdown:
├─ No Embeddings: Zero vendor dependency
├─ Simple: Just git + text
├─ Auditable: See exactly why data exists
└─ Fast: Ontology lookup + grep = efficient
```

**Result:** Simpler, more auditable, more future-proof.

---

## Knowledge Storage: Three Layers

### Layer 1: Ontology (Structured Knowledge)

**What it stores:**
- Entities (agents, skills, people, projects)
- Relationships (dependencies, ownership, tags)
- Metadata (descriptions, types, permissions)
- System information (hardware, runtime)
- Codebase structure (files, exports, imports)
- Obsidian vault notes (metadata, frontmatter, links)

**Structure:**
```typescript
const mySkillOntology = {
  id: "skill.refactor",
  name: "Refactor Code",
  description: "Automatically refactor code for readability",
  domain: "code",
  tags: ["refactoring", "code-quality", "automated"],
  inputs: [
    { name: "code", type: "string", description: "Code to refactor" },
  ],
  outputs: [
    { name: "refactored_code", type: "string", description: "Refactored code" },
  ],
  owner: "user123",
  created: "2024-01-15",
};
```

**Query methods:**
- Direct lookup: `ontology.getEntity("skill.refactor")`
- Search: `ontology.search("refactor", { domain: "code" })`
- Filter: `ontology.filterByTag("code-quality")`

---

### Layer 2: Markdown (Archival Knowledge)

**What it stores:**
- Documentation
- Examples
- Guides and tutorials
- Decision records
- Meeting notes

**Structure:**
```markdown
# Refactoring Skills

## Overview
Automated code refactoring using SAR chains.

## Examples

### Example 1: Extract Method
Input:
\`\`\`python
def process_data(items):
    total = 0
    for item in items:
        total += item['value']
    print(total)
\`\`\`

Output:
\`\`\`python
def sum_values(items):
    return sum(item['value'] for item in items)

def process_data(items):
    total = sum_values(items)
    print(total)
\`\`\`

## Guidelines
- Keep functions under 20 lines
- Use descriptive names
- Extract complex logic into helpers
```

**Query methods:**
- Full-text grep: `grep -r "refactor" docs/`
- Markdown parsing: Parse headers, code blocks
- File-based: Group by folder (e.g., `docs/skills/refactor.md`)

---

### Layer 3: Obsidian Vaults (User Knowledge Base) — *Phase 6*

**What it stores:**
- Personal notes and research
- Project documentation
- Reference materials
- Tagged knowledge
- Linked notes and relationships

**Structure:**
```markdown
---
title: Understanding Transformers
tags:
  - ai-research
  - deep-learning
  - nlp
---

# Understanding Transformers

Content about transformers. Links to [[LLM-Papers]] and [[Prompt-Engineering]].
```

**Query methods:**
- By title: `searchObsidianNotes(api, "Transformers")`
- By tag: `getObsidianNotesByTag(api, "ai-research")`
- By vault: `getObsidianVaultNotes(api, "main-vault")`
- Backlinks: `getObsidianBacklinks(api, "AI")`

**See:** [Obsidian Integration Guide](OBSIDIAN_INTEGRATION.md) for setup and examples.

---

### Layer 4: Agent Memory (Learned Knowledge)

**What it stores:**
- Conversation history
- User preferences
- Learned patterns
- Execution results

**Structure:**
```typescript
// In-memory or persistent store
const memories = await api.memory.search("refactor", { limit: 10 });
// Returns: [
//   { key: "refactor_success_2024-01-15", value: {...} },
//   { key: "refactor_error_2024-01-14", value: {...} },
// ]
```

**Query methods:**
- Search by key: `memory.retrieve("refactor_success_2024-01-15")`
- Search by query: `memory.search("python refactor", { limit: 10 })`
- Metadata filter: `memory.getByMetadata({ domain: "code" })`

---

## Retrieving Knowledge: Three Patterns

### Pattern 1: Ontology Lookup (Fast, Structured)

Use when: Finding specific entities or skills

```typescript
const ctx: ChainContext = {
  messages: [
    {
      role: "system",
      content: "You are a code refactoring assistant.",
    },
    {
      role: "user",
      content: "What refactoring skills are available?",
    },
  ],
  ontology: {
    domain: "code",
    relevantSkills: ["ontology.search"],  // Enable skill lookup
  },
  budget: { max: 8192, current: 0, reservedForResponse: 512 },
};

// During chain execution, LLM can call ontology.search
// which returns structured skill definitions
```

### Pattern 2: Full-Text Grep (Simple, Powerful)

Use when: Finding documentation or examples

```typescript
// Grep for refactoring examples in markdown
const examples = await api.shell?.exec(
  "grep -r 'refactor' docs/ | grep -i 'example'"
);

// Result: All markdown lines mentioning "refactor" and "example"
// Then parse/display for LLM context
```

### Pattern 3: Agent Memory (Contextual, Learned)

Use when: Remembering previous results or user preferences

```typescript
// Store refactoring result
await api.memory?.store(
  `refactor_${timestamp}`,
  {
    input: originalCode,
    output: refactoredCode,
    changes: ["extract_method", "rename_variable"],
  },
  { domain: "code", type: "refactor", success: true }
);

// Later: Retrieve similar refactors
const previous = await api.memory?.search("refactor python", {
  limit: 5,
  metadata: { domain: "code", success: true },
});
```

---

## Organizing Knowledge in Markdown

### Folder Structure
```
docs/
├── skills/
│   ├── refactor.md
│   ├── code-review.md
│   └── test-generation.md
├── agents/
│   ├── tool-calling-agent.md
│   └── messenger.md
├── guides/
│   ├── SAR_BEST_PRACTICES.md
│   ├── TOOL_INTEGRATION_GUIDE.md
│   └── ARCHITECTURE.md
└── decisions/
    ├── why-sar-over-langchain.md
    └── removing-rag.md
```

### Naming Conventions
- Skill docs: `docs/skills/{skill_name}.md`
- Agent docs: `docs/agents/{agent_name}.md`
- Guides: `docs/guides/{TITLE}.md`
- Decision records: `docs/decisions/{DECISION}.md`

### Markdown Format

```markdown
# {Skill/Agent/Topic} Name

## Overview
1-2 sentence description.

## Purpose
Why this exists.

## How It Works
High-level algorithm or approach.

## Examples

### Example 1: {Scenario}
**Input:**
\`\`\`code
...
\`\`\`

**Output:**
\`\`\`code
...
\`\`\`

**Explanation:** What changed and why.

## API / Usage
Code examples showing how to use.

## Limitations
What it doesn't do well.

## Related
Links to related skills/docs.
```

---

## Knowledge Retrieval in Agents

### Pattern: Ontology + Markdown Hybrid

Most agents use both layers:

```typescript
export default class CodeReviewAgent extends BaseAgent {
  async execute(): Promise<void> {
    // 1. Retrieve ontology skills
    const reviewSkills = await this.api.ontology?.search(
      "code-review",
      { domain: "code" }
    );

    // 2. Retrieve markdown examples
    const examples = await this.api.shell?.exec(
      `grep -A 5 "# Example" docs/guides/code-review.md`
    );

    // 3. Retrieve agent memory (previous reviews)
    const pastReviews = await this.api.memory?.search("code-review", {
      limit: 5,
      metadata: { success: true },
    });

    // 4. Build prompt combining all layers
    const systemPrompt = `
You are a code review expert.

Available skills:
${JSON.stringify(reviewSkills, null, 2)}

Examples:
${examples}

Your previous successful reviews (for reference):
${JSON.stringify(pastReviews, null, 2)}
    `;

    const ctx: ChainContext = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userRequest },
      ],
      ontology: {
        domain: "code",
        relevantSkills: ["ontology.search", "code.review"],
      },
      budget: { max: 8192, current: 0, reservedForResponse: 512 },
    };

    const stack = standardSAR();
    const chain = this.createChain();
    chain.useMiddlewareStack(stack);
    chain.withContext(ctx);
    await chain.run();
  }
}
```

---

## Ontology Schema

### Entity Definition
```typescript
interface OntologyEntity {
  id: string;                    // Unique identifier (e.g., "skill.refactor")
  name: string;                  // Display name
  description: string;           // 1-2 sentences
  domain: string;               // Category (e.g., "code", "documentation")
  type: "skill" | "agent" | "entity" | "relationship";
  
  // Metadata
  tags?: string[];              // For searching/filtering
  owner?: string;               // Owner/maintainer
  created?: string;             // ISO date
  updated?: string;             // ISO date
  status?: "active" | "deprecated" | "experimental";
  
  // Skill-specific
  inputs?: ToolParameter[];
  outputs?: ToolParameter[];
  
  // Relations
  relatedEntities?: string[];   // Other entity IDs
  examples?: string[];           // Markdown file paths
}
```

### Example Ontology Entry
```typescript
{
  id: "skill.refactor",
  name: "Refactor Code",
  description: "Automatically refactor code for readability, maintainability, and best practices",
  domain: "code",
  type: "skill",
  tags: ["refactoring", "code-quality", "automated", "python", "typescript"],
  owner: "dev-team",
  created: "2024-01-15",
  status: "active",
  inputs: [
    { name: "code", type: "string", description: "Source code to refactor" },
    { name: "language", type: "string", description: "Programming language (python, typescript, etc.)" },
  ],
  outputs: [
    { name: "refactored_code", type: "string", description: "Refactored code" },
    { name: "changes", type: "array", description: "List of changes made" },
  ],
  examples: ["docs/skills/refactor.md"],
  relatedEntities: ["skill.code-review", "agent.refactory"],
}
```

---

## Searching Knowledge

### Ontology Search
```typescript
// By domain
const codeSkills = await api.ontology?.search(
  "refactor",
  { domain: "code" }
);

// By tag
const qualitySkills = await api.ontology?.search("*", {
  tags: ["code-quality"],
});

// All skills
const allSkills = await api.ontology?.search("*");
```

### Markdown Search (Grep)
```typescript
// Find skill documentation
const skillDocs = await api.shell?.exec(
  `grep -l "refactor" docs/skills/*.md`
);

// Find all examples
const examples = await api.shell?.exec(
  `find docs/ -name "*.md" -exec grep -l "Example" {} \\;`
);

// Find decision records
const decisions = await api.shell?.exec(
  `grep -r "Decision:" docs/decisions/`
);
```

### Memory Search
```typescript
// Recent refactoring results
const recentRefactors = await api.memory?.search("refactor", {
  limit: 10,
  metadata: { domain: "code", success: true },
});

// Find by exact key
const specific = await api.memory?.retrieve(
  `refactor_2024-01-15_12:34:56`
);

// Find all in domain
const allCodeMemories = await api.memory?.getByMetadata({
  domain: "code",
});
```

---

## Best Practices

### 1. Keep Ontology Lean
- Store structure and relationships
- Don't duplicate markdown content
- Use references to docs instead

❌ Bad:
```typescript
{
  id: "skill.refactor",
  description: `Automatically refactor code...very long description...
    many details...examples...best practices...`,
}
```

✅ Good:
```typescript
{
  id: "skill.refactor",
  description: "Automatically refactor code for readability and best practices",
  examples: ["docs/skills/refactor.md"],  // Details in markdown
}
```

### 2. Use Consistent Naming
- IDs: `namespace.entity.name` (lowercase, dots)
- Tags: `kebab-case`
- Files: `UPPERCASE_TITLES.md`, `lowercase-skills.md`

### 3. Link Everything
- Markdown → Related entities via ontology IDs
- Ontology → Markdown docs via file paths
- Memory → Metadata for filtering

```typescript
// In markdown:
Related: See `skill.code-review` in ontology

// In ontology:
relatedEntities: ["skill.code-review"],
examples: ["docs/skills/refactor.md"],
```

### 4. Version Knowledge
- Keep decision records (why/how changed)
- Date new knowledge
- Mark deprecated entries

```typescript
{
  id: "skill.old-refactor",
  status: "deprecated",
  description: "Old refactoring approach (use skill.refactor instead)",
  updated: "2024-01-15",  // When deprecated
}
```

### 5. Memory Retention
- Don't store everything (costs memory)
- Use metadata for filtering
- Archive old memories periodically

```typescript
// Store with metadata for later filtering
await api.memory?.store(
  `refactor_${timestamp}`,
  { /* result */ },
  {
    domain: "code",
    language: "typescript",
    complexity: "high",
    success: true,
    timestamp,  // For archival queries
  }
);
```

---

## Comparison: Ontology vs Markdown vs Memory

| Use Case | Best Layer | Reason |
|----------|-----------|--------|
| List available skills | Ontology | Structured, fast lookup |
| Find examples | Markdown | Human-readable, comprehensive |
| Look up agent definition | Ontology | Quick reference |
| Understand design decision | Markdown | Narrative explanation |
| Find similar past results | Memory | Contextual, learned |
| Search documentation | Markdown | Full-text, grep-able |
| Understand relationships | Ontology | Graph/semantic |

---

## FAQ

**Q: Do I need to store everything in ontology?**  
A: No, only structural data. Use markdown for details/docs, memory for learned data.

**Q: How do I ensure ontology stays up-to-date?**  
A: Version in git, review with code. Treat like documentation.

**Q: Can I query across layers (ontology + markdown)?**  
A: Not automatically, but agents can. Query each layer separately, combine results.

**Q: What if markdown becomes too large?**  
A: Split into multiple files, organize by domain/skill.

**Q: Should I version markdown like code?**  
A: Yes, keep in git with commit history. Use git blame for audit trail.

**Q: How do I handle deprecated knowledge?**  
A: Mark in ontology with `status: "deprecated"` and link to replacement.

**Q: What about knowledge privacy/permissions?**  
A: Store in ontology metadata, check during agent execution.

---

## Summary

| Layer | Purpose | Query | Format |
|-------|---------|-------|--------|
| **Ontology** | Structure, entities, relationships | Fast lookup, search by domain/tag | JSON/TypeScript |
| **Markdown** | Documentation, examples, guides | Grep, file-based, full-text | Markdown |
| **Memory** | Learned patterns, results, preferences | Search API, metadata filtering | JSON |

**Principle:** Simple, auditable, no vendor lock-in.

**Next:** Read [LANGCHAIN_WHEN_TO_USE.md](LANGCHAIN_WHEN_TO_USE.md) for justified LangChain use cases.
