import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { Database } from "bun:sqlite";
import type { DutyAPI } from "@ronin/types/index.js";
import {
  resolveExecutor,
  executorFromLabels,
  hasFileImplication,
  isCodingExecutor,
  CODING_EXECUTORS,
} from "../src/tasking/executors.js";
import { provisionWorktree, releaseWorktree, getWorktreePath } from "../src/tasking/worktree.js";
import { dryRunMerge, approveMerge, spawnConflictTask } from "../src/tasking/merge.js";
import { getBranchPointRef, getCurrentRef, commitIfDirty, diffBetweenRefs, filesChangedBetweenRefs } from "../src/tasking/diffs.js";
import { emitCommandEvent, getEventsSince, pruneOldCommandEvents } from "../src/tasking/events.js";
import { recordExecutorOutcome } from "../src/tasking/outcomes.js";

function createMockAPI(dataDir: string): DutyAPI {
  const db = new Database(":memory:");
  return {
    db: {
      query: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        return params && params.length > 0 ? stmt.all(...params) : stmt.all();
      },
      execute: async (sql: string, params?: any[]) => {
        const stmt = db.prepare(sql);
        params && params.length > 0 ? stmt.run(...params) : stmt.run();
      },
    },
    config: {
      getSystem: () => ({ dataDir }),
      getTasking: () => ({ worktreeRoot: undefined }),
    } as any,
  } as unknown as DutyAPI;
}

describe("tasking/executors", () => {
  describe("executorFromLabels", () => {
    it("finds a coding executor from a JSON label array", () => {
      expect(executorFromLabels(JSON.stringify(["#claude", "other"]))).toBe("claude");
    });

    it("finds a coding executor from a comma-separated string", () => {
      expect(executorFromLabels("#opencode, foo")).toBe("opencode");
    });

    it("returns null when no executor label is present", () => {
      expect(executorFromLabels(JSON.stringify(["#command", "high"]))).toBeNull();
    });

    it("returns null for empty/missing labels", () => {
      expect(executorFromLabels(null)).toBeNull();
      expect(executorFromLabels(undefined)).toBeNull();
      expect(executorFromLabels("")).toBeNull();
    });

    it("recognizes every declared coding executor", () => {
      for (const name of CODING_EXECUTORS) {
        expect(executorFromLabels([`#${name}`])).toBe(name);
      }
    });
  });

  describe("hasFileImplication", () => {
    it("detects file/repo-implying language", () => {
      expect(hasFileImplication("please refactor the auth module")).toBe(true);
      expect(hasFileImplication("fix the bug in payment.ts")).toBe(true);
    });

    it("does not flag plain conversational instructions", () => {
      expect(hasFileImplication("what's the weather like today?")).toBe(false);
    });
  });

  describe("resolveExecutor", () => {
    const config = { defaultCodingExecutor: "claude" as const };

    it("prefers an explicit label over everything else", () => {
      expect(resolveExecutor(["#qwen"], "what's 2+2?", config)).toBe("qwen");
    });

    it("falls back to config default when the instruction implies file work", () => {
      expect(resolveExecutor(null, "refactor the duty loader", config)).toBe("claude");
    });

    it("stays on ronin when there's no label and no file implication", () => {
      expect(resolveExecutor(null, "summarize today's news", config)).toBe("ronin");
    });
  });

  describe("isCodingExecutor", () => {
    it("is false only for ronin", () => {
      expect(isCodingExecutor("ronin")).toBe(false);
      expect(isCodingExecutor("claude")).toBe(true);
    });
  });
});

