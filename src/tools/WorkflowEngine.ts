import type { WorkflowDefinition, WorkflowStep, ToolCall, ToolContext, ToolResult } from "./types.js";
import type { ToolRouter } from "./ToolRouter.js";

/**
 * WorkflowEngine
 * 
 * Executes multi-step tool workflows with variable interpolation
 * and conditional execution.
 */
export class WorkflowEngine {
  private toolRouter: ToolRouter;
  private workflows: Map<string, WorkflowDefinition> = new Map();

  constructor(toolRouter: ToolRouter) {
    this.toolRouter = toolRouter;
  }

  /**
   * Register a workflow
   */
  registerWorkflow(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.name, workflow);
    console.log(`[WorkflowEngine] Registered workflow: ${workflow.name}`);
  }

  /**
   * Get a workflow definition
   */
  getWorkflow(name: string): WorkflowDefinition | undefined {
    return this.workflows.get(name);
  }

  /**
   * List all workflows
   */
  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowName: string,
    initialArgs: Record<string, any>,
    context: ToolContext
  ): Promise<WorkflowResult> {
    const workflow = this.workflows.get(workflowName);
    if (!workflow) {
      throw new Error(`Workflow '${workflowName}' not found`);
    }

    console.log(`[WorkflowEngine] Executing workflow: ${workflow.name}`);
    
    const variables: Record<string, any> = {
      ...workflow.variables,
      args: initialArgs,
    };
    
    const results: WorkflowStepResult[] = [];
    const startTime = Date.now();

    for (const step of workflow.steps) {
      console.log(`[WorkflowEngine] Executing step: ${step.id}`);

      // Check condition
      if (step.condition && !this.evaluateCondition(step.condition, variables)) {
        console.log(`[WorkflowEngine] Skipping step ${step.id} - condition not met`);
        continue;
      }

      // Resolve input with variable interpolation
      const resolvedInput = this.resolveVariables(step.input, variables);

      // Execute tool
      const toolCall: ToolCall = {
        name: step.tool,
        arguments: resolvedInput,
        id: `workflow-${workflowName}-${step.id}-${Date.now()}`,
        timestamp: Date.now(),
        conversationId: context.conversationId,
      };

      try {
        const result = await this.toolRouter.execute(toolCall, context);
        
        results.push({
          stepId: step.id,
          tool: step.tool,
          success: result.success,
          data: result.data,
          error: result.error,
          duration: result.metadata.duration,
        });

        // Store output in variables if specified
        if (step.output) {
          variables[step.output] = result.data;
        }

        // Store step result
        variables[`${step.id}_result`] = result;
        variables[`${step.id}_success`] = result.success;

        if (!result.success) {
          console.error(`[WorkflowEngine] Step ${step.id} failed:`, result.error);
          // Continue or break? For now, continue
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[WorkflowEngine] Step ${step.id} error:`, errorMessage);
        
        results.push({
          stepId: step.id,
          tool: step.tool,
          success: false,
          error: errorMessage,
        });

        if (step.output) {
          variables[step.output] = null;
        }
        variables[`${step.id}_success`] = false;
      }
    }

    const totalDuration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;

    console.log(`[WorkflowEngine] Workflow ${workflow.name} completed: ${successCount}/${results.length} steps successful`);

    return {
      workflow: workflowName,
      success: successCount === results.length,
      steps: results,
      variables,
      duration: totalDuration,
    };
  }

  /**
   * Resolve variables in input object
   * Supports:
   * - Static values: { query: "fixed string" }
   * - Previous step outputs: { data: "$step1.output" }
   * - Workflow variables: { config: "$vars.api_key" }
   * - Args: { topic: "$args.topic" }
   */
  private resolveVariables(
    input: Record<string, any>,
    variables: Record<string, any>
  ): Record<string, any> {
    const resolved: Record<string, any> = {};

    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string' && value.startsWith('$')) {
        resolved[key] = this.resolveVariable(value, variables);
      } else if (typeof value === 'object' && value !== null) {
        resolved[key] = this.resolveVariables(value, variables);
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Resolve a single variable reference
   */
  private resolveVariable(path: string, variables: Record<string, any>): any {
    // Remove $ prefix
    const cleanPath = path.substring(1);
    
    // Handle special prefixes
    if (cleanPath.startsWith('args.')) {
      const key = cleanPath.substring(5);
      return variables.args?.[key];
    }
    
    if (cleanPath.startsWith('vars.')) {
      const key = cleanPath.substring(5);
      return variables[key];
    }
    
    // Handle step outputs: step1.output
    const parts = cleanPath.split('.');
    if (parts.length >= 2) {
      const stepId = parts[0];
      const property = parts[1];
      const stepResult = variables[`${stepId}_result`];
      
      if (property === 'output') {
        return stepResult?.data;
      }
      return stepResult?.[property];
    }
    
    // Direct variable access
    return variables[cleanPath];
  }

  /**
   * Evaluate a condition expression
   * Simple expressions: "$step1_success == true"
   */
  private evaluateCondition(condition: string, variables: Record<string, any>): boolean {
    try {
      // Replace variable references
      let expr = condition;
      const varMatches = condition.match(/\$[a-zA-Z0-9_.]+/g) || [];
      
      for (const match of varMatches) {
        const value = this.resolveVariable(match, variables);
        const stringValue = typeof value === 'boolean' ? value : `"${value}"`;
        expr = expr.replace(match, String(stringValue));
      }
      
      // Evaluate (safe evaluation for simple comparisons)
      // eslint-disable-next-line no-eval
      return eval(expr);
    } catch (error) {
      console.error(`[WorkflowEngine] Condition evaluation failed:`, condition, error);
      return false;
    }
  }
}

interface WorkflowResult {
  workflow: string;
  success: boolean;
  steps: WorkflowStepResult[];
  variables: Record<string, any>;
  duration: number;
}

interface WorkflowStepResult {
  stepId: string;
  tool: string;
  success: boolean;
  data?: any;
  error?: string;
  duration?: number;
}
