import type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolContext,
  OpenAIFunctionSchema,
  ToolPolicy,
  ValidationResult,
  ToolCompletedEvent,
  ToolPolicyViolationEvent,
} from "./types.js";
import type { AgentAPI } from "../types/index.js";

/**
 * ToolRouter
 * 
 * Central hub for tool registration, discovery, and execution.
 * Routes tool calls to appropriate handlers with policy enforcement.
 */
export class ToolRouter {
  private tools: Map<string, ToolDefinition> = new Map();
  private api: AgentAPI;
  private policy: ToolPolicy;
  private callHistory: Map<string, number[]> = new Map(); // toolName -> timestamps
  private dailyCost: number = 0;
  private monthlyCost: number = 0;
  private lastCostReset: Date = new Date();

  constructor(api: AgentAPI) {
    this.api = api;
    this.policy = this.loadDefaultPolicy();
    this.startCostTracking();
    if (!process.env.RONIN_QUIET) console.log("[ToolRouter] Initialized");
  }

  /**
   * Register a new tool
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      if (!process.env.RONIN_QUIET) console.warn(`[ToolRouter] Tool '${tool.name}' already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
    if (!process.env.RONIN_QUIET) console.log(`[ToolRouter] Registered tool: ${tool.name} (${tool.provider})`);
  }

  /**
   * Unregister a tool
   */
  unregister(toolName: string): void {
    if (this.tools.delete(toolName)) {
      console.log(`[ToolRouter] Unregistered tool: ${toolName}`);
    }
  }