describe("tasking/worktree", () => {
  let repo: string;
  let dataDir: string;
  let api: DutyAPI;

  beforeEach(() => {
    const scratch = mkdtempSync(join(tmpdir(), "ronin-tasking-test-"));
    repo = join(scratch, "repo");
    dataDir = join(scratch, "data");
    execSync(`mkdir -p "${repo}"`);
    execSync(`git init -q -b main`, { cwd: repo });
    execSync(`git config user.email t@t.com && git config user.name t`, { cwd: repo });
    execSync(`echo line1 > file.txt && git add . && git commit -q -m init`, { cwd: repo });
    api = createMockAPI(dataDir);
  });

  afterEach(() => {
    rmSync(join(dataDir, ".."), { recursive: true, force: true });
  });

  it("provisions a worktree with a task/<cardId> branch", async () => {
    const { worktreePath, taskBranch } = await provisionWorktree(api, repo, "card-a", "main");
    expect(existsSync(worktreePath)).toBe(true);
    expect(taskBranch).toBe("task/card-a");
    expect(worktreePath).toBe(getWorktreePath(api, repo, "card-a"));
  });

  it("releases a worktree and deletes its branch", async () => {
    const { worktreePath, taskBranch } = await provisionWorktree(api, repo, "card-b", "main");
    await releaseWorktree(api, repo, worktreePath, taskBranch, true);
    expect(existsSync(worktreePath)).toBe(false);
    const branches = execSync(`git branch --list "${taskBranch}"`, { cwd: repo }).toString();
    expect(branches.trim()).toBe("");
  });

  it("serializes concurrent provisions for the same repo without corrupting worktree state", async () => {
    const [a, b, c] = await Promise.all([
      provisionWorktree(api, repo, "card-x", "main"),
      provisionWorktree(api, repo, "card-y", "main"),
      provisionWorktree(api, repo, "card-z", "main"),
    ]);
    for (const w of [a, b, c]) {
      expect(existsSync(w.worktreePath)).toBe(true);
    }
    const list = execSync(`git worktree list`, { cwd: repo }).toString();
    expect(list.split("\n").filter(Boolean).length).toBe(4); // main + 3 task worktrees
  });
});

describe("tasking/merge", () => {
  let repo: string;
  let dataDir: string;
  let api: DutyAPI;

  beforeEach(() => {
    const scratch = mkdtempSync(join(tmpdir(), "ronin-tasking-merge-test-"));
    repo = join(scratch, "repo");
    dataDir = join(scratch, "data");
    execSync(`mkdir -p "${repo}"`);
    execSync(`git init -q -b main`, { cwd: repo });
    execSync(`git config user.email t@t.com && git config user.name t`, { cwd: repo });
    execSync(`echo line1 > file.txt && git add . && git commit -q -m init`, { cwd: repo });
    api = createMockAPI(dataDir);
  });

  afterEach(() => {
    rmSync(join(dataDir, ".."), { recursive: true, force: true });
  });

  it("dry-runs a clean merge without leaving the worktree in a merging state", async () => {
    const { worktreePath } = await provisionWorktree(api, repo, "card-1", "main");
    execSync(`echo line2 >> file.txt && git add . && git commit -q -m "add line2"`, { cwd: worktreePath });

    const result = await dryRunMerge(worktreePath, "main");
    expect(result.clean).toBe(true);

    const status = execSync(`git status --porcelain`, { cwd: worktreePath }).toString();
    expect(status.trim()).toBe("");
  });

  it("approves a clean merge: fast-forwards base_branch and releases the worktree", async () => {
    const { worktreePath, taskBranch } = await provisionWorktree(api, repo, "card-2", "main");
    execSync(`echo line2 >> file.txt && git add . && git commit -q -m "add line2"`, { cwd: worktreePath });

    const result = await approveMerge(api, { repoPath: repo, worktreePath, taskBranch, baseBranch: "main" });
    expect(result.merged).toBe(true);
    expect(existsSync(worktreePath)).toBe(false);

    const log = execSync(`git log --oneline`, { cwd: repo }).toString();
    expect(log).toContain("add line2");
  });

  it("detects a real conflict and spawns a linked conflict-resolution command", async () => {
    const { worktreePath, taskBranch } = await provisionWorktree(api, repo, "card-3", "main");
    execSync(`printf 'CONFLICT-WORKTREE\\n' > file.txt && git add . && git commit -q -m "worktree change"`, {
      cwd: worktreePath,
    });
    execSync(`printf 'CONFLICT-MAIN\\n' > file.txt && git add . && git commit -q -m "main change"`, { cwd: repo });

    const dry = await dryRunMerge(worktreePath, "main");
    expect(dry.clean).toBe(false);
    expect(dry.conflictedFiles).toContain("file.txt");

    const db = api.db as unknown as { execute: (sql: string, params?: any[]) => Promise<void>; query: (sql: string, params?: any[]) => Promise<any[]> };
    await db.execute(
      `CREATE TABLE kanban_command_queue (id TEXT PRIMARY KEY, card_id TEXT, instruction TEXT, status TEXT, executor TEXT, worktree_path TEXT, task_branch TEXT, base_branch TEXT, repo_path TEXT, session_id TEXT, created_at INTEGER)`
    );

    const created: any[] = [];
    const cardCreator = {
      createCard: async (columnId: string, boardId: string, title: string) => {
        created.push({ columnId, boardId, title });
        return { id: "conflict-card" };
      },
      addDependency: async (cardId: string, dependsOnId: string) => {
        created.push({ dependency: { cardId, dependsOnId } });
      },
    };

    const spawned = await spawnConflictTask(api, cardCreator, {
      originalCardId: "card-3",
      originalCardTitle: "Original task",
      columnId: "col-1",
      boardId: "board-1",
      executor: "claude",
      worktreePath,
      taskBranch,
      baseBranch: "main",
      repoPath: repo,
      conflictedFiles: dry.conflictedFiles,
    });

    expect(spawned.conflictCardId).toBe("conflict-card");
    expect(created.some((c) => c.dependency?.dependsOnId === "card-3")).toBe(true);

    const rows = await db.query(`SELECT * FROM kanban_command_queue WHERE id = ?`, [spawned.commandId]);
    expect(rows[0].worktree_path).toBe(worktreePath);
    expect(rows[0].task_branch).toBe(taskBranch);
  });
});

