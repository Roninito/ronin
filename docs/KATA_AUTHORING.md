# Kata Authoring Guide

A step-by-step guide to writing, testing, and deploying katas in Ronin.

## Overview

**Kata authoring is a 4-step process:**

1. **Understand the workflow** — What are the steps?
2. **Define the kata** — Write DSL
3. **Verify the kata** — Register and validate
4. **Deploy and monitor** — Run tasks and observe

---

## Step 1: Understand the Workflow

Before writing a kata, map the workflow clearly.

### Example: "Monthly Report Generation"

**Goal:** Generate and distribute a financial report monthly

**Steps:**
1. Fetch financial data from database
2. Transform/aggregate the data
3. Generate PDF report
4. Send report via email
5. Log completion

**Dependencies:** 
- Step 1 must complete before Step 2
- Steps 2, 3, 4 are sequential
- Step 5 is final

**Skills needed:**
- `finance.fetch` — Retrieve data
- `report.transform` — Aggregate
- `report.pdf.generate` — Create PDF
- `email.send` — Distribute
- `logging.record` — Record event

---

## Step 2: Write the Kata DSL

### Phase 1: Skeleton

Start with the kata name, version, and initial phase:

```
kata finance.report.monthly v1
  initial fetch

  phase fetch
    # TODO: implement
```

### Phase 2: Declare Skills

Add `requires skill` for each skill in the workflow:

```
kata finance.report.monthly v1
  requires skill finance.fetch
  requires skill report.transform
  requires skill report.pdf.generate
  requires skill email.send
  requires skill logging.record

  initial fetch

  phase fetch
    # TODO: implement
```

### Phase 3: Define Phases

Add phases in execution order. Each phase has:
- **Action**: `run skill X` or `spawn kata X`
- **Terminator**: `next Y` or `complete` or `fail`

```
kata finance.report.monthly v1
  requires skill finance.fetch
  requires skill report.transform
  requires skill report.pdf.generate
  requires skill email.send
  requires skill logging.record

  initial fetch

  phase fetch
    run skill finance.fetch
    next transform

  phase transform
    run skill report.transform
    next generate

  phase generate
    run skill report.pdf.generate
    next send

  phase send
    run skill email.send
    next log

  phase log
    run skill logging.record
    complete
```

### Phase 4: Add Comments (Optional)

Document intent for other authors:

```
kata finance.report.monthly v1
  requires skill finance.fetch
  requires skill report.transform
  requires skill report.pdf.generate
  requires skill email.send
  requires skill logging.record

  # Fetch financial data from primary database
  initial fetch

  phase fetch
    run skill finance.fetch
    next transform

  # Aggregate and transform data for reporting
  phase transform
    run skill report.transform
    next generate

  # Generate PDF from aggregated data
  phase generate
    run skill report.pdf.generate
    next send

  # Distribute report via email
  phase send
    run skill email.send
    next log

  # Record completion event
  phase log
    run skill logging.record
    complete
```

---

## Step 3: Verify the Kata

### Step 3A: Register the Kata

Use the KataRegistry to register:

```typescript
import { KataRegistry } from "../src/kata/registry.js";

const registry = new KataRegistry(api);

const kataSource = `kata finance.report.monthly v1
  requires skill finance.fetch
  ...
`;

try {
  const compiled = await registry.register(kataSource);
  console.log(`Registered: ${compiled.name} v${compiled.version}`);
} catch (error) {
  console.error(`Registration failed: ${error.message}`);
}
```

### Step 3B: Validation Checks

The compiler validates automatically:

**✅ Passes:**
- All phases reachable from initial
- Every phase has terminal or next
- No cycles
- All skills declared
- Initial phase exists

**❌ Fails with error:**

```
// ❌ Missing next phase
phase fetch
  run skill finance.fetch
  # ERROR: no next/complete/fail

// ❌ Undefined next phase
phase fetch
  run skill finance.fetch
  next undefined_phase  # ERROR: phase doesn't exist

// ❌ Unreachable phase
initial fetch

phase fetch
  run skill a
  complete

phase unused  # ERROR: unreachable from fetch

// ❌ Undeclared skill
phase fetch
  run skill undefined  # ERROR: not in requires list

// ❌ Cycle
phase a next b
phase b next a  # ERROR: cycle a→b→a
```

### Step 3C: Test Manually

Spawn a task and observe:

```typescript
import { TaskEngine } from "../src/task/engine.js";

const engine = new TaskEngine(api);
const task = await engine.spawn("finance.report.monthly", "v1");
console.log(`Created task: ${task.id}`);
console.log(`Current phase: ${task.currentPhase}`);
```

---

## Step 4: Deploy and Monitor

### Deploy: Register in Production

Add kata to an agent that registers it on startup:

```typescript
// agents/example-katas.ts

import { BaseAgent } from "@ronin/agent/index.js";
import { KataRegistry } from "../src/kata/registry.js";

export default class ExampleKatasAgent extends BaseAgent {
  async execute(): Promise<void> {
    const registry = new KataRegistry(this.api);
    await registry.register(FINANCE_REPORT_DSL);
    this.logger.info("Registered finance.report.monthly v1");
  }
}
```

