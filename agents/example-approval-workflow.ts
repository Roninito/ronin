/**
 * Example: Approval Workflow Agent — Phase 10D
 *
 * Demonstrates event-driven workflows with human-in-the-loop approval.
 *
 * Flow:
 * 1. Register approval workflow kata
 * 2. Start task with expense data
 * 3. Task sends notification and waits for approval
 * 4. External system (manager) approves/denies via event
 * 5. Task completes or fails based on decision
 */

import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

export default class ApprovalWorkflowAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    // Register the approval workflow kata
    await this.registerApprovalKata();

    // Start an example task
    await this.startExampleTask();

    // Listen for completion events (for demo)
    this.api.events?.on("task.completed", async (event: any) => {
      if (event.kataName === "expense.approval") {
        console.log("✅ Approval task completed:", event.taskId);
      }
    });

    this.api.events?.on("task.failed", async (event: any) => {
      if (event.kataName === "expense.approval") {
        console.log("❌ Approval task failed:", event.error);
      }
    });
  }

  private async registerApprovalKata(): Promise<void> {
    // Example: Register approval workflow via api.db
    const kataSource = `
kata expense.approval v1
requires skill send.notification
requires skill process.expense
requires skill notify.user

initial request

phase request
  run skill send.notification
  wait event expense.approved timeout 604800
  next check_decision

phase check_decision
  if variables.event_received.approved == true
    next approve_expense
  else
    next deny_expense

phase approve_expense
  run skill process.expense
  run skill notify.user
  complete

phase deny_expense
  run skill notify.user
  complete
`;

    await this.api.memory?.store("approval_workflow_kata", kataSource);
    console.log("✅ Registered approval workflow kata");
  }

  private async startExampleTask(): Promise<void> {
    // Simulate: Start expense approval task
    console.log("\n�� Starting approval workflow example...\n");

    const expenseData = {
      expenseId: "exp_123",
      amount: 500,
      description: "Conference attendance",
      requesterName: "Alice",
      managerId: "mgr_456",
    };

    // In real usage, this would be called by task engine
    // For demo, we'll simulate the flow
    console.log("1️⃣  Task created with expense data:", expenseData);
    console.log("2️⃣  Notification skill would send email to manager");
    console.log("3️⃣  Task enters waiting_for_event state");
    console.log("   └─ Waiting for: expense.approved");
    console.log("   └─ Timeout: 604800 seconds (7 days)\n");

    // Simulate: After a delay, manager approves
    console.log("⏳ Simulating manager approval after 2 seconds...\n");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log("📩 Emitting approval event...");
    this.api.events?.emit(
      "expense.approved",
      {
        expenseId: "exp_123",
        approved: true,
        approverId: "mgr_456",
        approvalReason: "Within budget",
        timestamp: Date.now(),
      },
      "approval-workflow-agent"
    );

    console.log("✅ Approval event emitted\n");
    console.log("4️⃣  Task wakes up from waiting_for_event");
    console.log("   └─ Event data stored in task.variables");
    console.log("   └─ variables.event_received = { approved: true, ... }");
    console.log("5️⃣  Check decision phase evaluates condition");
    console.log("   └─ if variables.event_received.approved == true");
    console.log("6️⃣  Routes to approve_expense phase");
    console.log("   └─ Process expense skill runs");
    console.log("   └─ Notify user skill runs");
    console.log("7️⃣  Task completes\n");
  }

  // Utility: Simulate expense approval from manager
  async approveExpense(expenseId: string, reason: string): Promise<void> {
    this.api.events?.emit(
      "expense.approved",
      {
        expenseId,
        approved: true,
        approverId: "mgr_456",
        approvalReason: reason,
        timestamp: Date.now(),
      },
      "approval-workflow-agent"
    );
    console.log(`✅ Expense ${expenseId} approved: ${reason}`);
  }

  // Utility: Simulate expense denial from manager
  async denyExpense(expenseId: string, reason: string): Promise<void> {
    this.api.events?.emit(
      "expense.approved",
      {
        expenseId,
        approved: false,
        approverId: "mgr_456",
        approvalReason: reason,
        timestamp: Date.now(),
      },
      "approval-workflow-agent"
    );
    console.log(`❌ Expense ${expenseId} denied: ${reason}`);
  }
}
