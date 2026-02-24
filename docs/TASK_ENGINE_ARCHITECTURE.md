# Task Engine Architecture

Deep technical documentation of Ronin's Task Engine runtime. This document covers:
- State machine design
- Event flow
- Delegation to SAR Chain
- Database schema
- Integration patterns

---

## Architecture Overview

```
Kata DSL (Human-Readable)
    ↓
KataRegistry (Parse & Compile)
    ↓
CompiledKata (Immutable Graph)
    ↓
TaskEngine (State Machine)
    ├─ Spawn → Task (pending)
    ├─ Start → Task (running)
    ├─ Execute → TaskExecutor
    │   ├─ SkillAdapter → SAR Chain
    │   └─ Phase Transition
    ├─ Complete → Task (completed)
    └─ Fail → Task (failed)
```

**Key Components:**

1. **TaskEngine** — State machine, task lifecycle
2. **TaskExecutor** — Orchestration loop, error handling
3. **SkillAdapter** — SAR Chain delegation, tool execution
4. **TaskStorage** — Database persistence
5. **Event Bus** — Task state change notifications

---

## Task State Machine

```
┌─────────┐
│ pending │ ← Task spawned, awaiting start
└────┬────┘
     │ engine.start()
     ↓
┌─────────┐
│ running │ ← Phase executing
└────┬────┘
     │ Phase completes
     ├─ If terminal=complete → completed
     ├─ If terminal=fail → failed
     └─ If next=X → running (next phase)
     
┌─────────┐ (Phase 3 feature)
│ waiting │ ← Child task spawned, awaiting completion
└────┬────┘
     │ Child completes
     └─ Resume parent as running
     
┌───────────┐
│ completed │ ← Final phase complete
└───────────┘

┌────────┐
│ failed │ ← Skill threw error or explicit fail
└────────┘

┌──────────┐ (Optional)
│ canceled │ ← User canceled task
└──────────┘
```

**State Transitions:**

```typescript
type TaskState = 
  | "pending"    // Initial state
  | "running"    // Phase executing
  | "waiting"    // Child task pending (Phase 3)
  | "completed"  // Successfully finished
  | "failed"     // Error occurred
  | "canceled";  // User canceled
```

---

## Task Lifecycle

### 1. Spawn

**Method:** `TaskEngine.spawn(kataName, kataVersion)`

```typescript
const task = await engine.spawn("finance.audit", "v1");
// → Task { id: "t1", state: "pending", currentPhase: "gather" }
```

**What happens:**
1. Verify kata exists (lookup from registry)
2. Create new task record
3. Set state to `pending`
4. Set current phase to kata's initial phase
5. Emit `task.created` event
6. Return task

**Database:**
```sql
INSERT INTO tasks (id, kata_name, kata_version, state, current_phase, created_at)
VALUES ('t1', 'finance.audit', 'v1', 'pending', 'gather', NOW());
```

### 2. Start

**Method:** `TaskEngine.start(taskId)`

```typescript
await engine.start("t1");
// Task transitions: pending → running
```

**What happens:**
1. Load task from database
2. Verify state is `pending`
3. Set started timestamp
4. Change state to `running`
5. Emit `task.state_changed` event
6. Save to database

**Validation:** Cannot start task that's not pending

### 3. Execute Phase

**Method:** `TaskExecutor.executePhase(taskId)`

```typescript
await executor.executePhase("t1");
// Executes current phase, advances to next or completes
```

**Execution Steps:**

```
1. Get task & current phase definition
2. If pending: call engine.start(taskId)
3. Execute phase action:
   ├─ If "run skill X":
   │  ├─ Validate skill exists
   │  └─ Call SkillAdapter.executeSkill()
   │     ├─ Create ChainContext
   │     ├─ Run via SAR Chain
   │     └─ Store result in task.variables[skillName]
   │
   └─ If "spawn kata X":
      ├─ Create child task (Phase 3)
      ├─ Set parent to waiting
      └─ Resume parent on child completion
      
4. Handle phase terminal:
   ├─ If terminal="complete":
   │  └─ Call engine.complete(taskId)
   ├─ If terminal="fail":
   │  └─ Call engine.fail(taskId, error)
   └─ Else if next=X:
      └─ Call engine.nextPhase(taskId)

5. On error: Call engine.fail(taskId, error)
```

### 4. Phase Transition

**Method:** `TaskEngine.nextPhase(taskId)`

```typescript
// Current: phase "gather", next: "analyze"
await engine.nextPhase("t1");
// Task updates: currentPhase = "analyze", state = "running"
```

