import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

/**
 * Manual Approval Agent
 * 
 * Provides API endpoints and CLI interface to manually approve/reject/block plans
 * Emits approval events that other agents listen to
 * 
 * API Endpoints:
 * - POST /api/plans/:id/approve - Approve a plan
 * - POST /api/plans/:id/reject - Reject a plan
 * - POST /api/plans/:id/block - Block a plan
 * - GET /api/plans - List all pending plans
 */
export default class ManualApprovalAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
    this.registerRoutes();
    console.log("✋ Manual Approval Agent ready");
    console.log("📋 API available at /api/plans/*");
  }

  /**
   * Register HTTP routes for manual approval
   */
  private registerRoutes(): void {
    // List pending plans
    this.api.http.registerRoute("/api/plans", this.handleListPlans.bind(this));
    
    // Approve plan
    this.api.http.registerRoute("/api/plans/approve", this.handleApprovePlan.bind(this));
    
    // Reject plan
    this.api.http.registerRoute("/api/plans/reject", this.handleRejectPlan.bind(this));
    
    // Block plan
    this.api.http.registerRoute("/api/plans/block", this.handleBlockPlan.bind(this));
  }

  /**
   * List all pending plans (cards in "To Do" column)
   */
  private async handleListPlans(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      // Query for cards in "To Do" column with plan tags
      const cards = await this.api.db.query<{
        id: string;
        title: string;
        description: string;
        labels: string;
        created_at: number;
      }>(`
        SELECT c.id, c.title, c.description, c.labels, c.created_at
        FROM kanban_cards c
        JOIN kanban_columns col ON c.column_id = col.id
        WHERE col.name = 'To Do'
        AND c.labels LIKE '%"plan"%'
        ORDER BY c.created_at DESC
      `);

      const plans = cards.map(card => {
        const planId = this.extractPlanId(card.description);
        return {
          cardId: card.id,
          planId,
          title: card.title,
          description: card.description?.replace(/\[plan:[^\]]+\]\s*/, ""),
          labels: JSON.parse(card.labels || "[]"),
          proposedAt: card.created_at,
        };
      });

      return Response.json({ plans });
    } catch (error) {
      console.error("[manual-approval] Failed to list plans:", error);
      return new Response("Internal server error", { status: 500 });
    }
  }

  /**
   * Approve a plan
   */
  private async handleApprovePlan(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await req.json();
      const { planId, cardId } = body;

      if (!planId && !cardId) {
        return new Response("Missing planId or cardId", { status: 400 });
      }

      // Get plan ID from card if not provided
      let targetPlanId = planId;
      if (!targetPlanId && cardId) {
        const cards = await this.api.db.query<{ description: string }>(
          `SELECT description FROM kanban_cards WHERE id = ?`,
          [cardId]
        );
        if (cards.length > 0) {
          targetPlanId = this.extractPlanId(cards[0].description);
        }
      }

      if (!targetPlanId) {
        return new Response("Plan not found", { status: 404 });
      }

      // Emit approval event
      this.api.events.emit("PlanApproved", {
        id: targetPlanId,
        approvedAt: Date.now(),
        approvedBy: "manual",
      }, "manual-approval");

      console.log(`[manual-approval] Plan approved: ${targetPlanId}`);
      
      return Response.json({ 
        success: true, 
        message: `Plan ${targetPlanId} approved`,
        planId: targetPlanId,
      });
    } catch (error) {
      console.error("[manual-approval] Failed to approve plan:", error);
      return new Response("Internal server error", { status: 500 });
    }
  }

  /**
   * Reject a plan
   */
  private async handleRejectPlan(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await req.json();
      const { planId, cardId, reason } = body;

      let targetPlanId = planId;
      if (!targetPlanId && cardId) {
        const cards = await this.api.db.query<{ description: string }>(
          `SELECT description FROM kanban_cards WHERE id = ?`,
          [cardId]
        );
        if (cards.length > 0) {
          targetPlanId = this.extractPlanId(cards[0].description);
        }
      }

      if (!targetPlanId) {
        return new Response("Plan not found", { status: 404 });
      }

      this.api.events.emit("PlanRejected", {
        id: targetPlanId,
        reason: reason || "Rejected manually",
        rejectedAt: Date.now(),
      }, "manual-approval");

      console.log(`[manual-approval] Plan rejected: ${targetPlanId}`);
      
      return Response.json({ 
        success: true, 
        message: `Plan ${targetPlanId} rejected`,
        planId: targetPlanId,
      });
    } catch (error) {
      console.error("[manual-approval] Failed to reject plan:", error);
      return new Response("Internal server error", { status: 500 });
    }
  }

  /**
   * Block a plan
   */
  private async handleBlockPlan(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await req.json();
      const { planId, cardId, reason } = body;

      let targetPlanId = planId;
      if (!targetPlanId && cardId) {
        const cards = await this.api.db.query<{ description: string }>(
          `SELECT description FROM kanban_cards WHERE id = ?`,
          [cardId]
        );
        if (cards.length > 0) {
          targetPlanId = this.extractPlanId(cards[0].description);
        }
      }

      if (!targetPlanId) {
        return new Response("Plan not found", { status: 404 });
      }

      this.api.events.emit("PlanBlocked", {
        id: targetPlanId,
        reason: reason || "Blocked manually",
        blockedAt: Date.now(),
      }, "manual-approval");

      console.log(`[manual-approval] Plan blocked: ${targetPlanId}`);
      
      return Response.json({ 
        success: true, 
        message: `Plan ${targetPlanId} blocked`,
        planId: targetPlanId,
      });
    } catch (error) {
      console.error("[manual-approval] Failed to block plan:", error);
      return new Response("Internal server error", { status: 500 });
    }
  }

  /**
   * Extract plan ID from description
   */
  private extractPlanId(description: string | null): string | null {
    if (!description) return null;
    const match = description.match(/\[plan:([^\]]+)\]/);
    return match ? match[1] : null;
  }

  async execute(): Promise<void> {
    // Route-driven agent
    console.log("[manual-approval] Running...");
  }
}