describe("tasking/diffs (round-scoping)", () => {
  let repo: string;
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "ronin-tasking-diffs-test-"));
    repo = join(scratch, "repo");
    execSync(`mkdir -p "${repo}"`);
    execSync(`git init -q -b main`, { cwd: repo });
    execSync(`git config user.email t@t.com && git config user.name t`, { cwd: repo });
    execSync(`echo line1 > file.txt && git add . && git commit -q -m init`, { cwd: repo });
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("scopes a diff to only the second round's change, not the first's", async () => {
    const api = createMockAPI(join(scratch, "data"));
    const { worktreePath, taskBranch } = await provisionWorktree(api, repo, "card-diff", "main");
    const branchPoint = await getBranchPointRef(worktreePath, "main", taskBranch);

    execSync(`echo round1-change >> file.txt`, { cwd: worktreePath });
    expect(await commitIfDirty(worktreePath, 1)).toBe(true);
    const ref1 = await getCurrentRef(worktreePath);

    execSync(`echo round2-change >> file.txt`, { cwd: worktreePath });
    expect(await commitIfDirty(worktreePath, 2)).toBe(true);
    const ref2 = await getCurrentRef(worktreePath);

    const round2Diff = await diffBetweenRefs(worktreePath, ref1, ref2);
    const round2Files = await filesChangedBetweenRefs(worktreePath, ref1, ref2);
    expect(round2Diff).toContain("+round2-change");
    expect(round2Diff).not.toContain("+round1-change"); // not re-added — only context, if present at all
    expect(round2Files).toEqual(["file.txt"]);

    const cumulative = await diffBetweenRefs(worktreePath, branchPoint, ref2);
    expect(cumulative).toContain("+round1-change");
    expect(cumulative).toContain("+round2-change");
  });

  it("commitIfDirty is a no-op when nothing changed", async () => {
    const api = createMockAPI(join(scratch, "data"));
    const { worktreePath } = await provisionWorktree(api, repo, "card-clean", "main");
    expect(await commitIfDirty(worktreePath, 1)).toBe(false);
  });
});