**What happens:**
1. Load task from database
2. Get current phase definition
3. Verify phase has `next` (not `complete` or `fail`)
4. Update task.currentPhase to next phase name
5. Keep state as `running`
6. Emit `task.phase_changed` event

### 5. Complete

**Method:** `TaskEngine.complete(taskId)`

```typescript
await engine.complete("t1");
// Task state: running → completed
```

**What happens:**
1. Load task
2. Set state to `completed`
3. Set completed timestamp
4. Emit `task.completed` event
5. Save to database

### 6. Fail

**Method:** `TaskEngine.fail(taskId, error)`

```typescript
await engine.fail("t1", "Skill threw: Database connection failed");
// Task state: * → failed (error recorded)
```

**What happens:**
1. Load task
2. Set state to `failed`
3. Store error message
4. Set completed timestamp
5. Emit `task.failed` event
6. Save to database

---

## Skill Adapter & SAR Chain Integration

### SkillAdapter Architecture

```
TaskExecutor
    ↓
SkillAdapter.executeSkill(skillName, input, taskContext)
    ├─ Validate skill exists (api.tools.getSchemas())
    ├─ Create ChainContext from TaskContext
    ├─ Get SAR middleware stack (standardSAR)
    ├─ Run Chain.run()
    │   ├─ Handle tool calls
    │   ├─ Execute skill via api.tools.execute()
    │   └─ Capture result
    └─ Return skill output
        ↓
    TaskExecutor stores in task.variables[skillName]
```

### Converting Task → Chain Context

```typescript
// Input: TaskContext
{
  taskId: "t1",
  currentPhase: "gather",
  variables: { /* previous outputs */ }
}

// Output: ChainContext for SAR Chain
{
  conversationId: "t1",  // Use task ID as conversation ID
  messages: [{
    role: "user",
    content: "Execute skill 'mail.search' with input: {...}"
  }],
  metadata: {
    taskId: "t1",
    phase: "gather",
    variables: { /* task variables */ }
  }
}
```

### Skill Execution via SAR

```typescript
// SAR Chain processes:
1. Use standardSAR middleware template
2. Run executor with tool calling enabled
3. Execute skill if needed (tool call)
4. Return result or error
```

**Error Handling:**
```typescript
try {
  const result = await adapter.executeSkillWithTimeout(
    skillName,
    input,
    taskContext,
    30000  // 30 second timeout
  );
} catch (error) {
  // Skill threw or timed out
  await engine.fail(taskId, error.message);
}
```

---

## Event Emissions

All task state changes emit events via `api.events`:

### task.created

```typescript
{
  type: "task.created",
  taskId: "t1",
  kataName: "finance.audit",
  kataVersion: "v1",
  state: "pending",
  timestamp: 1708742400000
}
```

### task.state_changed

```typescript
{
  type: "task.state_changed",
  taskId: "t1",
  kataName: "finance.audit",
  kataVersion: "v1",
  state: "running",
  previousState: "pending",
  timestamp: 1708742410000
}
```

### task.phase_changed

```typescript
{
  type: "task.phase_changed",
  taskId: "t1",
  kataName: "finance.audit",
  kataVersion: "v1",
  state: "running",
  timestamp: 1708742420000
}
```

### task.completed

```typescript
{
  type: "task.completed",
  taskId: "t1",
  kataName: "finance.audit",
  kataVersion: "v1",
  state: "completed",
  previousState: "running",
  timestamp: 1708742500000
}
```

### task.failed

```typescript
{
  type: "task.failed",
  taskId: "t1",
  kataName: "finance.audit",
  kataVersion: "v1",
  state: "failed",
  previousState: "running",
  error: "Skill 'mail.search' threw: Connection timeout",
  timestamp: 1708742505000
}
```

---

## Database Schema

### tasks Table

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  kata_name TEXT NOT NULL,
  kata_version TEXT NOT NULL,
  state TEXT NOT NULL,
  current_phase TEXT NOT NULL,
  variables TEXT,  -- JSON
  parent_task_id TEXT,
  error TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  
  FOREIGN KEY (parent_task_id) REFERENCES tasks(id),
  INDEX idx_state_created (state, created_at),
  INDEX idx_kata_version (kata_name, kata_version),
  INDEX idx_parent_id (parent_task_id)
);
```

### Queries

**Get pending tasks:**
```sql
SELECT * FROM tasks
WHERE state = 'pending'
ORDER BY created_at ASC;
```

**Get task by ID:**
```sql
SELECT * FROM tasks WHERE id = ?;
```

**Get all tasks for a kata:**
```sql
SELECT * FROM tasks
WHERE kata_name = ? AND kata_version = ?
ORDER BY created_at DESC;
```

**Get completed tasks (last 24 hours):**
```sql
SELECT * FROM tasks
WHERE state = 'completed'
AND completed_at > datetime('now', '-1 day')
ORDER BY completed_at DESC;
```

---

## Integration Agents

### kata-runner

```typescript
// Scheduled: every 30 seconds
static schedule = "*/30 * * * * *";

