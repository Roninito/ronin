# Phase 7B: Child Task Coordination Guide

**Phase 7B** introduces **parent-child task relationships**, enabling complex multi-level workflows where tasks can spawn subtasks and wait for them to complete.

## Overview

### Problem
After Phase 7A, you can define multi-phase workflows. But what if you need **nested workflows** or **task decomposition**?

Example: A project setup kata needs to:
1. Initialize project directory
2. Set up dependencies
3. Configure environment
4. Generate scaffolding

Each step is complex enough to be its own kata. You want to:
- Define each as separate, reusable kata
- Have a parent kata orchestrate them
- Pass results between them

### Solution
**Child Task Spawning** lets parent tasks create child tasks and wait for them.

```
Parent Kata (Project Setup)
  ├─ phase: initialize
  │   └─ spawn kata: project.init → child_init_result
  │       ↓ Parent waits
  │       ↓ Child executes independently
  │   └─ when child completes: parent resumes
  │
  ├─ phase: configure
  │   └─ spawn kata: project.config → child_config_result
  │       ↓ Parent waits
  │       ↓ Child executes
  │   └─ when child completes: parent resumes
  │
  └─ phase: generate
      └─ run skill: scaffold.generate
      └─ complete
```

## Kata DSL for Child Tasks

### Spawn Syntax

```
spawn kata KATA_NAME VERSION -> OUTPUT_BINDING
```

**Example:**

```
kata project.setup v1
  requires skill scaffold.generate
  
  initial initialize
  
  phase initialize
    spawn kata project.init v1 -> init_result
    next configure
  
  phase configure
    spawn kata project.config v1 -> config_result
    next generate
  
  phase generate
    run skill scaffold.generate
    complete
```

**What happens:**
1. Parent starts in `initialize` phase
2. Spawns child task for `project.init v1`
3. Parent enters `waiting` state
4. Child executes independently (all its phases)
5. When child completes → parent resumes in `configure` phase
6. Repeats for `project.config`
7. Finally runs `scaffold.generate` skill
8. Completes

### Output Binding

```
spawn kata NAME VERSION -> binding_name
```

The `-> binding_name` binds the child task's final state to a variable:

```
phase setup
  spawn kata init v1 -> setup_result
  next proceed
```

After child completes:
```
task.variables.setup_result = {
  childTaskId: "task-123",
  success: true,
  output: { ... child final output ... }
}
```

## Task State Machine (Updated)

```
pending → running → waiting (Phase 7B feature)
                      ↓
                   (child executes)
                      ↓
          on child.completed: resume
                      ↓
                    running → [next phase]
                    
          on child.failed: fail
                      ↓
                    failed
```

**waiting state:**
- Parent has spawned a child
- Parent is blocked, not executing
- Child is independent (can fail without affecting parent execution)
- Parent resumes only when child completes

## Execution Flow

### Step-by-Step Example

```
1. Task#parent spawned for "project.setup v1"
   state: pending, phase: initialize

2. KataRunner polls
   → executePhase(task#parent)
   → Get phase.initialize: spawn kata project.init v1 -> init_result
   → ChildTaskCoordinator.spawnChild()

3. ChildTaskCoordinator
   ├─ Create task#child for "project.init v1"
   ├─ Set task#child.parentTaskId = task#parent
   ├─ Set task#parent.state = waiting
   └─ Emit task.child_spawned

4. KataRunner polls again (30 seconds later)
   → executePhase(task#child)
   → Execute child's phases: phase1 → phase2 → complete
   → Emit task.completed

5. ChildTaskCoordinator hears task.completed
   ├─ Find parent task (task#parent.parentTaskId = null, so this is completed child)
   ├─ task#parent in waiting → resume
   ├─ Call engine.nextPhase(task#parent) → phase: configure
   ├─ Set task#parent.state = running
   └─ Emit task.child_completed

6. KataRunner polls
   → executePhase(task#parent)
   → Get phase.configure: spawn kata project.config v1 → config_result
   → (repeat steps 3-5)

7. After second child completes
   → Parent transitions to phase.generate
   → Runs skill scaffold.generate
   → Emits task.completed

Timeline:
  T+0s:   Parent spawns init child
  T+0s:   Parent enters waiting
  T+30s:  Child phase1 executes
  T+60s:  Child phase2 executes
  T+90s:  Child completes → Parent resumes
  T+90s:  Parent spawns config child
  T+120s: Config child executes
  T+150s: Config child completes → Parent resumes
  T+150s: Parent runs skill
  T+180s: Parent completes

Total: ~3 minutes for 2 sequential children
```

## Event Emissions

### task.child_spawned

```typescript
{
  type: "task.child_spawned",
  parentTaskId: "task#parent",
  childTaskId: "task#child",
  childKataName: "project.init",
  childKataVersion: "v1",
  timestamp: 1708742400000
}
```

### task.child_completed

```typescript
{
  type: "task.child_completed",
  parentTaskId: "task#parent",
  childTaskId: "task#child",
  timestamp: 1708742500000
}
```

### task.child_failed

