/**
 * Read/write access to workflows/*.md — used by duties/workflow-manager.ts
 * for the /workflows page (direct save, no approval gate — see §8.1 of
 * docs/WORKFLOWS_PLAN.md) and for writing an approved AI-drafted proposal
 * to disk.
 */

import { existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import {
  getWorkflowsDir,
  sanitizeWorkflowName,
  listWorkflows as listWorkflowsFn,
  loadWorkflow as loadWorkflowFn,
} from "./discovery.js";
import type { WorkflowDoc, WorkflowMeta } from "./types.js";

export class WorkflowStorage {
  constructor(private projectRoot: string = process.cwd()) {}

  private dir(): string {
    return getWorkflowsDir(this.projectRoot);
  }

  private ensureDir(): void {
    const dir = this.dir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  list(): WorkflowMeta[] {
    return listWorkflowsFn(this.projectRoot);
  }

  get(name: string): WorkflowDoc | null {
    return loadWorkflowFn(name, this.projectRoot);
  }

  /** Raw markdown text for a workflow, or null if it doesn't exist. */
  async readRaw(name: string): Promise<string | null> {
    const safe = sanitizeWorkflowName(name);
    if (!safe) return null;
    const filePath = join(this.dir(), `${safe}.md`);
    if (!existsSync(filePath)) return null;
    return await Bun.file(filePath).text();
  }

  /**
   * Create or overwrite a workflow file with the given full markdown
   * content (frontmatter included). Returns the sanitized name actually
   * used. Throws on an invalid name — never silently writes outside
   * workflows/.
   */
  async save(name: string, content: string): Promise<string> {
    const safe = sanitizeWorkflowName(name);
    if (!safe) {
      throw new Error(`Invalid workflow name "${name}" — use lowercase letters, numbers, and hyphens only.`);
    }
    this.ensureDir();
    const filePath = join(this.dir(), `${safe}.md`);
    await Bun.write(filePath, content);
    return safe;
  }

  async delete(name: string): Promise<boolean> {
    const safe = sanitizeWorkflowName(name);
    if (!safe) return false;
    const filePath = join(this.dir(), `${safe}.md`);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
  }
}
