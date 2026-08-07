# Tasking Duty — Coding Executor Integration

**Status:** Final Design → Implementation
**Target:** `duties/tasking.ts` (TodoAgent)
**Depends on:** ARCHITECTURE.md §1 (SAR), §2 (Tool/Skill/Duty), §5 (model router), §6 (safety boundary)
**Date:** 2026-08-07

---

## 0. Where this sits in SAR

`TodoAgent extends BaseDuty` — it is already a SAR loop instance per
ARCHITECTURE.md §1 ("Everything in Ronin is a Duty running the SAR loop").
`processCommandQueue()` runs as part of that loop's Respond action; this spec
changes what Respond does when a command needs code/file work. It does not
introduce a second envelope or orchestration system.

| Phase | Existing | Added by this spec |
|---|---|---|
| **Sense** | Queue poll; event handlers (`CommandReceived`, `PlanApproved`, …) | — |
| **Analyze** | Priority ordering | Executor resolution (§1); worktree readiness (§2); merge staleness check (§5.4) |
| **Respond** | `api.ai.callTools()` dispatch; card movement | Executor-routed dispatch (Tool or Skill); diff capture; Review routing; merge; conflict-task spawn |

---

## 1. Executor resolution

New column on `kanban_command_queue`:

```sql
ALTER TABLE kanban_command_queue ADD COLUMN executor TEXT DEFAULT 'ronin';
-- 'ronin' | 'claude-sdk' | 'opencode' | 'qwen'
```

The executor maps onto the Tool/Skill boundary from ARCHITECTURE.md §2 — this
is the existing capability taxonomy, not a new one:

| Executor | Registered as | Rationale | Invocation |
|---|---|---|---|
| `ronin` | existing router path | default; unchanged | `api.ai.callTools()` |
| `claude-sdk` | **Tool** — `codeexec.claude` | in-process TS, typed I/O | Claude Agent SDK, `cwd` = worktree |
| `opencode` | **Skill** — `codeexec/opencode.md` | shells out (§7.2: Skill = language-agnostic executable) | `opencode run --format json` |
| `qwen` | **Skill** — `codeexec/qwen.md` | shells out | `qwen -p --output-format json` |

All three coding executors emit a common event shape into the Duty's Respond
handling regardless of backend:

```ts
interface ExecutorEvent {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolName?: string;
  cost?: { inputTokens: number; outputTokens: number };
}

interface ExecutorResult {
  sessionId: string;          // for resume
  summary: string;            // agent's final message
  exitOk: boolean;
}
```

**Resolution order (Analyze):**
1. Explicit card tag (`#claude`, `#opencode`, `#qwen`) → that executor
2. No tag, Analyze detects file/repo implication → default coding executor
   (config: `tasking.defaultCodingExecutor`, e.g. `claude-sdk`)
3. Otherwise → `ronin` (current behavior, unchanged)

Non-coding work (Notion, Blender MCP, general tool calls, MNGR-relayed
assignments without file implications) stays on the `ronin` path with zero
added overhead. Coding is opt-in per command.

---

## 2. Worktree + branch lifecycle

Worktrees are provisioned **only** in coding-executor branches. `ronin`
commands never touch git.

```sql
ALTER TABLE kanban_command_queue ADD COLUMN worktree_path TEXT;
ALTER TABLE kanban_command_queue ADD COLUMN task_branch  TEXT;
ALTER TABLE kanban_command_queue ADD COLUMN base_branch  TEXT;
ALTER TABLE kanban_command_queue ADD COLUMN session_id   TEXT;
```

**Branch model:** each worktree checks out its own branch `task/{card_id}` cut
from `base_branch` — never `base_branch` directly. This is what makes parallel
worktrees safe: no two tasks ever share a writable ref.

**Provision (Analyze, coding executors only):**

```
1. if worktree_path set (resume/conflict case) → skip provisioning
2. acquire worktree mutex
3. git worktree add /worktrees/{card_id} -b task/{card_id} {base_branch}
4. release mutex; persist worktree_path + task_branch on the queue row
```

The mutex serializes only `git worktree add`/`remove` (they mutate shared
`.git/worktrees/` metadata). Execution is NOT serialized by this lock.

**Release (terminal states only):**

```
git worktree remove /worktrees/{card_id}    (mutex-wrapped)
git branch -d task/{card_id}                (after successful merge)
```

Release happens on **Done** or **Rejected** only — never on Review or
Merge Conflict, which need the worktree alive for resume.

---

## 3. Concurrency

Replace the single-running gate in `processCommandQueue()`:

```ts
// OLD: if any running row exists, return
// NEW:
const [{ n }] = await this.api.db.query(
  `SELECT COUNT(*) as n FROM kanban_command_queue WHERE status = 'running'`
);
if (n >= this.maxConcurrent) return;
```

