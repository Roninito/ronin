import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";
import type { ToolCompletedEvent, ToolPolicyViolationEvent } from "../types.js";

/**
 * Tool Analytics Agent
 * 
 * Tracks tool usage, costs, and provides analytics dashboards
 */
export default class ToolAnalyticsAgent extends BaseAgent {
  static schedule = "0 */6 * * *"; // Every 6 hours

  constructor(api: AgentAPI) {
    super(api);
    console.log("[tool-analytics] Analytics Agent initialized");
    this.registerEventListeners();
  }

  /**
   * Register event listeners
   */
  private registerEventListeners(): void {
    // Listen for tool completion events
    this.api.events.on("tool.completed", async (data: unknown) => {
      const event = data as ToolCompletedEvent;
      await this.recordToolUsage(event);
    }, "tool-analytics");

    // Listen for policy violations
    this.api.events.on("tool.policyViolation", async (data: unknown) => {
      const event = data as ToolPolicyViolationEvent;
      await this.recordPolicyViolation(event);
    }, "tool-analytics");

    console.log("[tool-analytics] Event listeners registered");
  }

  /**
   * Record tool usage
   */
  private async recordToolUsage(event: ToolCompletedEvent): Promise<void> {
    try {
      // Store in daily bucket
      const date = new Date(event.timestamp);
      const dayKey = date.toISOString().split('T')[0];
      const hour = date.getHours();
      
      const record = {
        toolName: event.toolName,
        success: event.success,
        cost: event.cost,
        duration: event.duration,
        cached: event.cached,
        conversationId: event.conversationId,
        timestamp: event.timestamp,
        hour,
      };

      // Append to daily log
      const dailyLogKey = `analytics.tools.daily.${dayKey}`;
      const existingLog = await this.api.memory.retrieve(dailyLogKey);
      const log = existingLog ? JSON.parse(existingLog as string) : [];
      log.push(record);
      await this.api.memory.store(dailyLogKey, JSON.stringify(log));

      // Update tool statistics
      await this.updateToolStats(event.toolName, event);
      
      // Update cost tracking
      if (event.cost) {
        await this.updateCostTracking(dayKey, event.cost);
      }

    } catch (error) {
      console.error("[tool-analytics] Error recording usage:", error);
    }
  }

  /**
   * Update per-tool statistics
   */
  private async updateToolStats(toolName: string, event: ToolCompletedEvent): Promise<void> {
    const statsKey = `analytics.tools.stats.${toolName}`;
    
    try {
      const existing = await this.api.memory.retrieve(statsKey);
      const stats = existing ? JSON.parse(existing as string) : {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        totalCost: 0,
        totalDuration: 0,
        cachedCalls: 0,
        firstUsed: event.timestamp,
      };

      stats.totalCalls++;
      stats.successfulCalls += event.success ? 1 : 0;
      stats.failedCalls += event.success ? 0 : 1;
      stats.totalCost += event.cost || 0;
      stats.totalDuration += event.duration;
      stats.cachedCalls += event.cached ? 1 : 0;
      stats.lastUsed = event.timestamp;

      await this.api.memory.store(statsKey, JSON.stringify(stats));
    } catch (error) {
      console.error("[tool-analytics] Error updating tool stats:", error);
    }
  }

  /**
   * Update cost tracking
   */
  private async updateCostTracking(dayKey: string, cost: number): Promise<void> {
    try {
      const costKey = `analytics.costs.daily.${dayKey}`;
      const existing = await this.api.memory.retrieve(costKey);
      const dailyCost = existing ? parseFloat(existing as string) : 0;
      await this.api.memory.store(costKey, String(dailyCost + cost));
    } catch (error) {
      console.error("[tool-analytics] Error updating cost tracking:", error);
    }
  }

  /**
   * Record policy violation
   */
  private async recordPolicyViolation(event: ToolPolicyViolationEvent): Promise<void> {
    try {
      const record = {
        toolName: event.toolName,
        reason: event.reason,
        estimatedCost: event.estimatedCost,
        conversationId: event.conversationId,
        timestamp: event.timestamp,
      };

      const violationsKey = "analytics.policy.violations";
      const existing = await this.api.memory.retrieve(violationsKey);
      const violations = existing ? JSON.parse(existing as string) : [];
      violations.push(record);
      
      // Keep only last 100 violations
      if (violations.length > 100) {
        violations.shift();
      }
      
      await this.api.memory.store(violationsKey, JSON.stringify(violations));
    } catch (error) {
      console.error("[tool-analytics] Error recording violation:", error);
    }
  }

