/**
 * Workflow Registry
 * 
 * Central registry for managing and loading workflows
 */

import type { WorkflowDefinition } from "../types.js";
import { exampleWorkflows } from "./examples.js";

export class WorkflowRegistry {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private initialized = false;

  constructor() {
    // Load example workflows
    this.loadExampleWorkflows();
  }

  /**
   * Load example workflows
   */
  private loadExampleWorkflows(): void {
    for (const workflow of exampleWorkflows) {
      this.register(workflow);
    }
    console.log(`[WorkflowRegistry] Loaded ${exampleWorkflows.length} example workflows`);
  }

  /**
   * Register a workflow
   */
  register(workflow: WorkflowDefinition): void {
    if (this.workflows.has(workflow.name)) {
      console.warn(`[WorkflowRegistry] Overwriting workflow: ${workflow.name}`);
    }
    this.workflows.set(workflow.name, workflow);
  }

  /**
   * Unregister a workflow
   */
  unregister(name: string): boolean {
    return this.workflows.delete(name);
  }

  /**
   * Get a workflow by name
   */
  get(name: string): WorkflowDefinition | undefined {
    return this.workflows.get(name);
  }

  /**
   * List all workflows
   */
  list(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Check if workflow exists
   */
  has(name: string): boolean {
    return this.workflows.has(name);
  }

  /**
   * Get workflow names
   */
  getNames(): string[] {
    return Array.from(this.workflows.keys());
  }

  /**
   * Search workflows by description
   */
  search(query: string): WorkflowDefinition[] {
    const lowerQuery = query.toLowerCase();
    return this.list().filter(
      w =>
        w.name.toLowerCase().includes(lowerQuery) ||
        w.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Clear all workflows (use with caution)
   */
  clear(): void {
    this.workflows.clear();
    console.log("[WorkflowRegistry] All workflows cleared");
  }

  /**
   * Export workflows to JSON
   */
  export(): string {
    return JSON.stringify(this.list(), null, 2);
  }

  /**
   * Import workflows from JSON
   */
  import(json: string): void {
    try {
      const workflows: WorkflowDefinition[] = JSON.parse(json);
      for (const workflow of workflows) {
        this.register(workflow);
      }
      console.log(`[WorkflowRegistry] Imported ${workflows.length} workflows`);
    } catch (error) {
      console.error("[WorkflowRegistry] Failed to import workflows:", error);
      throw error;
    }
  }
}

// Singleton instance
let registry: WorkflowRegistry | null = null;

export function getWorkflowRegistry(): WorkflowRegistry {
  if (!registry) {
    registry = new WorkflowRegistry();
  }
  return registry;
}

export function resetWorkflowRegistry(): void {
  registry = null;
}
