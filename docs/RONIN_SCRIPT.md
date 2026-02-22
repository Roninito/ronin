# Ronin Script

A Token-Efficient, AI-Native Context Language

Ronin Script is a lightweight, human-readable, AI-native domain language designed for:

- Agent memory snapshots
- Ontology graphs
- Tool orchestration
- Context dumps
- Structured reasoning
- Token-efficient LLM usage

It is intentionally simpler than JSON and more structured than free text.

Ronin Script is optimized for:

- Low token usage
- Easy generation by LLMs
- Easy parsing by simple rule-based systems
- Direct graph construction
- Direct tool invocation

---

## 1. Design Philosophy

Ronin Script is built on five principles:

### 1. Token Efficiency

Avoid repeated keys, quotes, braces, and structural overhead.

### 2. Human Readability

Multi-word identifiers are allowed without quotes.

Example:

```
account Chase Checking 2450.32 USD checking
```

### 3. AI-Native Structure

Entities and relationships are written in patterns that LLMs naturally reason over.

### 4. Minimal Syntax

Only a few structural rules:

- Newline separates statements
- Indentation defines nesting
- `:` defines lists or labeled properties
- First token defines entity type

### 5. Round-Trip Ready

Ronin Script supports:

- Input (context ingestion)
- Tool invocation
- Tool output embedding
- Relationship graph construction

All in one block.

---

## 2. Core Structure

A Ronin document has four logical sections:

1. Type Definitions
2. Entities
3. Tool Outputs (optional)
4. Relationships

Example skeleton:

```
# Type Definitions
account: name, balance, currency
relationship: subject, relation, object

# Entities
account Chase Checking 2450.32 USD

# Relationships
Chase Checking owns Visa
```

---

## 3. Type Definitions

Type definitions are optional but recommended.

**Format:**

```
type_name: field1, field2, field3
```

**Example:**

```
account: name, balance, currency, account_type, due
card: name, limit, balance, due, owner
relationship: subject, relation, object
```

**Purpose:**

- Defines schema
- Helps AI validate structure
- Helps deterministic parsing
- Enables static analysis

Type definitions do NOT enforce structure automatically — they define intent.

---

## 4. Entity Declaration

**Format:**

```
type value1 value2 value3
```

**Example:**

```
account Chase Checking 2450.32 USD checking due 2026-03-01
```

**Rules:**

- First token = entity type
- Remaining tokens follow declared field order
- Multi-word identifiers are allowed
- No quotes required
- No commas required unless defining lists

---

## 5. Labeled Properties

Used for:

- Lists
- Optional fields
- Extended properties
- Tool metadata

**Format:**

```
label: value1, value2
```

**Example:**

```
tags: bank, active
owners: Chase Checking, Amex Platinum
tool_input: monitor_balance, check_due_dates
```

**Rules:**

- Colon indicates labeled field
- Comma separates list items
- Lists are single-line
- No trailing commas
- Whitespace is ignored around commas

---

## 6. Nested Structures

Indentation defines nesting.

**Example:**

```
account Chase Checking 2450.32 USD checking
transactions:
  tx001 2026-02-15 -50.00 groceries tags: debit, food
  tx002 2026-02-16 -20.00 coffee tags: debit, food
```

**Rules:**

- Indentation = 2 spaces recommended
- Nested blocks belong to the immediately preceding entity
- Nested types may omit explicit type keyword if context is clear
- Nested entries follow type order defined in type definitions

---

## 7. Relationships

Ronin relationships are written in plain triple form:

```
subject relation object
```

**Example:**

```
Chase Checking owns Visa
Netflix paid_by Chase Checking
```

If defined in types:

```
relationship: subject, relation, object
```

**Rules:**

- Written under a relationships section (recommended)
- No prefix symbol required
- One relationship per line
- Objects may be comma-separated

**Example:**

```
Chase Checking owns Visa, DebitCard
```

These map directly to graph triples.

---

## 8. Tool Integration

Ronin Script supports direct tool orchestration.

### Tool Input

Entities may define which tools should process them.

**Example:**

```
tool_input: monitor_balance, check_due_dates
```

### Tool Metadata

