/**
 * Round-scoped diff mechanics (spec §9.2). A "round" is one dispatch of a
 * command against a worktree — the initial run, or one comment-resume cycle.
 * Diffs are captured between two refs so a reviewer can look at "round 3
 * only" instead of the whole cumulative branch diff.
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/** The commit where taskBranch diverged from baseBranch — round 1's from_ref. */
export async function getBranchPointRef(worktreePath: string, baseBranch: string, taskBranch: string): Promise<string> {
  const { stdout } = await execAsync(`git merge-base "${baseBranch}" "${taskBranch}"`, { cwd: worktreePath });
  return stdout.trim();
}

export async function getCurrentRef(worktreePath: string): Promise<string> {
  const { stdout } = await execAsync(`git rev-parse HEAD`, { cwd: worktreePath });
  return stdout.trim();
}

/**
 * If the executor left uncommitted changes, commits them so a real ref
 * exists to diff against for the next round (spec §9.2: "wip: round N if
 * the agent didn't commit"). Returns true if a commit was made.
 */
export async function commitIfDirty(worktreePath: string, round: number): Promise<boolean> {
  const { stdout } = await execAsync(`git status --porcelain`, { cwd: worktreePath });
  if (stdout.trim().length === 0) return false;

  await execAsync(`git add -A`, { cwd: worktreePath });
  await execAsync(`git commit -m "wip: round ${round}"`, { cwd: worktreePath });
  return true;
}

export async function diffBetweenRefs(worktreePath: string, fromRef: string, toRef: string): Promise<string> {
  if (fromRef === toRef) return "";
  const { stdout } = await execAsync(`git diff "${fromRef}..${toRef}"`, { cwd: worktreePath });
  return stdout;
}

export async function filesChangedBetweenRefs(worktreePath: string, fromRef: string, toRef: string): Promise<string[]> {
  if (fromRef === toRef) return [];
  const { stdout } = await execAsync(`git diff --name-only "${fromRef}..${toRef}"`, { cwd: worktreePath });
  return stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}
