# Phase 8: Parallel Execution Guide

Parallel child spawning enables multiple workflows to execute concurrently, with flexible join semantics. This guide covers the architecture, DSL syntax, execution model, and real-world patterns.

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Kata DSL for Parallel Execution](#kata-dsl-for-parallel-execution)
4. [Join Semantics](#join-semantics)
5. [Failure Handling](#failure-handling)
6. [Architecture](#architecture)
7. [API Reference](#api-reference)
8. [Real-World Examples](#real-world-examples)
9. [Best Practices](#best-practices)

---

## Overview

**Problem:** Phase 7B only supports sequential spawning (one child at a time). What if you need to process multiple items in parallel?

**Solution:** Phase 8 adds parallel spawning with configurable join semantics:

```
phase batch_processing
spawn parallel
  spawn kata process.chunk1 v1 -> chunk1_result
  spawn kata process.chunk2 v1 -> chunk2_result
  spawn kata process.chunk3 v1 -> chunk3_result
join all_completed
next aggregate
```

All three children execute concurrently. Parent waits for all to complete, then aggregates results.

### Key Capabilities

✅ **Concurrent Execution** - Multiple children run in parallel
✅ **Flexible Join** - Wait for all, any, or first to complete
✅ **Error Handling** - Configurable failure modes
✅ **Result Aggregation** - Automatic result collection
✅ **Timeout Protection** - Optional max wait time

---

## Core Concepts

### Parallel Spawn

A parallel spawn block executes multiple children concurrently:

```
spawn parallel
  spawn kata ... -> binding1
  spawn kata ... -> binding2
  spawn kata ... -> binding3
```

**Key Differences from Sequential:**

| Feature | Sequential (7B) | Parallel (8) |
|---------|-----------------|-------------|
| Timing | 1 child at a time | All children start together |
| Parent State | Waiting (1 child) | Waiting (N children) |
| Result Binding | Single result | Results object with keys |
| Join | Automatic (child done) | Configurable (all/any/first) |
| Error Handling | Simple (fail parent) | Configurable (continue/fail-all/fail-first) |

### Join Semantics

How the parent decides when to resume:

1. **JOIN ALL** (default)
   - Parent resumes when ALL children complete
   - Useful for: batch processing, map-reduce, parallel validation

2. **JOIN ANY**
   - Parent resumes when ANY child completes
   - Useful for: fan-out/fan-in, first-to-finish, competitive execution

3. **JOIN FIRST**
   - Parent resumes when FIRST child completes
   - Useful for: racing multiple solutions, fallback patterns

### Result Aggregation

Results are automatically collected:

```typescript
parentTask.variables.parallel_results = {
  chunk1_result: {...},
  chunk2_result: {...},
  chunk3_result: {...}
};
```

Errors (if any) collected separately:

```typescript
parentTask.variables.parallel_errors = {
  chunk1_result: "Error: ...",
  chunk2_result: "Error: ..."
};
```

### Failure Modes

Options for handling child failures:

1. **FAIL_ALL** (default)
   - Any child fails → parent fails immediately
   - Most conservative

2. **FAIL_FIRST**
   - First child failure → parent fails
   - Middle ground

3. **CONTINUE**
   - Parent continues regardless of failures
   - Results include errors alongside successes

---

## Kata DSL for Parallel Execution

### Basic Syntax

```
phase process_batch
spawn parallel
  spawn kata worker.processor v1 -> result1
  spawn kata worker.processor v1 -> result2
  spawn kata worker.processor v1 -> result3
join all_completed
next aggregate
```

### With Join Strategy

```
phase competitive_solve
spawn parallel
  spawn kata solver.algorithm1 v1 -> solution1
  spawn kata solver.algorithm2 v1 -> solution2
  spawn kata solver.algorithm3 v1 -> solution3
join first_completed
next validate
```

### With Failure Mode

```
phase resilient_batch
spawn parallel fail_on_first
  spawn kata process.item v1 -> item1
  spawn kata process.item v1 -> item2
  spawn kata process.item v1 -> item3
join all_completed
next finalize
```

### Complete Example

```
kata batch.processing v2
requires skill data.partition
requires skill worker.processor
requires skill result.aggregate

initial partition

phase partition
run skill data.partition
next process_batch

phase process_batch
spawn parallel fail_continue
  spawn kata worker.process v1 -> chunk1_result
  spawn kata worker.process v1 -> chunk2_result
  spawn kata worker.process v1 -> chunk3_result
join all_completed
next aggregate

phase aggregate
run skill result.aggregate
complete
```

### DSL Keywords

**Parallel Join:**
- `spawn parallel` - Begin parallel spawning block
- `join all_completed` - Wait for all children (default)
- `join any_completed` - Wait for any child
- `join first_completed` - Wait for first child

**Failure Modes:**
- `fail_on_any` - Stop if any child fails (default)
- `fail_on_first` - Stop on first failure
- `fail_continue` - Continue despite failures

---

## Join Semantics

### JOIN ALL (Wait for All)

```
spawn parallel
  spawn kata task1 v1 -> res1
  spawn kata task2 v1 -> res2
  spawn kata task3 v1 -> res3
join all_completed
```

**Timeline:**

```
T0: task1, task2, task3 all start
T1: task2 completes (result stored, parent still waiting)
T2: task1 completes (result stored, parent still waiting)
T3: task3 completes (result stored, parent resumes)
T4: Parent runs next phase
```

**Use Cases:**
- Batch processing (process all items)
- Map-reduce (aggregate all results)
- Validation (check all conditions)

### JOIN ANY (Wait for Any)

```
spawn parallel
  spawn kata attempt1 v1 -> res1
  spawn kata attempt2 v1 -> res2
  spawn kata attempt3 v1 -> res3
join any_completed
```

**Timeline:**

```
T0: attempt1, attempt2, attempt3 all start
T1: attempt2 completes (first to finish)
T2: Parent resumes with attempt2's result
    (attempt1, attempt3 continue running in background)
```

**Use Cases:**
- Racing multiple strategies
- Fan-out/fan-in with early exit
- Redundant requests (use first response)

### JOIN FIRST (Same as ANY, Emphasized)

```
spawn parallel
  spawn kata strategy1 v1 -> solution1
  spawn kata strategy2 v1 -> solution2
  spawn kata strategy3 v1 -> solution3
join first_completed
```

**Timeline:** (Same as ANY)

**Use Cases:**
- Parallel problem solvers (return first valid solution)
- Fallback chains (try multiple APIs, return first success)

---

## Failure Handling

### FAIL_ON_ANY (Default)

Any child failure immediately fails parent:

```
spawn parallel fail_on_any
  spawn kata process v1 -> res1
  spawn kata process v1 -> res2
  spawn kata process v1 -> res3
join all_completed
```

**Behavior:**
- If task1 fails → Parent fails (task2, task3 still running)
- If task2 fails → Parent fails immediately
- All-or-nothing semantics

### FAIL_ON_FIRST

First child failure fails parent (but other children continue):

```
spawn parallel fail_on_first
  spawn kata process v1 -> res1
  spawn kata process v1 -> res2
  spawn kata process v1 -> res3
join all_completed
```

**Behavior:**
- task1 fails → Parent marked failed, but waiting for others
- task2 completes → Result stored
- task3 fails → Already marked failed, continue
- Partial results available on failure

### FAIL_CONTINUE

Parent continues regardless of failures:

```
spawn parallel fail_continue
  spawn kata process v1 -> res1
  spawn kata process v1 -> res2
  spawn kata process v1 -> res3
join all_completed
```

**Behavior:**
- task1 fails → Error stored in parallel_errors
- task2 completes → Result stored
- task3 fails → Error stored
- Parent continues with mixed results/errors

---

## Architecture

### ParallelCoordinator

Core component managing parallel execution:

```typescript
interface ParallelSpawn {
  childName: string; // "chunk1", "chunk2"
  kataName: string;
  kataVersion: string;
  outputBinding?: string; // Where result is stored
}

interface ParallelPhaseConfig {
  spawns: ParallelSpawn[];
  joinStrategy: "all" | "any" | "first";
  timeout?: number;
  failureMode: "fail_all" | "fail_first" | "continue";
}
```

### Execution Flow

```
Task.spawn(parallel_config)
  ↓
ParallelCoordinator.spawnParallel()
  ├─ Create child tasks for each spawn
  ├─ Store parallel state
  └─ Return childTaskIds
  ↓
TaskExecutor
  ├─ Start all children (concurrently)
  └─ Parent enters "waiting" state
  ↓
Child Tasks (run independently)
  ↓
Each child completes/fails
  ├─ Emit task.child_completed / task.child_failed
  └─ ParallelCoordinator updates state
  ↓
Check join condition
  ├─ all_completed? All children done?
  ├─ any_completed? At least one done?
  └─ first_completed? At least one done?
  ↓
If join met:
  ├─ Aggregate results
  ├─ Parent resumes
  └─ Next phase runs
```

### Result Storage

Results are collected in parent task variables:

```typescript
parentTask.variables.parallel_results = {
  chunk1_result: {...}, // Child task output
  chunk2_result: {...},
  chunk3_result: {...}
};

// Errors (if any):
parentTask.variables.parallel_errors = {
  chunk1_result: "Error message"
};

// Aggregated metadata:
parentTask.variables.parallel_aggregated = {
  results: {...},
  errors: {...},
  totalChildren: 3,
  successCount: 2,
  failureCount: 1,
  timestamp: 1708800000
};
```

### Timeout Protection

Optional timeout prevents parent from waiting forever:

```
spawn parallel timeout 300000 fail_continue
  spawn kata slow_task v1 -> res1
  spawn kata slow_task v1 -> res2
  spawn kata slow_task v1 -> res3
join all_completed
```

- `timeout 300000` = 5 minutes
- If not met by timeout: Parent fails (or continues if fail_continue)

---

## API Reference

### ParallelCoordinator

#### spawnParallel()

```typescript
const { childTaskIds, state } = coordinator.spawnParallel(
  parentTask,
  [
    { childName: "chunk1", kataName: "process.chunk", kataVersion: "v1", outputBinding: "result1" },
    { childName: "chunk2", kataName: "process.chunk", kataVersion: "v1", outputBinding: "result2" }
  ],
  "all" // join strategy: "all" | "any" | "first"
);
```

#### handleParallelChildCompletion()

```typescript
const { allDone, readyToJoin, joinedResult } = coordinator.handleParallelChildCompletion(
  parentTask,
  "chunk1", // childName
  result // child result object
);

if (readyToJoin) {
  // Aggregated result ready
  console.log(joinedResult); // { results, errors, stats }
}
```

#### handleParallelChildFailure()

```typescript
const { shouldFailParent, shouldContinue } = coordinator.handleParallelChildFailure(
  parentTask,
  "chunk1",
  "Error: Task failed",
  "fail_all" // failureMode
);

if (shouldFailParent) {
  task.fail("Child failed with fail_all mode");
}
```

#### getParallelState()

```typescript
const state = coordinator.getParallelState(parentTaskId);
console.log(state.completedChildren); // Set<string>
console.log(state.failedChildren); // Set<string>
```

---

## Real-World Examples

### Example 1: Batch Data Processing

```
kata batch.process v2
requires skill data.split
requires skill worker.processor
requires skill results.merge

initial split

phase split
run skill data.split
next process

phase process
spawn parallel fail_continue
  spawn kata worker.process v1 -> batch1_results
  spawn kata worker.process v1 -> batch2_results
  spawn kata worker.process v1 -> batch3_results
  spawn kata worker.process v1 -> batch4_results
join all_completed
next merge

phase merge
run skill results.merge
complete
```

**Timeline:**
```
Split: Input → 4 chunks
Process: All 4 chunks process concurrently (2-4x faster)
Merge: Combine all 4 results
```

### Example 2: Competitive Problem Solving

```
kata solve.optimization v1
requires skill solver.brute_force
requires skill solver.genetic
requires skill solver.simulated_annealing
requires skill solution.validate

initial solve

phase solve
spawn parallel fail_continue
  spawn kata solver.brute_force v1 -> bf_solution
  spawn kata solver.genetic v1 -> ga_solution
  spawn kata solver.simulated_annealing v1 -> sa_solution
join first_completed
next validate

phase validate
run skill solution.validate
complete
```

**Result:** First algorithm to find valid solution wins; others cancelled.

### Example 3: Resilient API Fallback

```
kata fetch.reliable v1
requires skill api.primary_fetch
requires skill api.secondary_fetch
requires skill api.cache_fetch

initial fetch

phase fetch
spawn parallel fail_continue
  spawn kata api.primary v1 -> primary_result
  spawn kata api.secondary v1 -> secondary_result
  spawn kata api.cache v1 -> cache_result
join any_completed
next validate

phase validate
run skill api.validate_response
complete
```

**Behavior:** Any API succeeds → use that result. Others continue in background.

### Example 4: Validation Pipeline

```
kata validate.comprehensive v2
requires skill security.check
requires skill performance.check
requires skill compliance.check
requires skill report.generate

initial validate

phase validate
spawn parallel fail_on_first
  spawn kata security.validate v1 -> security_report
  spawn kata performance.validate v1 -> perf_report
  spawn kata compliance.validate v1 -> compliance_report
join all_completed
next report

phase report
run skill report.generate
complete
```

**Behavior:** If first check fails → all stop and parent fails. If all pass → generate report.

---

## Best Practices

### 1. Use Meaningful Child Names

```
// Good
spawn parallel
  spawn kata process v1 -> user_records
  spawn kata process v1 -> transaction_records
  spawn kata process v1 -> audit_records

// Poor (unclear)
spawn parallel
  spawn kata process v1 -> res1
  spawn kata process v1 -> res2
  spawn kata process v1 -> res3
```

### 2. Choose Right Join Strategy

```
// All needed? Use JOIN ALL
phase batch_processing
spawn parallel
  spawn kata process v1 -> res1
  spawn kata process v1 -> res2
join all_completed

// Any works? Use JOIN ANY (faster)
phase competitive
spawn parallel
  spawn kata attempt v1 -> res1
  spawn kata attempt v1 -> res2
join any_completed
```

### 3. Handle Failure Explicitly

```
// Conservative: fail on any error
spawn parallel fail_on_any
  ...
join all_completed

// Resilient: continue despite errors
spawn parallel fail_continue
  ...
join all_completed
next error_recovery
```

### 4. Set Timeouts for Unbounded Tasks

```
// Unbounded task might run forever
spawn parallel timeout 300000 fail_continue
  spawn kata might_hang v1 -> res1
  spawn kata might_hang v1 -> res2
join all_completed
```

### 5. Aggregate Results Properly

```
phase aggregate
run skill result.aggregate
# Next phase receives:
# - variables.parallel_results (all successes)
# - variables.parallel_errors (all failures)
# - variables.parallel_aggregated (metadata)
```

### 6. Monitor Parallel Performance

Log timing information:

```typescript
// In next phase, analyze aggregated stats
const aggregated = task.variables.parallel_aggregated;
console.log(`Processed ${aggregated.totalChildren} items`);
console.log(`${aggregated.successCount} succeeded, ${aggregated.failureCount} failed`);
```

---

## Limits & Guarantees

### Concurrent Children
- **Phase 8**: No enforced limit (all children execute)
- **Recommendation**: 2-32 children (practical sweet spot)
- **Caution**: 100+ children may exhaust system resources

### Execution Order
- **Guarantee**: All children start at approximately same time
- **No guarantee**: Order of completion (use join semantics)

### Result Timing
- **All joined**: All children complete before parent resumes
- **Any joined**: Parent resumes immediately on first completion
- **First joined**: Parent resumes on first completion

### Failure Semantics
- **fail_all**: Atomic (all-or-nothing)
- **fail_first**: Pragmatic (fail fast, keep results)
- **continue**: Resilient (gather all outcomes)

---

## Monitoring & Debugging

### View Parallel State

```typescript
const state = coordinator.getParallelState(taskId);
console.log(`Active: ${state.activeChildren.size}`);
console.log(`Completed: ${state.completedChildren.size}`);
console.log(`Failed: ${state.failedChildren.size}`);
```

### Trace Events

Parallel execution emits events at key points:

```typescript
api.events.emit("task.parallel_spawned", {
  parentTaskId,
  childCount,
  joinStrategy,
  failureMode
}, "parallel");

api.events.emit("task.parallel_child_completed", {
  parentTaskId,
  childName,
  result
}, "parallel");

api.events.emit("task.parallel_joined", {
  parentTaskId,
  joinStrategy,
  successCount,
  failureCount
}, "parallel");
```

### Logs

Check task.variables for debugging:

```json
{
  "parallel_results": {
    "chunk1": {...},
    "chunk2": {...}
  },
  "parallel_errors": {
    "chunk3": "Timeout"
  },
  "parallel_aggregated": {
    "totalChildren": 3,
    "successCount": 2,
    "failureCount": 1,
    "timestamp": 1708800000
  }
}
```

---

## Next Steps

**Phase 8 Complete:** Parallel execution with flexible join semantics is production-ready!

**Future Enhancements (Phase 9+):**
- Conditional branching (if/else in DSL)
- Dynamic child count (spawn based on input)
- Child cancellation (stop mid-execution)
- Weighted join (wait for 80% to complete)

---

*Phase 8: Parallel Execution complete. Ronin workflow orchestration now supports both sequential and parallel workflows with configurable join semantics.*