- `maxConcurrent` — config (`tasking.maxConcurrent`), default 3, tunable per
  the two-machine Swarm split.
- `ronin` and coding executors share one pool and counter.
- Selection logic (priority + FIFO) unchanged.
- The worktree mutex (§2) is the only extra serialization point and is
  independent of this counter.

---

## 4. Review stage + diff sub-view

New column state **Review** between Doing and Done. Only commands that
produced a diff enter it; everything else keeps today's Doing → Done path.

```sql
CREATE TABLE IF NOT EXISTS kanban_card_diffs (
  id            TEXT PRIMARY KEY,
  card_id       TEXT NOT NULL,
  command_id    TEXT NOT NULL,
  session_id    TEXT,
  patch         TEXT NOT NULL,       -- git diff output
  files_changed TEXT,                -- JSON array of paths
  created_at    INTEGER NOT NULL,
  FOREIGN KEY(card_id) REFERENCES kanban_cards(id)
);
```

**Completion branch (coding executor):**

```
diff = git diff {base_branch}...task/{card_id}   (in worktree)
if (diff nonempty):
    insert kanban_card_diffs; move card → Review
else:
    move card → Done   (agent made no file changes; treat as ronin-style result)
```

**Diff rendering:** a sub-view on the card detail page (`/todo` card modal),
rendered from `kanban_card_diffs.patch` — not a board-level surface. Visible
for cards in Review, Merge Conflict, and Done (historical).

**Review resolution:**

- **Approve** → merge flow (§5)
- **Comment / request changes** → append comment to card description
  (existing `TaskAppendDescription` handler), re-enqueue with the SAME
  `worktree_path` + `session_id` (executor resumes warm: Claude SDK session
  resume / `opencode run -s` / `qwen --resume`), card back to Doing

---

## 5. Merge + conflict resolution

Merging happens at **Approve**, never automatically on completion. A diff
being clean when the agent finished does not mean it is still clean to merge —
other cards may have merged into `base_branch` while this one sat in Review.

### 5.1 Approve flow

```
1. fetch/refresh base_branch
2. dry-run in worktree:
     git merge --no-commit --no-ff {base_branch}
3a. clean:
     commit the merge on task/{card_id}
     fast-forward base_branch to task/{card_id}
     release worktree + delete task branch (§2)
     card → Done
3b. conflict:
     git merge --abort
     card → "Merge Conflict" column, label #conflict
     spawn conflict-resolution task (§5.2)
```

### 5.2 Conflict-resolution task — spun automatically

A conflict is just another command. It reuses every mechanism in this spec —
no new machinery:

```
new kanban_command_queue row:
  executor:      same executor as the original command
  worktree_path: SAME worktree (run `git merge {base_branch}` first and leave
                 it in conflicted state so markers are on disk)
  session_id:    null (fresh session — conflict context is in the files)
  instruction:   "Resolve merge conflicts between task/{card_id} and
                  {base_branch}. Conflicted files: {list}. Preserve the
                  intent of both changes; original task: {card title}."

new kanban_dependencies row:
  card_id:       conflict card
  depends_on_id: original card
```

On completion the conflict task's diff enters Review like any other, and its
Approve retries §5.1 from step 1. If it conflicts again (base moved again),
the same loop spins another task. Bounded in practice by `max_attempts`.

### 5.3 Merge serialization

Merges into a given `base_branch` are serialized with a per-branch mutex
(same pattern as the worktree mutex). Two Approves clicked simultaneously
must not race the fast-forward.

### 5.4 Staleness detection (proactive, not just at Approve)

While a card sits in Review, a periodic Sense check (per SAR tick or a slow
timer, e.g. 5 min) re-runs the dry-run merge:

```
still clean   → no action
now conflicts → add `stale` label to card; optionally auto-spawn the
                conflict task (config: tasking.autoResolveStale, default off)
```

This means a reviewer opening a Review card sees its true mergeability, and
conflict resolution can begin before a human ever clicks Approve.

---

## 6. Safety boundary (ARCHITECTURE.md §6) — gates production use

1. **Trust tier:** `codeexec.claude`, `codeexec/opencode`, `codeexec/qwen`
   are all tagged `dangerous` (shell execution + file writes).
2. **Provenance:** `dangerous` executors refuse commands whose originating
   event provenance is an untrusted channel (Discord, external MNGR relay)
   unless an approval event with trusted provenance exists.
3. **Approval mechanism:** reuse `PendingResponse`/`UserResponse` — a
   channel-sourced command resolving to a coding executor emits
   `PendingResponse` instead of dispatching; a trusted-origin `UserResponse`
   is the approval. Already implemented in tasking.ts; no new plumbing.
4. **Per-run budget:** hard step/token cap per coding-executor invocation
   (config: `tasking.codingBudget`), aborting the session on breach.
   Loop-guard against a runaway agent burning inside a worktree.
