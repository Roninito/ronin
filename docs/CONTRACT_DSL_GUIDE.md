# Contract DSL & Cron Engine Guide

**Phase 7C** introduces **Contracts** and **Cron scheduling**, enabling you to automatically execute katas on a schedule or in response to events.

## Overview

### Problem
After writing a kata, how do you execute it? You need a way to:
- **Schedule** katas to run at specific times (e.g., every Monday at 9 AM)
- **Trigger** katas based on events (e.g., when another task completes)
- **Manage** multiple scheduled workflows

### Solution
**Contracts** are trigger bindings that map events/cron expressions to katas.

```
Trigger (Cron or Event)
    ↓
Contract (Binding)
    ↓
Spawn Task for Kata
```

### Architecture

```
CronEngine (every 60 seconds)
  ├─ Evaluate all cron contracts
  ├─ If match: emit contract.cron_triggered
  └─ ...
  
ContractEngine (always listening)
  ├─ Hear: contract.cron_triggered
  ├─ Emit: task.spawn_requested
  └─ ...
  
TaskExecutor (runs tasks)
  ├─ Hear: task.spawn_requested
  ├─ Create task for kata
  └─ Execute on schedule
```

---

## Contract DSL Syntax

### Basic Structure

```
contract NAME VERSION
  trigger TRIGGER_TYPE TRIGGER_VALUE
  run kata KATA_NAME KATA_VERSION
```

### Example 1: Cron Trigger (Schedule)

```
contract monthly.audit v1
  trigger cron 0 3 1 * *
  run kata finance.audit v2
```

**What it does:**
- Every 1st day of month at 3:00 AM
- Spawn a task for `finance.audit v2`

**Cron format:** `minute hour day month weekday`
- minute: 0-59
- hour: 0-23
- day: 1-31
- month: 1-12
- weekday: 0-6 (0 = Sunday)

### Example 2: Event Trigger (Reactive)

```
contract on.finance.updated v1
  trigger event finance.data.updated
  run kata finance.audit v2
```

**What it does:**
- When `finance.data.updated` event fires
- Spawn a task for `finance.audit v2`

---

## Cron Expression Guide

### Special Characters

| Symbol | Meaning | Example |
|--------|---------|---------|
| `*` | Any value | `* * * * *` = every minute |
| `*/N` | Every N | `*/5 * * * *` = every 5 minutes |
| `N-M` | Range | `0-30 * * * *` = first 30 minutes of hour |
| `N,M,O` | List | `0,15,30,45 * * * *` = at :00, :15, :30, :45 |

### Common Patterns

```
# Hourly
0 * * * *          # Every hour at :00

# Daily
0 0 * * *          # Every day at midnight
0 9 * * *          # Every day at 9 AM

# Weekly
0 9 * * 1          # Every Monday at 9 AM
0 9 * * 1-5        # Weekdays (Mon-Fri) at 9 AM
0 9 * * 0          # Every Sunday at 9 AM

# Monthly
0 0 1 * *          # First day of month at midnight
0 3 1 * *          # First day of month at 3 AM
0 0 15 * *         # 15th day of month at midnight

# Multiple times
0 9,17 * * *       # 9 AM and 5 PM every day
*/15 * * * *       # Every 15 minutes
0 */6 * * *        # Every 6 hours
```

---

## Contract Management

### Create a Contract

```typescript
import { ContractParser } from "../src/contract/index.js";
import { ContractRegistry } from "../src/contract/index.js";

const dsl = `
contract monthly.report v1
  trigger cron 0 9 1 * *
  run kata report.generate v1
`;

const parser = new ContractParser();
const ast = parser.parse(dsl);

const registry = new ContractRegistry(api);
const contract = await registry.register(ast);
```

### Query Contracts

```typescript
// Get all active contracts
const active = await registry.getActive();

// Get cron contracts only
const cronContracts = await registry.getByTrigger("cron");

// Get contracts for a kata
const forKata = await registry.getByKata("finance.audit", "v1");

// Get by ID
const contract = await registry.getById("contract-123");
```

### Deactivate/Activate

```typescript
// Stop running a contract
await registry.deactivate("contract-123");

// Resume
await registry.activate("contract-123");
```

---

## Cron Helpers

### Evaluating Cron Expressions

```typescript
import { CronEvaluator } from "../src/contract/index.js";

// Check if expression matches now
const matches = CronEvaluator.matches("0 9 * * 1-5");
// true if it's 9 AM on a weekday right now

// Check at specific time
const date = new Date("2026-02-24T09:00:00");
const match = CronEvaluator.matches("0 9 * * *", date);
// true
```