```
tool: name, capabilities
```

**Example:**

```
tool finance_monitor capabilities: alert_low_balance, forecast_budget
```

### Tool Output

Tool outputs are first-class entities.

**Example:**

```
alert Chase Checking low_balance -100.00 2026-02-19 tags: urgent
forecast Chase Checking balance 2500.00 2026-03-01
```

This allows:

- Tool → Ronin output
- Ronin → AI ingestion
- AI → new reasoning
- Fully round-trip memory

---

## 9. Real-Time Snapshot Pattern

Ronin supports full world-state dumps.

**Example:**

```
account Chase Checking 2450.32 USD checking
tool_input: monitor_balance
last_tool_run: 2026-02-19 08:00

alert Chase Checking low_balance -100.00 2026-02-19
forecast Chase Checking balance 2500.00 2026-03-01
```

This supports:

- Agent memory
- State reconciliation
- Snapshot serialization
- Time-aware reasoning

---

## 10. Parsing Rules

Minimal deterministic parser:

1. Read line
2. If line matches `type value…` → entity
3. If line contains `:` → labeled property
4. If indented → nested entity
5. If matches `subject relation object` under relationships → triple

No braces required.
No quoting required.
No escape sequences required (unless implementing custom extension).

---

## 11. Comparison to JSON

**Ronin advantages:**

- ~40–60% fewer tokens
- No repeated field names
- No structural overhead
- Easier for LLM generation
- Direct graph compatibility

**JSON advantages:**

- Strict validation
- Widely supported
- Machine-native
- Schema-enforced

**Recommended approach:**

- Ronin for AI memory + reasoning
- JSON for external APIs + persistence

---

## 12. Best Practices

1. **Keep identifiers stable** — Do not rename entities arbitrarily.

2. **Keep relationships explicit** — Prefer `Netflix paid_by Chase Checking` over implicit relationships inside entities.

3. **Use lists sparingly** — Keep lists single-line and comma-separated.

4. **Keep nesting shallow** — Prefer 1-level nesting for readability.

5. **Snapshot frequently** — Ronin works best as a full-state dump.

---

## 13. Example Full Ronin Snapshot

```
# Type Definitions
account: name, balance, currency, account_type, due
alert: entity, type, value, date
relationship: subject, relation, object

account Chase Checking 2450.32 USD checking due 2026-03-01
tags: bank, active
tool_input: monitor_balance

alert Chase Checking low_balance -100.00 2026-02-19

Chase Checking owns Visa
Netflix paid_by Chase Checking
```

---

## 14. Reference to Ontology

Ronin Script integrates with Ronin's ontology (knowledge graph):

- **Entities** map to ontology **nodes**: the entity type becomes the node `type`, the first value(s) become `name`/`summary`, and optional metadata can be stored. Use `ingestRoninScriptToOntology` to sync a Ronin Script document into the graph.

- **Relationships** (subject relation object) map to ontology **edges**: `from_id` = subject, `to_id` = object, `relation` = relation. The same ingest function creates these edges.

- **When to use which**: Use Ronin Script for agent memory snapshots, context dumps, and aggregated views (e.g. `local.ronin_script.aggregate`). Use the ontology for graph queries (`ontology_search`, `ontology_related`, `ontology_context`) and skill/task context. Reference docs, tools, and skills synced by `ronin doctor ingest-docs` are discoverable via ontology with types `ReferenceDoc` and `Tool`.

See [PLUGINS.md](PLUGINS.md) for the ontology plugin and [AGENTS.md](../AGENTS.md) for the agent API including memory and data formats.

---

## 15. Future Extensions

Possible evolutions:

- Version header
- Schema enforcement mode
- Namespaces
- Lightweight validation engine
- Deterministic compiler to JSON
- Graph database export

---

## 16. Summary

Ronin Script is:

- A structured, AI-native DSL
- Optimized for token efficiency
- Designed for agent memory + ontology
- Human readable
- Graph-friendly
- Tool-friendly
- Round-trip compatible

It sits between:

- Free text (too loose)
- JSON (too verbose)

Ronin Script is for systems where **AI is not just consuming data — it is living inside it.**