// Poll all pending tasks and execute
await executor.pollAndExecute();
```

**Behavior:**
1. Find all tasks with state='pending'
2. For each task:
   - Call `executePhase(taskId)`
   - Handle errors (don't crash on one failure)
3. Loop end, wait 30 seconds

### kata-executor

```typescript
// Listen for event requests
this.api.events.on("task.spawn_requested", handle)
this.api.events.on("kata.execute", handle)
```

**Behavior:**
- **spawn_requested:** Create task in pending state
- **execute:** Create task and immediately execute first phase

---

## Example: Full Workflow

### 1. Spawn Task

```typescript
const engine = new TaskEngine(api);
const task = await engine.spawn("finance.audit", "v1");
// → { id: "t1", state: "pending", currentPhase: "gather" }
// Emit: task.created
```

### 2. Runner Polls (30s later)

```typescript
const executor = new TaskExecutor(api);
const pending = await engine.getPending();
// → [{ id: "t1", ... }]

for (const task of pending) {
  await executor.executePhase(task.id);
}
```

### 3. First Phase Execution

```typescript
// executePhase("t1")
// 1. Get phase: gather { run skill mail.search, next analyze }
// 2. Call engine.start("t1") → state: running
//    Emit: task.state_changed
// 3. Call SkillAdapter.executeSkill("mail.search", {...})
// 4. SAR Chain executes → result: {...}
// 5. Store in variables["mail.search"]: result
// 6. Phase has next="analyze"
// 7. Call engine.nextPhase("t1") → currentPhase: "analyze"
//    Emit: task.phase_changed
```

### 4. Second Phase Execution (30s later)

```typescript
// executePhase("t1")
// 1. Get phase: analyze { run skill finance.extract, next alert }
// 2. Already running, skip start
// 3. Call SkillAdapter.executeSkill("finance.extract", variables)
// 4. SAR executes → result: {...}
// 5. Store in variables["finance.extract"]: result
// 6. Phase has next="alert"
// 7. Call engine.nextPhase("t1") → currentPhase: "alert"
```

### 5. Final Phase Execution (30s later)

```typescript
// executePhase("t1")
// 1. Get phase: alert { run skill notify.user, complete }
// 2. Already running, skip start
// 3. Call SkillAdapter.executeSkill("notify.user", variables)
// 4. SAR executes → result: "Notified user"
// 5. Store in variables["notify.user"]: result
// 6. Phase has terminal="complete"
// 7. Call engine.complete("t1") → state: completed
//    Emit: task.completed
```

---

## Error Handling

### Skill Execution Errors

```
If SkillAdapter.executeSkill() throws:
  → TaskExecutor catches error
  → Calls engine.fail(taskId, error.message)
  → Task state: * → failed
  → Emit: task.failed
  → Phase does NOT advance
  → Next poll: task ignored (state != pending)
```

### Timeout Errors

```
Skill takes >30 seconds:
  → SkillAdapter.executeSkillWithTimeout() cancels
  → Throws "Skill '...' timed out after 30000ms"
  → TaskExecutor catches
  → Task marked failed
  → No retry (Phase 3 feature)
```

### Missing Skill

```
Phase tries to run undefined skill:
  → SkillAdapter.validateSkillExists() returns false
  → TaskExecutor throws "Skill '...' not registered"
  → TaskExecutor catches
  → Task marked failed
```

### Phase Graph Errors (Caught at Registration)

```
Invalid phase reference in next/spawn:
  → KataCompiler validation fails
  → Kata is NOT registered
  → Error surfaced to author
  → User cannot spawn tasks for invalid kata
```

---

## Performance Characteristics

### Task Creation

- **Spawn**: O(1) — Single INSERT
- **Start**: O(1) — Single UPDATE
- **Complete**: O(1) — Single UPDATE

### Queries

- **Get task by ID**: O(1) — Primary key lookup
- **Get pending**: O(n) where n = pending tasks (usually <1000)
- **Phase execution**: O(1) — Direct phase lookup in compiled graph

### Timeouts

- **Skill execution**: 30 seconds (configurable)
- **Task poll cycle**: Every 30 seconds
- **Phase transition**: Immediate

---

## Next Steps

- **Phase 3:** Child task coordination, retry policies
- **Phase 4:** Realms integration, kata discovery
- **Phase 5:** Dojo agent, user-gated capability extension
- **Documentation:** User guides, examples, troubleshooting