### Next Execution Time

```typescript
// Get next execution time for expression
const next = CronEvaluator.getNextExecution("0 9 * * *");
// → 2026-02-25T09:00:00Z (tomorrow at 9 AM)

// Get next 5 execution times
const nexts = CronEvaluator.getNextExecutions("0 9 * * *", 5);
// → [2026-02-25T09:00:00Z, 2026-02-26T09:00:00Z, ...]
```

### Building Expressions Programmatically

```typescript
import { CronBuilder, CronPatterns } from "../src/contract/index.js";

// Use patterns
const daily9am = CronPatterns.every_day_9am;  // "0 9 * * *"
const weekdays = CronPatterns.weekdays_9am;   // "0 9 * * 1-5"

// Build custom expressions
const expr = new CronBuilder()
  .atMinute(0)
  .atHour(9)
  .onWeekday([1, 2, 3, 4, 5])  // Mon-Fri
  .build();
// → "0 9 * * 1,2,3,4,5"
```

---

## Real-World Examples

### Example 1: Daily Report Generation

```
contract daily.sales.report v1
  trigger cron 0 8 * * *
  run kata report.sales v1
```

**When:** Every day at 8:00 AM  
**What:** Generates and distributes sales report

### Example 2: Weekly Cleanup

```
contract weekly.cleanup v1
  trigger cron 0 22 * * 0
  run kata system.cleanup v1
```

**When:** Every Sunday at 10:00 PM  
**What:** Removes old logs, archives data

### Example 3: Every 6 Hours

```
contract periodic.health.check v1
  trigger cron 0 */6 * * *
  run kata system.health v1
```

**When:** Every 6 hours (12 AM, 6 AM, 12 PM, 6 PM)  
**What:** Checks system health, reports issues

### Example 4: Monthly Audit

```
contract monthly.financial.audit v1
  trigger cron 0 3 1 * *
  run kata finance.audit v2
```

**When:** First day of month at 3:00 AM  
**What:** Audits financial records, sends report

### Example 5: Reactive (Event-Driven)

```
contract on.user.signup v1
  trigger event user.registered
  run kata onboarding.welcome v1
```

**When:** When `user.registered` event fires  
**What:** Sends welcome email and sets up account

---

## How Contracts Execute

### 1. CronEngine Tick (Every 60 Seconds)

```
for each contract with trigger.type == "cron":
  if cronMatches(contract.trigger.expression, now):
    emit contract.cron_triggered {
      contractId, kataName, kataVersion, timestamp
    }
```

### 2. ContractEngine Hears Event

```
on contract.cron_triggered:
  emit task.spawn_requested {
    kataName, kataVersion, contractId
  }
```

### 3. TaskExecutor Creates Task

```
on task.spawn_requested:
  task = create task for kata
  task.state = pending
  save to database
```

### 4. KataRunner Polls & Executes

```
every 30 seconds:
  pending_tasks = find all pending
  for each task:
    executePhase(task)  ← runs skill, transitions phase
```

**Total latency:** Up to 60 seconds (cron evaluation) + 30 seconds (task polling) = 90 seconds from trigger to execution

---

## Event Flow Diagram

```
         CronEngine (60s interval)
              ↓
        Evaluate cron contracts
              ↓
    contract.cron_triggered event
              ↓
         ContractEngine
              ↓
    task.spawn_requested event
              ↓
        TaskExecutor
              ↓
        (spawns task in database)
              ↓
    KataRunner (30s poll interval)
              ↓
        executePhase(task)
              ↓
        SkillAdapter → SAR Chain
              ↓
        Execute skill, get result
              ↓
    Update task phase, emit events
```

---

## Integration with Katas

### Relationship: Kata → Contract → Task

```
Kata ("finance.audit v2")
  ├─ Defines: phases, skills, workflow
  └─ Immutable after registration
  
Contract ("monthly.audit v1")
  ├─ Trigger: cron 0 3 1 * *
  ├─ References: kata finance.audit v2
  └─ Can be activated/deactivated
  
Task ("task-abc-123")
  ├─ Instance of: kata finance.audit v2
  ├─ Spawned by: contract monthly.audit v1
  ├─ State: pending → running → completed
  └─ Variables: phase outputs
```

### Multi-Kata Contracts (Future)

**Phase 7D+:** Contracts could chain multiple katas or have conditional logic:

```
contract complex.workflow v1
  trigger cron 0 3 1 * *
  
  phase setup
    spawn kata data.setup v1
    next process
  
  phase process
    spawn kata data.process v1
    next notify
  
  phase notify
    run skill notify.admin
    complete
```