5. **Merge is human-gated by default.** Auto-approve policies (e.g. "tests
   pass → merge") are a config opt-in per board, never the default.

---

## 7. Config surface

```jsonc
{
  "tasking": {
    "maxConcurrent": 3,
    "defaultCodingExecutor": "claude-sdk",
    "worktreeRoot": "/worktrees",
    "codingBudget": { "maxSteps": 50, "maxTokens": 200000 },
    "autoResolveStale": false,
    "autoApprove": false
  }
}
```

---

## 8. Rollout order

1. **Schema migrations** (§1, §2, §4) — additive; existing rows default to
   `executor='ronin'` and behave identically.
2. **Concurrency pool** (§3) — standalone win; parallelizes existing
   `ronin`-executor throughput immediately.
3. **Worktree provisioner + mutexes** (§2, §5.3).
4. **Executor registration** — `codeexec.claude` Tool; `codeexec/opencode` and
   `codeexec/qwen` Skills; all `dangerous`-tagged (§6.1).
5. **Review column, diff capture, comment-resume** (§4).
6. **Merge flow + conflict-task spawn + staleness check** (§5).
7. **Provenance/approval gate** (§6.2–6.3) — REQUIRED before enabling
   channel-sourced dispatch to coding executors. Steps 1–6 can ship to
   local/trusted use first; step 7 gates anything reachable from Discord/MNGR.

---

## 9. Interactive layer + intelligence extensions

These five additions close the interactive-loop gap with Cline Kanban and add
routing intelligence no comparable tool has. §9.1–9.2 are polish on the
execution path; §9.3 is the highest-leverage feature; §9.5 is the moat.

### 9.1 Live execution feed per card

Executors already stream structured events (`ExecutorEvent`, §1). Pipe them to
the card detail view in real time instead of discarding everything before the
final result.

```sql
CREATE TABLE IF NOT EXISTS kanban_command_events (
  id          TEXT PRIMARY KEY,
  command_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,      -- monotonic per command
  type        TEXT NOT NULL,         -- text | tool_call | done | error
  payload     TEXT NOT NULL,         -- JSON ExecutorEvent
  created_at  INTEGER NOT NULL
);
```

- Respond phase writes each ExecutorEvent as it arrives (buffered, batched
  inserts — one write per event is fine at 3–10 concurrent commands, revisit
  if maxConcurrent grows).
- New route: `GET /api/todo/commands/:id/stream` — SSE. Card detail view
  subscribes while the command status is `running`; replays from
  `kanban_command_events` for reconnects (client sends last `seq`).
- Retention: prune events for commands completed > 7 days (config:
  `tasking.eventRetentionDays`).
- The `ronin` executor benefits too — `callTools` tool invocations stream
  the same way. Not coding-specific.

### 9.2 Message-range-scoped diffs

Cumulative diffs get unreadable after several comment-resume rounds. Snapshot
a git ref at each resume boundary so diffs can be scoped per round.

```sql
ALTER TABLE kanban_card_diffs ADD COLUMN from_ref TEXT;   -- git ref at round start
ALTER TABLE kanban_card_diffs ADD COLUMN to_ref   TEXT;   -- git ref at round end
ALTER TABLE kanban_card_diffs ADD COLUMN round    INTEGER DEFAULT 1;
```

Mechanics:
- On first dispatch: `from_ref = base_branch` merge-base.
- On each completion: commit working state to `task/{card_id}` (`wip: round N`
  if the agent didn't commit), record `to_ref`.
- On comment-resume (§4): the new round's `from_ref` = previous round's
  `to_ref`; increment `round`.
- Card diff sub-view gains a round selector: "Round 3 only" renders
  `git diff {from_ref}..{to_ref}`; "All" renders `base...task` as today.

No change to the merge flow (§5) — merging always operates on the full branch.

### 9.3 Decomposition intent — board-level Chatty

The single highest-leverage addition: one prompt in, N linked cards out.
Enables MNGR to hand tasking a goal instead of pre-chopped tasks.

**New event:**
```
DecomposeRequested {
  goal: string,
  boardId?: string,
  source, sourceChannel, sourceUser   // standard provenance
}
```

**Handling (this is an Analyze job in the tasking Duty):**
1. Build context: existing board state (cards + columns), the Duty/Skill/Tool
   catalog (so decomposition references existing capabilities instead of
   reinventing them), tasking-rules.md.
2. `api.ai.complete()` with a decomposition prompt returning strict JSON:
   ```jsonc
   { "cards": [ { "title", "description", "priority",
                  "executorHint": "ronin|claude-sdk|opencode|qwen|auto",
                  "dependsOn": [indices] } ] }
   ```
3. Create cards in To Do; write `kanban_dependencies` rows from `dependsOn`.
4. Emit `TaskCreated` per card (existing event) + `DecompositionCompleted`
   summary event.

**Surfaces:**
- Board chat panel on `/todo` (board-level Chatty) — routes free text to
  either DecomposeRequested (plan intent) or CommandReceived (do-it-now
  intent). Intent split decided in Analyze.
- MNGR: sends DecomposeRequested over the existing bus. No new plumbing.
- Two-surface rule stands: board chat = create/link/reorder cards;
  card-level comments = resume that card's session (§4). Never merged into
  one ambiguous input.

**Dependency auto-start (completes the Cline parity):** on `TaskMoved` to
Done, check `kanban_dependencies` for dependents whose prerequisites are now
all Done; auto-enqueue any that carry the `#auto` label (or board-level
config `tasking.autoStartDependents`, default off).

### 9.4 Per-card repo/branch targeting

The board serves the whole portfolio, not one repo.

```sql
ALTER TABLE kanban_boards ADD COLUMN default_repo   TEXT;
ALTER TABLE kanban_boards ADD COLUMN default_branch TEXT DEFAULT 'main';
ALTER TABLE kanban_command_queue ADD COLUMN repo_path TEXT;   -- overrides board default
```

- Resolution: card-level `repo_path`/`base_branch` if set, else board
  defaults, else error (a coding executor without a resolvable repo fails
  fast at Analyze, card → Failed with a clear message — never guesses).
- Worktree paths become `/worktrees/{repo_name}/{card_id}` to prevent
  cross-repo collisions.
- Worktree + merge mutexes (§2, §5.3) become **per-repo** mutexes — two
  repos never block each other.
- Decomposition (§9.3) may emit cards targeting different repos from one
  goal ("ship feature X" → ENVOY card + MASON card + docs card).

### 9.5 Executor scorecard → Kokoro routing

Learn which executor is best per task type from outcomes, replacing static
tags/config over time.

```sql
CREATE TABLE IF NOT EXISTS executor_outcomes (
  id            TEXT PRIMARY KEY,
  command_id    TEXT NOT NULL,
  executor      TEXT NOT NULL,
  task_features TEXT NOT NULL,   -- JSON: labels, repo, files_changed count,
                                 -- instruction embedding key, priority
  outcome       TEXT NOT NULL,   -- success | failed | conflict | rejected
  rounds        INTEGER,         -- comment-resume cycles before approval
  attempts      INTEGER,
  cost_tokens   INTEGER,
  wall_ms       INTEGER,
  created_at    INTEGER NOT NULL
);
```

- Written automatically at every terminal state (Done / Failed / Rejected).
  `rounds` comes from §9.2's round counter — low rounds = executor got it
  right the first time.
- Feeds Kokoro's existing contextual-bandit layer as a new decision domain:
  executor selection joins model-tier selection as a learned policy over the
  same SQLite replay buffer.
- Resolution order in §1 gains a step: explicit tag → **Kokoro policy (if
  confidence above threshold)** → config default → ronin.
- Cold start: policy defers to config default until N≥20 outcomes per
  executor; exploration rate config: `tasking.executorExploreRate`
  (default 0.1).
- This is additive — remove Kokoro and the system falls back to tags/config
  with zero breakage.

---

## 10. Updated config surface

```jsonc
{
  "tasking": {
    "maxConcurrent": 3,
    "defaultCodingExecutor": "claude-sdk",
    "worktreeRoot": "/worktrees",
    "codingBudget": { "maxSteps": 50, "maxTokens": 200000 },
    "autoResolveStale": false,
    "autoApprove": false,
    "eventRetentionDays": 7,
    "autoStartDependents": false,
    "executorExploreRate": 0.1
  }
}
```

---

## 11. Updated rollout order

Phase A — execution core (unchanged from §8):
1. Schema migrations (§1, §2, §4)
2. Concurrency pool (§3)
3. Worktree provisioner + mutexes (§2, §5.3)
4. Executor registration — Tool + Skills, dangerous-tagged (§6.1)
5. Review column, diff capture, comment-resume (§4)
6. Merge flow + conflict-task spawn + staleness (§5)
7. Provenance/approval gate (§6.2–6.3) — gates channel-sourced dispatch

Phase B — interactive layer:
8. Live event feed + SSE route (§9.1) — do alongside Phase A step 4; the
   executor adapters should write events from day one
9. Round-scoped diffs (§9.2) — extends step 5
10. Per-card repo targeting (§9.4) — before §9.3, so decomposition can
    target repos from the start

Phase C — intelligence:
11. Decomposition intent + board Chatty + dependency auto-start (§9.3)
12. Executor scorecard schema (§9.5) — ship the outcome-writing early (it's
    just inserts at terminal states) even though the Kokoro policy comes last;
    data accumulates while the policy is built
