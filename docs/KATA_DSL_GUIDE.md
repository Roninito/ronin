# Kata DSL Language Guide

**Kata DSL** is Ronin's human-readable orchestration language for multi-phase workflows. It enables you to define deterministic, versioned automation procedures that can be shared, executed, and debugged easily.

---

## Architecture: Where Kata Fits

### Three-Layer Architecture

Ronin uses three complementary layers for workflow automation:

```
┌──────────────────────────────────────────────────┐
│ Kata DSL (Human Authoring)                       │
│ "Compose workflows: spawn, sequence, branch"     │
└──────────────────────┬───────────────────────────┘
                       │ Executes via
┌──────────────────────▼───────────────────────────┐
│ SAR Chain (Semantic Runtime)                     │
│ "Execute phases with middleware & tokens"        │
└──────────────────────┬───────────────────────────┘
                       │ Delegates to
┌──────────────────────▼───────────────────────────┐
│ Skills (Atomic Capabilities)                     │
│ "Individual tools: mail.search, notify.user"     │
└──────────────────────────────────────────────────┘
```

**Each layer is independent and reusable.**

### Skills: The Bottom Layer

Skills are **atomic, stateless functions** registered in Ronin's tool registry:

```typescript
// Example: A skill is just a function
async function mailSearch(query: string) {
  return findEmailsMatching(query);
}

// Registered as a "skill"
// Available to: SAR chains, Kata workflows, agents
```

**Characteristics:**
- Single responsibility (do one thing)
- No state (each invocation is independent)
- Reusable from anywhere (SAR, agents, katas)
- Live code (no versioning)

**Examples:** `mail.search`, `finance.extract`, `notify.user`, `slack.send`

### SAR Chain: The Middle Layer

SAR is Ronin's **semantic runtime** that executes skills with:

- **Middleware stacks** (chainable composition)
- **Token budget** (track AI costs)
- **Ontology integration** (semantic awareness)
- **Audit trails** (full logging)

SAR can execute:
1. **Direct skill calls:** `chain.invoke("mail.search", input)`
2. **Kata phases:** Each kata phase runs via SAR

### Kata DSL: The Top Layer

Kata is Ronin's **orchestration language** for composing complex workflows:

```
kata finance.audit v2           ← Named & versioned
requires skill mail.search      ← Declare dependencies
requires skill finance.extract

initial gather                  ← Start here

phase gather
  run skill mail.search         ← Execute skill via SAR
  next analyze

phase analyze
  run skill finance.extract
  next alert

phase alert
  run skill notify.user
  complete                      ← End workflow
```

**Characteristics:**
- **Deterministic** (state machine, no hidden state)
- **Versioned** (immutable after registration)
- **Human-readable** (DSL, not code)
- **Auditable** (every transition logged)
- **Composable** (can spawn child katas)

**What Kata adds that skills can't provide:**
1. **State management** (task.variables flow through phases)
2. **Failure recovery** (retry policies, on-failure branches)
3. **Parallel execution** (spawn multiple children, join results)
4. **Conditional branching** (if/else based on previous results)

---

## Kata vs Skills: Key Differences

| Aspect | Skills | Kata |
|--------|--------|------|
| **Scope** | Atomic operation | Multi-phase workflow |
| **Authoring** | TypeScript/Python code | Human-readable DSL |
| **State** | Stateless | Stateful (task variables) |
| **Composition** | Manual in code | Declarative in DSL |
| **Versioning** | Live code (no versions) | Immutable (versioned) |
| **Execution** | Individual invocation | Deterministic state machine |
| **Failure handling** | Throws error | Configurable retry/branches |
| **Parallelism** | N/A (atomic) | Multi-child orchestration |

**Key insight:** Skills are building blocks. Kata is the composition layer.

### Example: Using Skills vs Kata

**Without Kata (just skills):**
```typescript
// Manually orchestrate
const searchResult = await mailSearch(...);
const analysis = await extractAnalysis(searchResult);
const notification = await notifyUser(analysis);
// If any step fails, you handle it manually
// If you want parallelism, you write Promise.all()
// If you want versioning, you deploy new code
```

**With Kata:**
```
kata finance.audit v2
requires skill mail.search
requires skill finance.extract
requires skill notify.user

initial gather

phase gather
  run skill mail.search       ← Automatic
  next analyze

phase analyze
  run skill finance.extract   ← Automatic
  next alert

phase alert
  run skill notify.user       ← Automatic
  complete
```