This would be a "meta-kata" that orchestrates other katas.

---

## Error Handling

### What if a cron doesn't match?
- Nothing happens (no event emitted)
- Engine continues to next contract

### What if task creation fails?
- ContractEngine catches error
- Logs failure
- Continues to next event

### What if task execution fails?
- TaskExecutor marks task as failed
- Emits task.failed event
- Next phase does NOT execute
- (Phase 3: will add retry policies)

### What if cron expression is invalid?
- CronEvaluator throws error
- ContractEngine catches and logs
- Engine continues (doesn't crash)

---

## Monitoring & Observability

### Events Emitted

```
contract.cron_triggered
  ├─ contractId
  ├─ contractName
  ├─ kataName
  ├─ kataVersion
  └─ timestamp

task.spawn_requested
  ├─ kataName
  ├─ kataVersion
  ├─ contractId
  └─ timestamp

task.created
task.state_changed
task.phase_changed
task.completed
task.failed
```

### Logging Example

```
[CronEngine] Cron triggered: monthly.audit (0 3 1 * *)
[ContractEngine] Contract triggered task: finance.audit v2
[TaskEngine] Created task: t1 for kata finance.audit v2
[TaskExecutor] Executing phase: gather
[SkillAdapter] Running skill: mail.search
[TaskExecutor] Transitioning to phase: analyze
...
[TaskEngine] Task t1 completed
```

---

## Configuration

### Enabling Contracts

In `agents/contract-executor.ts` agent (auto-enabled):

```typescript
export default class ContractExecutorAgent extends BaseAgent {
  async execute(): Promise<void> {
    this.cronEngine.start();      // Start 60s evaluator
    this.contractEngine.start();  // Start event listener
  }
}
```

The agent auto-starts when Ronin starts.

### Disabling a Contract

```typescript
await registry.deactivate("contract-id");
```

This prevents it from triggering without deleting it.

---

## Best Practices

### 1. Use Meaningful Contract Names

```
✅ monthly.financial.audit
✅ daily.system.cleanup
✅ weekly.report.generation

❌ contract1
❌ auto_task
❌ backup
```

### 2. Version Contracts

```
contract monthly.audit v1   ← Original
contract monthly.audit v2   ← Breaking change (new cron time or kata)
```

### 3. Document Complex Cron Expressions

```
contract complex.schedule v1
  # Runs every weekday at 9 AM and 5 PM
  trigger cron 0 9,17 * * 1-5
  run kata daily.report v1
```

### 4. Use Common Patterns

```typescript
// Good: Use predefined pattern
const weekday9am = CronPatterns.weekdays_9am;  // "0 9 * * 1-5"

// OK: Build with helper
const expr = new CronBuilder().atHour(9).onWeekday([1,2,3,4,5]).build();

// Avoid: Magic strings
const expr = "0 9 * * 1-5";  // What does this mean?
```

### 5. Start Simple

```
✅ Start with daily, hourly, weekly patterns
✅ Test contract triggers manually
✅ Monitor task execution

❌ Don't create complex cron (0 */6 9-17 * * 1-5) without testing
❌ Don't schedule too frequently (every minute)
❌ Don't forget contracts still exist after deployment
```

---

## Troubleshooting

### "Contract not triggering"

**Check:**
1. Is `contract-executor` agent running? (`ronin status`)
2. Is contract `active`? (`registry.getActive()`)
3. Does cron expression match current time? (`CronEvaluator.matches()`)
4. Are CronEngine and ContractEngine started?

### "Cron expression not matching"

**Test:**
```typescript
const matches = CronEvaluator.matches("0 9 * * 1-5");
console.log(matches);  // Should be true if it's 9 AM on weekday
```

### "Task created but not executing"

**Check:**
1. Is `kata-runner` agent running?
2. Does kata exist? (`registry.get()`)
3. Is task in `pending` state?
4. Are skills registered?

---

## Next Steps

- **Phase 7B:** Child task coordination (parent → child spawning)
- **Phase 7D:** Realms integration (distribute contracts across instances)
- **Phase 7E+:** Event-driven contracts (user requests, API webhooks)

---

## Summary

Contracts are the "trigger binding" layer that schedules and coordinates automated workflows:

```
Cron (timing) → Contract (binding) → Task (execution)
```

They enable production-ready automation with:
- ✅ Flexible scheduling (cron expressions)
- ✅ Event-driven triggers (extensible)
- ✅ Easy management (activate/deactivate)
- ✅ Full observability (event streams)
- ✅ No complex dependencies