```typescript
{
  type: "task.child_failed",
  parentTaskId: "task#parent",
  childTaskId: "task#child",
  error: "Child task failed",
  timestamp: 1708742505000
}
```

## Error Handling & Retry Policies

### Default Behavior: Fail on Child Failure

```
Child fails
  ↓
ChildTaskCoordinator.handleChildFailure()
  ├─ Check retry policy
  ├─ No retries configured
  ├─ Fail parent with error
  ├─ Emit task.child_failed
  └─ Parent stops (waiting → failed)
```

Parent error message:
```
"Child task 'task-123' failed: Skill 'deploy' timed out after 30s"
```

### Retry Policy (Phase 7B+)

```typescript
interface RetryPolicy {
  maxRetries: number;           // How many times to retry
  backoff: "fixed" | "exponential" | "linear";
  baseDelay: number;             // milliseconds
  maxDelay: number;              // milliseconds cap
}
```

**Predefined Policies:**

```typescript
DefaultRetryPolicies = {
  // No retries (default)
  noRetry: {
    maxRetries: 0,
    backoff: "fixed",
    baseDelay: 0,
    maxDelay: 0,
  },

  // 3 retries with exponential backoff
  moderate: {
    maxRetries: 3,
    backoff: "exponential",
    baseDelay: 1000,      // 1s, 2s, 4s
    maxDelay: 60000,      // cap at 1 minute
  },

  // 5 retries with aggressive backoff
  aggressive: {
    maxRetries: 5,
    backoff: "exponential",
    baseDelay: 500,       // 500ms, 1s, 2s, 4s, 8s
    maxDelay: 300000,     // cap at 5 minutes
  },
};
```

**Exponential Backoff Example:**

```
Child fails (attempt 1)
  ↓ Wait 1s
Child retry 1 (attempt 2)
  ↓ Fails again
  ↓ Wait 2s
Child retry 2 (attempt 3)
  ↓ Fails again
  ↓ Wait 4s
Child retry 3 (attempt 4)
  ↓ Succeeds
  ↓ Parent resumes
```

Total wait time: 1s + 2s + 4s = 7 seconds of backoff

## Real-World Examples

### Example 1: Deployment Pipeline

```
kata deployment.production v1
  requires skill check.health
  
  initial deploy_staging
  
  phase deploy_staging
    spawn kata deployment.staging v1 -> staging_deploy
    next test_staging
  
  phase test_staging
    spawn kata testing.e2e v1 -> e2e_tests
    next deploy_production
  
  phase deploy_production
    spawn kata deployment.prod v1 -> prod_deploy
    next health_check
  
  phase health_check
    run skill check.health
    complete
```

**Flow:**
1. Deploy to staging (child kata runs to completion)
2. Run E2E tests (child kata)
3. Deploy to production (child kata)
4. Check health (skill)

Each step waits for previous to complete.

### Example 2: Data Processing with Checkpoints

```
kata data.pipeline.robust v1
  
  initial extract
  
  phase extract
    spawn kata data.extract v1 -> extracted_data
    next validate
  
  phase validate
    spawn kata data.validate v1 -> validation_report
    next transform
  
  phase transform
    spawn kata data.transform v1 -> transformed_data
    next load
  
  phase load
    spawn kata data.load v1 -> load_result
    complete
```

If validation fails (child fails), parent fails → pipeline stops. Retry from last checkpoint.

### Example 3: Parallel Subtasks (Future)

**Note:** Phase 7B supports sequential spawning. Phase 8+ will add parallel execution.

```
kata parallel.build v2
  
  initial compile
  
  phase compile
    spawn kata build.frontend v1 -> frontend
    next validate_frontend
  
  phase validate_frontend
    spawn kata test.frontend v1 -> frontend_tests
    next compile_backend
  
  phase compile_backend
    spawn kata build.backend v1 -> backend
    next validate_backend
  
  phase validate_backend
    spawn kata test.backend v1 -> backend_tests
    next deploy
  
  phase deploy
    run skill deploy.all
    complete
```

Current behavior: sequential (frontend → tests, then backend → tests).
Future: could spawn both in parallel with join logic.

## API Usage

### Manual Child Spawning

```typescript
import { ChildTaskCoordinator } from "../src/task/index.js";

const coordinator = new ChildTaskCoordinator(api);

// Parent task running, wants to spawn child
const child = await coordinator.spawnChild(
  parentTaskId,
  "project.init",
  "v1"
);

// Parent is now waiting
// Child task created in pending state
// KataRunner will poll and execute it
```

### Listening to Events

```typescript
api.events?.on("task.child_spawned", (payload) => {
  console.log(`Child spawned: ${payload.childTaskId} for parent ${payload.parentTaskId}`);
});

api.events?.on("task.child_completed", (payload) => {
  console.log(`Child completed: ${payload.childTaskId}`);
});

api.events?.on("task.child_failed", (payload) => {
  console.log(`Child failed: ${payload.error}`);
});
```

## Database Schema