  /**
   * Get all registered tools
   */
  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get a specific tool
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if tool exists
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Convert tools to OpenAI-compatible schema for Ollama
   */
  getToolSchemas(): OpenAIFunctionSchema[] {
    return this.listTools().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Execute a tool call
   */
  async execute(call: ToolCall, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    
    if (!tool) {
      const error = `Tool '${call.name}' not found`;
      console.error(`[ToolRouter] ${error}`);
      return this.createErrorResult(call, error);
    }

    // Check policy
    const validation = await this.validateToolCall(call, tool);
    if (!validation.allowed) {
      const event: ToolPolicyViolationEvent = {
        toolName: call.name,
        reason: validation.reason || 'Policy violation',
        estimatedCost: validation.estimatedCost,
        conversationId: call.conversationId,
        timestamp: Date.now(),
      };
      this.api.events.emit('tool.policyViolation', event, 'tool-router');
      
      return this.createErrorResult(call, validation.reason || 'Not allowed');
    }

    // Check if confirmation required
    if (validation.requiresConfirmation) {
      // For now, auto-confirm in non-interactive mode
      // TODO: Implement confirmation UI
      console.log(`[ToolRouter] Auto-confirming high-cost tool: ${call.name}`);
    }

    // Execute with timing
    const startTime = Date.now();
    let result: ToolResult;
    let cached = false;

    try {
      // Check cache first
      if (tool.cacheable) {
        const cachedResult = await this.getCachedResult(call);
        if (cachedResult) {
          console.log(`[ToolRouter] Cache hit for ${call.name}`);
          result = cachedResult;
          cached = true;
        }
      }

      // Execute if not cached
      if (!cached) {
        console.log(`[ToolRouter] Executing ${call.name}`);
        const handlerResult = await tool.handler(call.arguments, context);
        
        result = {
          ...handlerResult,
          metadata: {
            ...handlerResult.metadata,
            toolName: call.name,
            provider: tool.provider,
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: call.id,
          },
        };

        // Cache result if applicable
        if (tool.cacheable && result.success) {
          await this.cacheResult(call, result, tool.ttl);
        }
      }

      // Update cost tracking
      if (result.metadata.cost) {
        this.trackCost(result.metadata.cost);
      }

      // Track call history
      this.trackCall(call.name);

      // Store in memory
      await this.storeToolResult(result, context);

      // Emit completion event
      const event: ToolCompletedEvent = {
        toolName: call.name,
        success: result.success,
        cost: result.metadata.cost,
        duration: result.metadata.duration,
        cached: result.metadata.cached,
        data: result.data,
        error: result.error,
        conversationId: call.conversationId,
        timestamp: Date.now(),
      };
      this.api.events.emit('tool.completed', event, 'tool-router');

      console.log(`[ToolRouter] ${call.name} completed in ${result.metadata.duration}ms`);
      
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ToolRouter] Error executing ${call.name}:`, errorMessage);
      
      result = this.createErrorResult(call, errorMessage);
      
      // Emit failure event
      const event: ToolCompletedEvent = {
        toolName: call.name,
        success: false,
        duration: Date.now() - startTime,
        cached: false,
        error: errorMessage,
        conversationId: call.conversationId,
        timestamp: Date.now(),
      };
      this.api.events.emit('tool.completed', event, 'tool-router');
      
      return result;
    }
  }

  /**
   * Validate a tool call against policy
   */
  private async validateToolCall(
    call: ToolCall,
    tool: ToolDefinition
  ): Promise<ValidationResult> {
    // Check if tool is disabled
    const toolPolicy = this.policy.tools[call.name];
    if (toolPolicy?.disabled) {
      return { allowed: false, reason: 'Tool is disabled' };
    }

    // Check context restrictions
    if (toolPolicy?.allowedContexts && toolPolicy.allowedContexts.length > 0) {
      // Context check would go here
    }

    // Estimate cost
    let estimatedCost: number | undefined;
    if (tool.cost?.estimate) {
      estimatedCost = tool.cost.estimate(call.arguments);
    }

    // Check cost limits
    if (estimatedCost !== undefined) {
      // Per-tool cost limit
      if (toolPolicy?.maxCost && estimatedCost > toolPolicy.maxCost) {
        return {
          allowed: false,
          reason: `Cost $${estimatedCost.toFixed(4)} exceeds per-tool limit`,
          estimatedCost,
        };
      }

      // Total cost limits
      if (this.policy.maxPerToolCost && estimatedCost > this.policy.maxPerToolCost) {
        return {
          allowed: false,
          reason: `Cost exceeds maximum per-call limit`,
          estimatedCost,
        };
      }

      // Daily/monthly limits
      if (this.policy.maxDailyCost && this.dailyCost + estimatedCost > this.policy.maxDailyCost) {
        return {
          allowed: false,
          reason: 'Daily cost limit would be exceeded',
          estimatedCost,
        };
      }
    }

    // Check rate limits
    const rateLimitCheck = this.checkRateLimits(call.name, toolPolicy);
    if (!rateLimitCheck.allowed) {
      return { allowed: false, reason: rateLimitCheck.reason };
    }

    // Check confirmation requirement
    let requiresConfirmation = false;
    if (toolPolicy?.requireConfirmation) {
      if (typeof toolPolicy.requireConfirmation === 'function' && estimatedCost) {
        requiresConfirmation = toolPolicy.requireConfirmation(estimatedCost);
      } else {
        requiresConfirmation = true;
      }
    }

    return {
      allowed: true,
      requiresConfirmation,
      estimatedCost,
    };
  }

  /**
   * Check rate limits for a tool
   */
  private checkRateLimits(
    toolName: string,
    toolPolicy?: ToolPolicyRule
  ): { allowed: boolean; reason?: string } {
    const history = this.callHistory.get(toolName) || [];
    const now = Date.now();
    
    // Clean old entries
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;
    const recentCalls = history.filter(t => t > hourAgo);
    const dailyCalls = history.filter(t => t > dayAgo);
    
    // Update history
    this.callHistory.set(toolName, recentCalls);

    // Check hourly limit
    if (toolPolicy?.maxCallsPerHour && recentCalls.length >= toolPolicy.maxCallsPerHour) {
      return { allowed: false, reason: 'Hourly rate limit exceeded' };
    }

    // Check daily limit
    if (toolPolicy?.maxCallsPerDay && dailyCalls.length >= toolPolicy.maxCallsPerDay) {
      return { allowed: false, reason: 'Daily rate limit exceeded' };
    }

    return { allowed: true };
  }

  /**
   * Track a tool call
   */
  private trackCall(toolName: string): void {
    const history = this.callHistory.get(toolName) || [];
    history.push(Date.now());
    this.callHistory.set(toolName, history);
  }

  /**
   * Track cost
   */
  private trackCost(cost: number): void {
    this.dailyCost += cost;
    this.monthlyCost += cost;
  }

  /**
   * Get cached result if available
   */
  private async getCachedResult(call: ToolCall): Promise<ToolResult | null> {
    const cacheKey = `tool.cache.${call.name}.${JSON.stringify(call.arguments)}`;
    try {
      const cached = await this.api.memory.retrieve(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }
    } catch (error) {
      // Cache miss or error
    }
    return null;
  }

  /**
   * Cache a tool result
   */
  private async cacheResult(call: ToolCall, result: ToolResult, ttl?: number): Promise<void> {
    const cacheKey = `tool.cache.${call.name}.${JSON.stringify(call.arguments)}`;
    try {
      await this.api.memory.store(cacheKey, JSON.stringify(result), { ttl });
    } catch (error) {
      console.error('[ToolRouter] Failed to cache result:', error);
    }
  }

  /**
   * Store tool result in memory
   */
  private async storeToolResult(result: ToolResult, context: ToolContext): Promise<void> {
    try {
      await this.api.memory.store(`tool.result.${result.metadata.callId}`, {
        data: result.data,
        metadata: result.metadata,
        context: {
          conversationId: context.conversationId,
          userId: context.userId,
          originalQuery: context.originalQuery,
        },
      });
    } catch (error) {
      console.error('[ToolRouter] Failed to store result:', error);
    }
  }

  /**
   * Create an error result
   */
  private createErrorResult(call: ToolCall, error: string): ToolResult {
    return {
      success: false,
      data: null,
      error,
      metadata: {
        toolName: call.name,
        provider: 'error',
        duration: 0,
        cached: false,
        timestamp: Date.now(),
        callId: call.id,
      },
    };
  }

  /**
   * Load default policy
   */
  private loadDefaultPolicy(): ToolPolicy {
    return {
      maxMonthlyCost: 50,
      maxDailyCost: 5,
      maxPerToolCost: 2,
      tools: {},
      escalation: {
        lowConfidenceThreshold: 0.6,
        fallbackTool: 'local.reasoning',
      },
    };
  }

  /**
   * Update policy
   */
  setPolicy(policy: ToolPolicy): void {
    this.policy = { ...this.policy, ...policy };
    console.log('[ToolRouter] Policy updated');
  }

  /**
   * Get current policy
   */
  getPolicy(): ToolPolicy {
    return this.policy;
  }

  /**
   * Get cost statistics
   */
  getCostStats(): { daily: number; monthly: number } {
    return {
      daily: this.dailyCost,
      monthly: this.monthlyCost,
    };
  }

  /**
   * Start cost tracking with periodic reset
   */
  private startCostTracking(): void {
    // Reset daily cost at midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      this.dailyCost = 0;
      this.startCostTracking(); // Schedule next reset
    }, msUntilMidnight);

    // Reset monthly cost on 1st of month
    if (now.getDate() === 1) {
      this.monthlyCost = 0;
    }
  }
}
