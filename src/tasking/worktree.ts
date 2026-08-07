/**
 * Git worktree-per-task provisioning for coding-executor commands.
 * Genuinely new — no existing worktree usage anywhere in Ronin to reuse.
 * Uses the same promisify(exec) pattern every plugins/*-cli.ts already uses;
 * no new subprocess abstraction.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { basename, join } from "path";
import type { DutyAPI } from "../types/index.js";

const execAsync = promisify(exec);

export interface ProvisionedWorktree {
  worktreePath: string;
  taskBranch: string;
}

/**
 * Worktree root. Spec hardcodes `/worktrees` (assumes a container volume
 * that doesn't exist in this repo) — resolved against system.dataDir
 * instead, same convention as src/artifacts/storage.ts.
 */
export function getWorktreeRoot(api: DutyAPI): string {
  const configured = api.config.getTasking().worktreeRoot;
  if (configured) return configured;
  return join(api.config.getSystem().dataDir, "tasking", "worktrees");
}

function sanitizeRepoName(repoPath: string): string {
  return basename(repoPath).replace(/[^a-zA-Z0-9._-]/g, "-") || "repo";
}

export function getWorktreePath(api: DutyAPI, repoPath: string, cardId: string): string {
  return join(getWorktreeRoot(api), sanitizeRepoName(repoPath), cardId);
}

export function getTaskBranch(cardId: string): string {
  return `task/${cardId}`;
}

// In-memory per-repo mutex. TodoAgent is a single-process singleton duty, so
// a Promise-chain mutex is sufficient — no distributed lock needed. Only
// `git worktree add`/`remove` are serialized; execution itself is not.
const repoMutexes = new Map<string, Promise<void>>();

async function withRepoMutex<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const key = sanitizeRepoName(repoPath);
  const prior = repoMutexes.get(key) ?? Promise.resolve();
  let release: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  repoMutexes.set(key, prior.then(() => gate));

  await prior;
  try {
    return await fn();
  } finally {
    release!();
  }
}

/**
 * Provisions a fresh worktree + branch for a card. Caller is responsible for
 * skipping this on resume (spec §2: "if worktree_path set → skip
 * provisioning") — that's a queue-row check in duties/tasking.ts, not this
 * module's concern.
 */
export async function provisionWorktree(
  api: DutyAPI,
  repoPath: string,
  cardId: string,
  baseBranch: string
): Promise<ProvisionedWorktree> {
  if (!existsSync(repoPath)) {
    throw new Error(`repo_path does not exist: ${repoPath}`);
  }

  const worktreePath = getWorktreePath(api, repoPath, cardId);
  const taskBranch = getTaskBranch(cardId);

  await withRepoMutex(repoPath, async () => {
    await execAsync(`git worktree add "${worktreePath}" -b "${taskBranch}" "${baseBranch}"`, {
      cwd: repoPath,
    });
  });

  return { worktreePath, taskBranch };
}

/**
 * Releases a worktree + deletes its task branch. Only called on terminal
 * states (Done/Rejected) — never on Review or Merge Conflict, which need the
 * worktree alive for resume. Tolerant of "already removed" style errors
 * since release runs at cleanup time and shouldn't crash the duty loop.
 */
export async function releaseWorktree(
  api: DutyAPI,
  repoPath: string,
  worktreePath: string,
  taskBranch: string,
  deleteBranch: boolean = true
): Promise<void> {
  await withRepoMutex(repoPath, async () => {
    try {
      await execAsync(`git worktree remove "${worktreePath}" --force`, { cwd: repoPath });
    } catch (error: any) {
      console.warn(`[tasking/worktree] worktree remove failed (continuing): ${error.message}`);
    }

    if (deleteBranch) {
      try {
        await execAsync(`git branch -D "${taskBranch}"`, { cwd: repoPath });
      } catch (error: any) {
        console.warn(`[tasking/worktree] branch delete failed (continuing): ${error.message}`);
      }
    }
  });
}