**Benefits of Kata:**
- ✅ Humans can understand and edit the workflow
- ✅ Workflow is versioned & immutable
- ✅ Automatic state management
- ✅ Built-in error recovery
- ✅ Fully auditable execution
- ✅ Easy to parallelize (add spawn blocks)
- ✅ Easy to add conditionals (if/else phases)
## Quick Start

### Minimal Kata

```
kata hello.world v1
  initial greet
  
  phase greet
    run skill greet.user
    complete
```

This defines a single-phase kata that runs the `greet.user` skill and completes.

### Multi-Phase Kata

```
kata finance.audit v2
  requires skill mail.search
  requires skill finance.extract
  requires skill notify.user
  
  initial gather
  
  phase gather
    run skill mail.search
    next analyze
  
  phase analyze
    run skill finance.extract
    next alert
  
  phase alert
    run skill notify.user
    complete
```

This defines a 3-phase workflow:
1. **gather** → searches email for financial data
2. **analyze** → extracts and analyzes trends
3. **alert** → notifies the user

---

## DSL Syntax

### Top-Level Declaration

```
kata <name> <version>
```

**Name Rules:**
- Dot-separated identifiers: `finance.audit`, `project.setup`, `email.process`
- Lowercase letters, numbers, dots only
- Must be unique per version

**Version Rules:**
- Format: `v<number>` (e.g., `v1`, `v2`, `v10`)
- Versions are immutable once registered
- Never edit a kata; create a new version instead

### Skill Requirements

```
requires skill <skill.name>
```

List all skills used in the kata's phases. Declaring requirements:
- **Validates** that all skills exist before execution
- **Documents** dependencies for readers
- **Fails fast** if a skill is missing

Examples:
```
requires skill mail.search
requires skill slack.send
requires skill file.write
```

### Initial Phase

```
initial <phase.name>
```

Specifies the first phase to execute. Must be defined later in the kata.

```
kata startup v1
  initial setup           # Must define 'setup' phase later
  
  phase setup
    ...
```

### Phases

```
phase <name>
  <action>
  <terminator>
```

A phase is a logical step in your workflow. Each phase has:

1. **One action** (either `run` or `spawn`)
2. **One terminator** (either `next`, `complete`, or `fail`)

#### Phase Actions

##### Run a Skill

```
phase process
  run skill data.transform
  next analyze
```

Executes a registered skill (from `requires skill` declarations).

**Skill execution:**
- Input: task variables from previous phases
- Output: stored in task variables under skill name
- If skill throws: task fails with error message

##### Spawn a Child Kata

```
phase setup
  spawn kata project.init v1 -> init_task
  next configure
```

Creates and awaits a child task (Phase 3 feature).

**Syntax:**
- `spawn kata <name> <version>`
- `-> <output.binding>` (optional, binds child output to variable)

**Semantics:**
- Parent transitions to `waiting` state
- Child executes independently
- When child completes: parent resumes from this phase (can proceed to next)
- If child fails: parent fails (or applies retry policy in Phase 3)

#### Phase Terminators

##### Next Phase

```
phase gather
  run skill fetch.data
  next analyze
```

Transitions to the named phase. The phase name must exist.

**Cycle Detection:** DSL compiler detects and rejects cycles.

```
# ❌ INVALID: cycle detected
phase a
  ...
  next b

phase b
  ...
  next a  # ERROR: cycle
```

##### Complete

```
phase alert
  run skill notify.user
  complete
```

Marks the task as successfully completed. No further phases execute.

##### Fail

```
phase validate
  run skill validation.check
  fail
```

Marks the task as failed. Use for explicit error conditions (Phase 3).

---

## Examples

### Simple Reminder

```
kata reminder.daily v1
  requires skill timer.sleep
  requires skill notification.send

  initial remind

  phase remind
    run skill notification.send
    complete
```

### Multi-Step Data Processing

```
kata data.pipeline v2
  requires skill data.fetch
  requires skill data.clean
  requires skill data.analyze
  requires skill report.generate

  initial fetch

  phase fetch
    run skill data.fetch
    next clean

  phase clean
    run skill data.clean
    next analyze

  phase analyze
    run skill data.analyze
    next report

  phase report
    run skill report.generate
    complete
```

### Nested Workflows (Phase 3)

```
kata project.delivery v1
  requires skill task.create
  requires skill slack.notify

  initial start

  phase start
    spawn kata project.plan v1 -> plan_result
    next execute

  phase execute
    spawn kata project.build v1 -> build_result
    next notify

  phase notify
    run skill slack.notify
    complete
```