  /**
   * Get tool statistics
   */
  async getToolStats(toolName?: string): Promise<any> {
    try {
      if (toolName) {
        const statsKey = `analytics.tools.stats.${toolName}`;
        const data = await this.api.memory.retrieve(statsKey);
        return data ? JSON.parse(data as string) : null;
      }

      // Get all tool stats
      const allStats: Record<string, any> = {};
      const keys = await this.api.memory.search("analytics.tools.stats.", 100);
      
      for (const key of keys) {
        const toolName = key.replace("analytics.tools.stats.", "");
        const data = await this.api.memory.retrieve(key);
        if (data) {
          allStats[toolName] = JSON.parse(data as string);
        }
      }

      return allStats;
    } catch (error) {
      console.error("[tool-analytics] Error getting tool stats:", error);
      return null;
    }
  }

  /**
   * Get cost report
   */
  async getCostReport(days: number = 30): Promise<any> {
    try {
      const costs: Record<string, number> = {};
      const now = new Date();
      
      for (let i = 0; i < days; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dayKey = date.toISOString().split('T')[0];
        
        const costKey = `analytics.costs.daily.${dayKey}`;
        const cost = await this.api.memory.retrieve(costKey);
        if (cost) {
          costs[dayKey] = parseFloat(cost as string);
        }
      }

      const totalCost = Object.values(costs).reduce((sum, cost) => sum + cost, 0);
      const avgDaily = totalCost / days;

      return {
        totalCost,
        avgDaily,
        dailyBreakdown: costs,
        projectedMonthly: avgDaily * 30,
      };
    } catch (error) {
      console.error("[tool-analytics] Error getting cost report:", error);
      return null;
    }
  }

  /**
   * Get hourly usage patterns
   */
  async getHourlyPatterns(days: number = 7): Promise<any> {
    try {
      const hourlyStats: Record<number, number> = {};
      const now = new Date();

      for (let i = 0; i < days; i++) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dayKey = date.toISOString().split('T')[0];
        
        const dailyLogKey = `analytics.tools.daily.${dayKey}`;
        const log = await this.api.memory.retrieve(dailyLogKey);
        
        if (log) {
          const records = JSON.parse(log as string);
          for (const record of records) {
            const hour = record.hour;
            hourlyStats[hour] = (hourlyStats[hour] || 0) + 1;
          }
        }
      }

      return hourlyStats;
    } catch (error) {
      console.error("[tool-analytics] Error getting hourly patterns:", error);
      return null;
    }
  }

  /**
   * Generate analytics report
   */
  async generateReport(): Promise<string> {
    const stats = await this.getToolStats();
    const costReport = await this.getCostReport(7);
    const hourlyPatterns = await this.getHourlyPatterns(7);

    let report = "# Tool Usage Analytics Report\n\n";

    // Cost summary
    if (costReport) {
      report += "## Cost Summary (Last 7 Days)\n";
      report += `- Total: $${costReport.totalCost.toFixed(4)}\n`;
      report += `- Daily Average: $${costReport.avgDaily.toFixed(4)}\n`;
      report += `- Projected Monthly: $${costReport.projectedMonthly.toFixed(2)}\n\n`;
    }

    // Tool statistics
    if (stats && Object.keys(stats).length > 0) {
      report += "## Tool Statistics\n\n";
      report += "| Tool | Calls | Success Rate | Avg Duration | Total Cost |\n";
      report += "|------|-------|--------------|--------------|------------|\n";

      for (const [toolName, toolStats] of Object.entries(stats)) {
        const s = toolStats as any;
        const successRate = s.totalCalls > 0 ? ((s.successfulCalls / s.totalCalls) * 100).toFixed(1) : 0;
        const avgDuration = s.totalCalls > 0 ? (s.totalDuration / s.totalCalls).toFixed(0) : 0;
        report += `| ${toolName} | ${s.totalCalls} | ${successRate}% | ${avgDuration}ms | $${s.totalCost.toFixed(4)} |\n`;
      }

      report += "\n";
    }

    // Peak usage hours
    if (hourlyPatterns && Object.keys(hourlyPatterns).length > 0) {
      report += "## Peak Usage Hours\n\n";
      const sortedHours = Object.entries(hourlyPatterns)
        .sort((a: any, b: any) => b[1] - a[1])
        .slice(0, 5);
      
      for (const [hour, count] of sortedHours) {
        report += `- ${hour}:00 - ${count} calls\n`;
      }
    }

    return report;
  }

  /**
   * Scheduled execution - generates periodic reports
   */
  async execute(): Promise<void> {
    console.log("[tool-analytics] Generating periodic report...");
    
    const report = await this.generateReport();
    
    // Store report
    const reportKey = `analytics.report.${new Date().toISOString().split('T')[0]}`;
    await this.api.memory.store(reportKey, report);
    
    console.log("[tool-analytics] Report generated and stored");
    console.log(report);
  }
}