describe("tasking/events", () => {
  let api: DutyAPI;
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "ronin-tasking-events-test-"));
    api = createMockAPI(join(scratch, "data"));
    (api.db as any).execute(
      `CREATE TABLE kanban_command_events (id TEXT PRIMARY KEY, command_id TEXT, seq INTEGER, type TEXT, payload TEXT, created_at INTEGER)`
    );
    (api.db as any).execute(
      `CREATE TABLE kanban_command_queue (id TEXT PRIMARY KEY, completed_at INTEGER)`
    );
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("assigns monotonically increasing sequence numbers per command", async () => {
    await emitCommandEvent(api, "cmd-1", { type: "text", content: "starting" });
    await emitCommandEvent(api, "cmd-1", { type: "tool_call", toolName: "local.shell.safe" });
    await emitCommandEvent(api, "cmd-1", { type: "done", content: "finished" });

    const events = await getEventsSince(api, "cmd-1", 0);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(events.map((e) => e.type)).toEqual(["text", "tool_call", "done"]);
  });

  it("keeps sequence numbers independent per command", async () => {
    await emitCommandEvent(api, "cmd-a", { type: "text" });
    await emitCommandEvent(api, "cmd-b", { type: "text" });
    await emitCommandEvent(api, "cmd-a", { type: "done" });

    const eventsA = await getEventsSince(api, "cmd-a", 0);
    const eventsB = await getEventsSince(api, "cmd-b", 0);
    expect(eventsA.map((e) => e.seq)).toEqual([1, 2]);
    expect(eventsB.map((e) => e.seq)).toEqual([1]);
  });

  it("replays only events after the given seq", async () => {
    await emitCommandEvent(api, "cmd-1", { type: "text" });
    await emitCommandEvent(api, "cmd-1", { type: "text" });
    await emitCommandEvent(api, "cmd-1", { type: "done" });

    const replay = await getEventsSince(api, "cmd-1", 1);
    expect(replay.map((e) => e.seq)).toEqual([2, 3]);
  });

  it("prunes events only for commands completed before the retention cutoff", async () => {
    const oldCompletedAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const recentCompletedAt = Date.now() - 1 * 24 * 60 * 60 * 1000;
    await (api.db as any).execute(`INSERT INTO kanban_command_queue (id, completed_at) VALUES (?, ?)`, ["old-cmd", oldCompletedAt]);
    await (api.db as any).execute(`INSERT INTO kanban_command_queue (id, completed_at) VALUES (?, ?)`, ["recent-cmd", recentCompletedAt]);

    await emitCommandEvent(api, "old-cmd", { type: "done" });
    await emitCommandEvent(api, "recent-cmd", { type: "done" });

    await pruneOldCommandEvents(api, 7);

    expect(await getEventsSince(api, "old-cmd", 0)).toHaveLength(0);
    expect(await getEventsSince(api, "recent-cmd", 0)).toHaveLength(1);
  });
});

describe("tasking/outcomes", () => {
  let api: DutyAPI;
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "ronin-tasking-outcomes-test-"));
    api = createMockAPI(join(scratch, "data"));
    (api.db as any).execute(
      `CREATE TABLE executor_outcomes (id TEXT PRIMARY KEY, command_id TEXT, executor TEXT, task_features TEXT, outcome TEXT, rounds INTEGER, attempts INTEGER, cost_tokens INTEGER, wall_ms INTEGER, created_at INTEGER)`
    );
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("records an outcome with all fields", async () => {
    await recordExecutorOutcome(api, {
      commandId: "cmd-1",
      executor: "claude",
      outcome: "success",
      rounds: 2,
      attempts: 1,
      costTokens: 500,
      wallMs: 12000,
      taskFeatures: { labels: ["#claude"] },
    });

    const rows = await api.db.query<any>(`SELECT * FROM executor_outcomes WHERE command_id = ?`, ["cmd-1"]);
    expect(rows[0].executor).toBe("claude");
    expect(rows[0].outcome).toBe("success");
    expect(rows[0].rounds).toBe(2);
    expect(JSON.parse(rows[0].task_features)).toEqual({ labels: ["#claude"] });
  });

  it("records an outcome with only required fields", async () => {
    await recordExecutorOutcome(api, { commandId: "cmd-2", executor: "ronin", outcome: "failed" });
    const rows = await api.db.query<any>(`SELECT * FROM executor_outcomes WHERE command_id = ?`, ["cmd-2"]);
    expect(rows[0].outcome).toBe("failed");
    expect(rows[0].rounds).toBeNull();
  });
});