---

## Type System & Variables

### Task Variables

Each task maintains a `variables` object that flows through phases:

```
phase gather
  run skill fetch.data    # Output: variables.fetch = {...}
  next process

phase process
  run skill transform     # Input: variables.fetch (from previous phase)
  next complete          # Output: variables.transform = {...}
```

**Variable Lifecycle:**
1. Initialize (empty `{}` or from spawn request)
2. Each phase's skill output stored under skill name
3. All previous variables available to next skill

### Phase Inputs/Outputs

**Inputs:** All task variables from previous phases
**Outputs:** Stored under skill name

```
variables = {
  "fetch.data": { ... },      // Phase 1 output
  "transform": { ... },        // Phase 2 output
  "generate": { ... }          // Phase 3 output
}
```

---

## Static Validation

The Kata DSL compiler validates **before registration**:

### 1. All Phases Reachable

```
# ❌ INVALID: dead_phase unreachable
kata example v1
  initial start
  
  phase start
    run skill a
    complete
  
  phase dead_phase  # Unreachable! Never executed
    run skill b
    next start
```

### 2. Every Phase Has Terminal

```
# ❌ INVALID: phase 'middle' has no next/complete/fail
kata example v1
  initial start
  
  phase start
    run skill a
    next middle
  
  phase middle
    run skill b
    # ERROR: missing terminator!
```

### 3. No Cycles

```
# ❌ INVALID: cycle a → b → a
kata example v1
  initial a
  
  phase a
    run skill x
    next b
  
  phase b
    run skill y
    next a   # ERROR: cycle detected
```

### 4. All Skills Declared

```
# ❌ INVALID: skill 'transform' not in requires
kata example v1
  requires skill fetch

  initial start

  phase start
    run skill transform   # ERROR: not declared!
    complete
```

### 5. Initial Phase Exists

```
# ❌ INVALID: initial phase 'start' undefined
kata example v1
  initial start

  phase setup
    run skill a
    complete
```

---

## Design Patterns

### Sequential Pipeline

```
kata etl v1
  requires skill extract
  requires skill transform
  requires skill load

  initial extract

  phase extract
    run skill extract
    next transform

  phase transform
    run skill transform
    next load

  phase load
    run skill load
    complete
```

**Use when:** Linear, ordered processing. Each phase depends on previous output.

### Parallel Orchestration (Future, Phase 3)

```
kata parallel.build v2
  requires skill compile.frontend
  requires skill compile.backend
  requires skill merge.results

  initial start

  phase start
    spawn kata build.frontend v1 -> fe
    spawn kata build.backend v1 -> be
    next merge

  phase merge
    run skill merge.results
    complete
```

**Use when:** Multiple independent tasks that later converge.

### Error Handling (Future, Phase 3 Retry Policy)

```
kata resilient.task v1
  requires skill api.call
  requires skill fallback.handler

  initial primary

  phase primary
    run skill api.call
    fail          # On error, invoke fallback

  phase fallback
    run skill fallback.handler
    complete
```

**Use when:** Graceful degradation or fallback strategies.

---

## Best Practices

### 1. Use Descriptive Skill Names

```
# ✅ GOOD: Clear intent
requires skill email.search
requires skill report.generate
requires skill slack.notify

# ❌ VAGUE
requires skill process
requires skill handle
requires skill send
```

### 2. Keep Phases Single-Purpose

```
# ✅ GOOD: One action per phase
phase fetch
  run skill data.fetch
  next validate

phase validate
  run skill validation.check
  next process

# ❌ UNCLEAR: Multiple concerns
phase fetch_and_validate
  run skill data.fetch
  # Can't also run validate here
```

### 3. Version for Compatibility

```
# ✅ GOOD: Increment version for breaking changes
kata report.monthly v1  # Original
kata report.monthly v2  # Changed skill requirements or phases

# Contracts can specify which version to run
contract monthly_report v1
  trigger cron 0 9 1 * *
  run kata report.monthly v2
```

### 4. Document with Comments (Future)

```
# Fetch financial data from email
kata finance.audit v2
  requires skill mail.search
  requires skill finance.extract
  requires skill notify.user

  initial gather
  
  # Gather phase: Search email for financial statements
  phase gather
    run skill mail.search
    next analyze
  
  # Analyze: Extract and analyze trends
  phase analyze
    run skill finance.extract
    next alert
  
  # Notify user of findings
  phase alert
    run skill notify.user
    complete
```

