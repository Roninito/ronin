/**
 * Merge + conflict resolution for coding-executor commands (spec §5).
 * Mechanically close to the spec as written — the queue/dependency tables it
 * assumes are real (kanban_command_queue, kanban_dependencies, already in
 * duties/tasking.ts). Card/dependency creation is done via callbacks the
 * caller (TodoAgent) injects, rather than duplicated raw SQL, so a
 * conflict-resolution card behaves exactly like any other card (position
 * numbering, #ai tagging, source markers, etc. all come for free).
 */

import { exec } from "child_process";
import { promisify } from "util";
import type { DutyAPI } from "../types/index.js";
import { releaseWorktree } from "./worktree.js";

const execAsync = promisify(exec);

export interface DryRunResult {
  clean: boolean;
  conflictedFiles: string[];
}

/**
 * Dry-run a merge of base_branch into the worktree's task branch, aborting
 * either way (this never leaves the worktree in a merging state). Used both
 * at Approve time and for the proactive staleness sweep (spec §5.4).
 */
export async function dryRunMerge(worktreePath: string, baseBranch: string): Promise<DryRunResult> {
  // No explicit fetch/refresh step: worktrees share refs (and the object
  // database) with repoPath directly, so baseBranch here is already whatever
  // it currently points to in the shared repo — no self-fetch needed (and a
  // self-fetch would risk the same checked-out-branch restriction the push
  // in approveMerge is designed around).
  try {
    await execAsync(`git merge --no-commit --no-ff "${baseBranch}"`, { cwd: worktreePath });
    await execAsync(`git merge --abort`, { cwd: worktreePath }).catch(() => {});
    return { clean: true, conflictedFiles: [] };
  } catch {
    let conflictedFiles: string[] = [];
    try {
      const { stdout } = await execAsync(`git diff --name-only --diff-filter=U`, { cwd: worktreePath });
      conflictedFiles = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    } catch {
      // ignore — we still know it conflicted
    }
    await execAsync(`git merge --abort`, { cwd: worktreePath }).catch(() => {});
    return { clean: false, conflictedFiles };
  }
}

export interface ApproveMergeParams {
  repoPath: string;
  worktreePath: string;
  taskBranch: string;
  baseBranch: string;
}

export interface ApproveMergeResult {
  merged: boolean;
  conflictedFiles: string[];
  error?: string;
}

/**
 * Fast-forwards base_branch to taskBranch. Branches are repo-wide, not
 * worktree-scoped — only the *checked-out* state is per-worktree — so
 * whichever of these two is actually safe depends on what repoPath (the
 * primary working directory) currently has checked out:
 *
 * - If repoPath has base_branch checked out (the common case for a
 *   default branch), `git push repoPath task:base` is refused by git
 *   (`receive.denyCurrentBranch`) because it would leave the working tree
 *   out of sync with the ref. The safe move is a local `git merge --ff-only`
 *   run *in* repoPath itself — ordinary git, updates the working tree
 *   correctly, no config changes needed.
 * - If repoPath has something else checked out, base_branch isn't the
 *   checked-out ref, so a local push updates it cleanly.
 */
async function fastForwardBaseBranch(repoPath: string, worktreePath: string, taskBranch: string, baseBranch: string): Promise<void> {
  const { stdout } = await execAsync(`git rev-parse --abbrev-ref HEAD`, { cwd: repoPath });
  const currentBranch = stdout.trim();

  if (currentBranch === baseBranch) {
    await execAsync(`git merge --ff-only "${taskBranch}"`, { cwd: repoPath });
  } else {
    await execAsync(`git push "${repoPath}" "${taskBranch}:${baseBranch}"`, { cwd: worktreePath });
  }
}

/**
 * Spec §5.1. On clean merge: commit the merge on the task branch, then
 * fast-forward base_branch (see fastForwardBaseBranch for why this isn't a
 * single unconditional `git push`).
 */
export async function approveMerge(api: DutyAPI, params: ApproveMergeParams): Promise<ApproveMergeResult> {
  const { repoPath, worktreePath, taskBranch, baseBranch } = params;

  const dryRun = await dryRunMerge(worktreePath, baseBranch);
  if (!dryRun.clean) {
    return { merged: false, conflictedFiles: dryRun.conflictedFiles };
  }

  try {
    await execAsync(`git merge --no-ff "${baseBranch}" -m "merge: ${baseBranch} into ${taskBranch}"`, {
      cwd: worktreePath,
    });
  } catch (error: any) {
    // Should be rare given the dry-run above just succeeded, but the
    // worktree state could have moved between the two calls.
    await execAsync(`git merge --abort`, { cwd: worktreePath }).catch(() => {});
    return { merged: false, conflictedFiles: [], error: error.message };
  }

  try {
    await fastForwardBaseBranch(repoPath, worktreePath, taskBranch, baseBranch);
  } catch (error: any) {
    return {
      merged: false,
      conflictedFiles: [],
      error: `Merge committed on ${taskBranch} but fast-forwarding ${baseBranch} failed: ${error.message}`,
    };
  }

  await releaseWorktree(api, repoPath, worktreePath, taskBranch, true);
  return { merged: true, conflictedFiles: [] };
}

export interface SpawnConflictTaskParams {
  originalCardId: string;
  originalCardTitle: string;
  columnId: string;
  boardId: string;
  executor: string;
  worktreePath: string;
  taskBranch: string;
  baseBranch: string;
  repoPath: string;
  conflictedFiles: string[];
}

export interface CardCreator {
  createCard(
    columnId: string,
    boardId: string,
    title: string,
    description?: string,
    priority?: "low" | "medium" | "high",
    labels?: string[]
  ): Promise<{ id: string }>;
  addDependency(cardId: string, dependsOnId: string): Promise<void>;
}

/**
 * Spec §5.2 — "a conflict is just another command." Reuses the queue +
 * dependency tables directly; no new mechanism.
 */
export async function spawnConflictTask(
  api: DutyAPI,
  cards: CardCreator,
  params: SpawnConflictTaskParams
): Promise<{ conflictCardId: string; commandId: string }> {
  // Leave the worktree in conflicted state so markers are on disk for the
  // resolving session to see.
  await execAsync(`git merge "${params.baseBranch}"`, { cwd: params.worktreePath }).catch(() => {});

  const conflictCard = await cards.createCard(
    params.columnId,
    params.boardId,
    `Resolve conflicts: ${params.originalCardTitle}`,
    `Conflicted files: ${params.conflictedFiles.join(", ") || "(unknown)"}`,
    "high",
    ["#conflict"]
  );

  await cards.addDependency(conflictCard.id, params.originalCardId);

  const commandId = crypto.randomUUID();
  const now = Date.now();
  const instruction = `Resolve merge conflicts between ${params.taskBranch} and ${params.baseBranch}. Conflicted files: ${
    params.conflictedFiles.join(", ") || "(see worktree)"
  }. Preserve the intent of both changes; original task: ${params.originalCardTitle}.`;

  await api.db.execute(
    `INSERT INTO kanban_command_queue (
       id, card_id, instruction, status, executor, worktree_path, task_branch, base_branch, repo_path, session_id, created_at
     ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, NULL, ?)`,
    [
      commandId,
      conflictCard.id,
      instruction,
      params.executor,
      params.worktreePath,
      params.taskBranch,
      params.baseBranch,
      params.repoPath,
      now,
    ]
  );

  return { conflictCardId: conflictCard.id, commandId };
}