### tasks table (updated)

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  kata_name TEXT NOT NULL,
  kata_version TEXT NOT NULL,
  state TEXT NOT NULL,  -- now includes "waiting"
  current_phase TEXT NOT NULL,
  variables TEXT,
  parent_task_id TEXT,  -- FK for child tasks
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  
  FOREIGN KEY (parent_task_id) REFERENCES tasks(id),
  INDEX idx_state_created (state, created_at),
  INDEX idx_parent_id (parent_task_id)
);
```

**Query examples:**

```sql
-- Get all child tasks for a parent
SELECT * FROM tasks WHERE parent_task_id = ?;

-- Get all waiting tasks (parents with children)
SELECT * FROM tasks WHERE state = 'waiting';

-- Get a task hierarchy
SELECT t.*, parent.id as parent_task_id
FROM tasks t
LEFT JOIN tasks parent ON t.parent_task_id = parent.id
WHERE t.id = ?;
```

## Monitoring

### Task Hierarchy Visualization

```
Task#parent (project.setup v1)
├─ state: completed
├─ createdAt: T+0s
├─ completedAt: T+180s
└─ phases: initialize → configure → generate
   │
   ├─ Child#1 (project.init v1)
   │  ├─ state: completed
   │  ├─ createdAt: T+0s
   │  └─ completedAt: T+90s
   │
   └─ Child#2 (project.config v1)
      ├─ state: completed
      ├─ createdAt: T+90s
      └─ completedAt: T+150s
```

### Depth Limits

Currently supports:
- ✅ Parent → Child (1 level of nesting)
- ✅ Sequential children (one after another)

Phase 7D+:
- Parallel children (multiple at once)
- Deeper nesting (grandchildren)

## Best Practices

### 1. Decompose Large Katas

❌ **Bad:** One 50-step kata
```
kata big.workflow v1
  initial step1
  phase step1 → step2 → ... → step50 → complete
```

✅ **Good:** Decomposed hierarchy
```
kata workflow.main v1
  initial setup
  phase setup: spawn kata workflow.init v1 → next execute
  phase execute: spawn kata workflow.run v1 → next finalize
  phase finalize: run skill notify → complete
```

Benefits:
- Reusable sub-katas
- Testable components
- Error isolation

### 2. Name Bindings Clearly

```
✅ GOOD: Descriptive binding names
  spawn kata data.extract v1 -> extracted_records
  spawn kata data.validate v1 -> validation_errors

❌ VAGUE: Generic names
  spawn kata data.extract v1 -> result1
  spawn kata data.validate v1 -> result2
```

### 3. Document Child Dependencies

```
# Parent kata that orchestrates complex workflow
kata workflow.complex v1
  # Requires sub-katas
  requires skill final.notification

  initial phase1
  
  # Child 1: Must complete before validation
  phase phase1
    spawn kata data.fetch v1 -> raw_data
    next phase2
  
  # Child 2: Depends on Child 1 output
  phase phase2
    spawn kata data.validate v1 -> validation_result
    next phase3
  
  # Final skill uses both outputs
  phase phase3
    run skill final.notification
    complete
```

### 4. Monitor Child Failures

```typescript
// Listen for all child failures
api.events?.on("task.child_failed", (payload) => {
  logger.error(`Child failed: ${payload.childTaskId}`);
  logger.error(`Parent affected: ${payload.parentTaskId}`);
  logger.error(`Error: ${payload.error}`);
  
  // Alert ops team
  alertOps(`Task failed: ${payload.parentTaskId}`);
});
```

## Troubleshooting

### "Parent task not found"

**Error:** `Parent task 'task-123' not found`

**Cause:** Child tries to resume non-existent parent

**Fix:**
1. Verify parent task ID in database
2. Check if parent was accidentally deleted
3. Review logs for parent creation

### "Parent in wrong state"

**Error:** `Parent task 'task-123' must be running to spawn child`

**Cause:** Parent not in running state when child spawned

**Fix:**
1. Ensure parent is actually executing (state = running)
2. Check if parent already failed
3. Verify phase has spawn action (not skipped)

### "Child never resumes parent"

**Error:** Parent stuck in waiting state forever

**Cause:** Child never completes or fails

**Fix:**
1. Check if child is executing (check task table)
2. Verify child has valid kata
3. Check if child failed (child in state = failed)
4. Look for skill timeouts (30s default)

## Next Steps

- **Phase 7B+:** Retry policies (configurable backoff)
- **Phase 7D:** Realms integration (distribute katas)
- **Phase 8:** Parallel spawning (multiple children at once)
- **Phase 8+:** Deeper nesting (grandchildren)

---

## Summary

Child task coordination enables:

✅ **Nested workflows** — Decompose complex processes  
✅ **Reusable sub-tasks** — Define once, use many times  
✅ **Error isolation** — Children fail independently  
✅ **Automatic coordination** — Parent/child sync via events  
✅ **Observable** — Events trace entire hierarchy  
✅ **Deterministic** — Sequential execution, no concurrency surprises  

With child spawning, you can build enterprise-grade workflows from composable, testable pieces.