---

## Troubleshooting

### "Skill 'X' not registered"

**Error:** Tried to run skill that doesn't exist.

**Fix:**
1. Verify skill is declared: `requires skill x`
2. Verify skill is registered in system
3. Check spelling (case-sensitive)

### "Phase 'X' unreachable"

**Error:** Defined a phase but can't reach it from initial phase.

**Fix:**
1. Check initial phase name
2. Trace path: initial → next → next... should reach all phases
3. Ensure `next` statements form connected DAG

### "Cycle detected in phase graph"

**Error:** Phases form a loop.

**Fix:**
1. Check: phase A next B, B next C, C next A?
2. One phase must `complete` or `fail` to break cycle
3. Use `complete` to terminate workflow

### "Cannot re-register kata"

**Error:** Tried to register same kata/version twice.

**Fix:**
- Katas are immutable after registration
- Create new version: v1 → v2
- Or delete old registration (if supported)

---

## Grammar Reference

```
kata
  ::= "kata" IDENTIFIER VERSION
      requirement*
      "initial" IDENTIFIER
      phase+

requirement
  ::= "requires" "skill" IDENTIFIER

phase
  ::= "phase" IDENTIFIER
      action
      terminator

action
  ::= "run" "skill" IDENTIFIER
    | "spawn" "kata" IDENTIFIER VERSION ("-> "IDENTIFIER)?

terminator
  ::= "next" IDENTIFIER
    | "complete"
    | "fail"

IDENTIFIER  ::= [a-z][a-z0-9.]*
VERSION     ::= "v" [0-9]+
```

---

## Next Steps

- **Author a Kata** → See [KATA_AUTHORING.md](KATA_AUTHORING.md)
- **Run Tasks** → See [TASK_ENGINE_ARCHITECTURE.md](TASK_ENGINE_ARCHITECTURE.md)
- **Multi-Phase Workflows** → See Phase 3 documentation (coming)

---

## Wait Actions — Event-Driven Workflows (Phase 10)

**Wait actions** enable workflows to pause and wait for external events before continuing.

### Syntax

```
wait event <event.name>
wait event <event.name> timeout <seconds>
```

**Example:**
```
phase request
  run skill send.notification
  wait event user.approved timeout 3600
  next process
```

### Complete Example: Approval Workflow

```
kata expense.approval v1
requires skill send.email
requires skill process.expense
requires skill notify.user

initial submit

phase submit
  run skill send.email
  wait event expense.approved timeout 604800
  next check_decision

phase check_decision
  if variables.event_received.approved == true
    next approve_expense
  else
    next deny_expense

phase approve_expense
  run skill process.expense
  run skill notify.user
  complete

phase deny_expense
  run skill notify.user
  complete
```

**How it works:**
1. Send approval notification email
2. **Wait** for `expense.approved` event (up to 7 days)
3. When event arrives, check the decision
4. Route to approve or deny phase based on event data

### Event Data Access

When an event arrives, it's stored in `task.variables`:

```
phase submit
  wait event payment.completed timeout 300
  next process

phase process
  # Access event data in next phase
  # variables.event_received contains the event payload
  # variables.event_timestamp contains arrival time
  # variables.event_name contains event name
  run skill store.payment
  complete
```

### Use Cases

**Human Approval:**
```
phase approval
  run skill send.notification
  wait event user.approved timeout 3600
  next process
```

**Webhook Callback:**
```
phase api_call
  run skill call.external.api
  wait event webhook.response timeout 300
  next process
```

**Event-Driven Coordination:**
```
phase reserve
  run skill reserve.inventory
  wait event inventory.reserved timeout 600
  next notify
```

---

## Updated Grammar Reference

```
action
  ::= "run" "skill" IDENTIFIER
    | "spawn" "kata" IDENTIFIER VERSION ("-> "IDENTIFIER)?
    | "wait" "event" IDENTIFIER ("timeout" NUMBER)?

NUMBER  ::= [0-9]+
```

---

## Learn More

- **Complete Event Documentation** → See [EVENT_WAIT_GUIDE.md](EVENT_WAIT_GUIDE.md)
- **Conditional Routing** → See [CONDITIONAL_BRANCHING_GUIDE.md](CONDITIONAL_BRANCHING_GUIDE.md)
- **Example Workflows** → See `agents/example-approval-workflow.ts`