### Monitor: Trigger and Track Tasks

Create a contract to trigger your kata:

```
contract monthly.finance.report v1
  trigger cron 0 9 1 * *
  run kata finance.report.monthly v1
```

Tasks are executed by `kata-runner` agent every 30 seconds:

```
Task #abc123: finance.report.monthly v1
  ├─ state: running
  ├─ phase: fetch (in progress)
  ├─ started: 2 minutes ago
  └─ events:
      ├─ task.created
      ├─ task.started
      └─ task.phase_changed
```

### Observe: Check Task Status

Query task status via API:

```typescript
const engine = new TaskEngine(api);
const task = await engine.getTask("abc123");

console.log(`Status: ${task.state}`);
console.log(`Phase: ${task.currentPhase}`);
console.log(`Variables: ${JSON.stringify(task.variables, null, 2)}`);
```

---

## Common Patterns

### Pattern 1: Simple Linear Pipeline

```
kata process v1
  requires skill step1
  requires skill step2
  requires skill step3

  initial step1

  phase step1
    run skill step1
    next step2

  phase step2
    run skill step2
    next step3

  phase step3
    run skill step3
    complete
```

**Use for:** Data processing, ETL, reporting

### Pattern 2: Conditional Logic (Future, Phase 3)

```
kata conditional v1
  requires skill check
  requires skill yes_action
  requires skill no_action

  initial check

  phase check
    run skill check
    fail  # If skill passes, continue
          # If skill fails, go to no_action

  phase yes_action
    run skill yes_action
    complete

  phase no_action
    run skill no_action
    complete
```

**Use for:** Decision points, branching workflows

### Pattern 3: Nested Workflows (Phase 3)

```
kata composite v1
  requires skill setup

  initial setup

  phase setup
    run skill setup
    next run_child

  phase run_child
    spawn kata child.task v1 -> result
    next finalize

  phase finalize
    run skill cleanup
    complete
```

**Use for:** Modular automation, reusable sub-tasks

---

## Troubleshooting Kata Authoring

### "Skill not registered"

**Problem:** Wrote `run skill x` but skill doesn't exist

**Solution:**
1. Check skill is available: `api.tools.getSchemas()`
2. Verify spelling (case-sensitive)
3. If custom skill: ensure it's registered with Ronin
4. Update `requires skill x` if skill name is correct

### "Phase unreachable"

**Problem:** Defined phase but can't reach from initial

**Solution:**
1. Trace the path: `initial → next → next... → complete`
2. Draw a diagram:
   ```
   fetch → transform → generate → send
                        ↑
                    unused_phase
   ```
3. Add `unused_phase` to the chain or remove it

### "Cycle detected"

**Problem:** Phases loop back (A → B → A)

**Solution:**
1. Identify the loop
2. Add `complete` to break the cycle
3. Example:
   ```
   phase a: next b
   phase b: next c
   phase c: complete  # ← breaks cycle
   ```

### "Kata won't register"

**Problem:** `register()` throws error

**Solution:**
1. Check DSL syntax (keywords, structure)
2. Run through validation checks mentally
3. Use example from guide as template
4. Check error message for specific issue

---

## Kata Naming Convention

Follow these patterns for consistency:

### Domain.Action.Variation

- `email.process.daily` — Process emails daily
- `finance.audit.monthly` — Monthly financial audit
- `project.setup.initial` — Initial project setup
- `report.generate.pdf` — Generate PDF reports
- `notification.send.slack` — Send Slack notifications

### Versioning Strategy

- `v1` — Initial release
- `v2` — Breaking changes (different skills, phases, inputs)
- `v3` — Major workflow changes

Do NOT increment version for:
- Bug fixes in skills
- Updated skill implementations
- Internal optimizations

**Version changes matter because:**
- Contracts pin to specific version
- You can run multiple versions simultaneously
- Users/contracts choose which to use

---

## Best Practices Checklist

- [ ] Workflow has clear start and end
- [ ] Each phase has single responsibility
- [ ] All skills are declared with `requires`
- [ ] All phases reachable from initial
- [ ] No unreachable dead code
- [ ] No cycles in phase transitions
- [ ] Phase names are descriptive
- [ ] Skill names match registered skills
- [ ] Kata is registered before running
- [ ] Documentation added (optional, recommended)

---

## Next Steps

1. **Write your first kata** using this guide
2. **Register and test** with KataRegistry
3. **Deploy** via agent or contract
4. **Monitor** tasks with TaskEngine
5. **Iterate** by creating new versions (v2, v3, etc.)

For advanced topics:
- See [TASK_ENGINE_ARCHITECTURE.md](TASK_ENGINE_ARCHITECTURE.md) for runtime details
- See [KATA_DSL_GUIDE.md](KATA_DSL_GUIDE.md) for language reference
