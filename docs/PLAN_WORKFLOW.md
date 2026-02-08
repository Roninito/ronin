# Event-Sourced Plan Workflow

Ronin implements a clean, event-driven architecture for managing plans and tasks. This workflow decouples intent from execution, making the system composable, observable, and maintainable.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    EVENT BUS                                 │
└─────────────────────────────────────────────────────────────┘
         ↑                ↓                ↓
Intent Ingress    Todo Agent (State)   Observers
(Telegram)        Authority            (Alerts, Logs)
                          ↓
                    Coder Bot
                    (Pure Reactor)
```

## Design Principles

### 1. No Shared State
All communication happens through events. Agents don't share data structures.

### 2. Single State Authority
The Todo Agent is the only entity that mutates task state.

### 3. Pure Reactors
The Coder Bot executes work but never touches state directly.

### 4. Observable Everything
All state transitions emit events that observers can listen to.

## Event Types

### Plan Events
- `PlanProposed` - New plan created
- `PlanApproved` - Plan approved for execution
- `PlanRejected` - Plan rejected
- `PlanBlocked` - Plan blocked (dependencies, etc.)
- `PlanCompleted` - Plan finished successfully
- `PlanFailed` - Plan execution failed

### Task Events
- `TaskCreated` - Task created in kanban
- `TaskMoved` - Task moved between columns
- `TaskRejected` - Task marked as rejected
- `TaskBlocked` - Task marked as blocked

## Agents

### Intent Ingress
Listens for Telegram messages with `#ronin #plan` tags and emits `PlanProposed` events.

**Usage:**
```
Send Telegram message: "#ronin #plan Create user auth system"
```

**Emits:** `PlanProposed`

### Todo Agent (State Authority)
Manages the kanban board. Only agent that mutates task state.

**Listens for:**
- `PlanProposed` → Creates card in "To Do"
- `PlanApproved` → Moves to "Doing"
- `PlanCompleted` → Moves to "Done"
- `PlanRejected` → Adds rejected label
- `PlanBlocked` → Adds blocked label

**Emits:** `TaskCreated`, `TaskMoved`, `TaskBlocked`, `TaskRejected`

**UI:** Available at `/todo`

### Coder Bot (Pure Reactor)
Executes work when plans are approved.

**Listens for:** `PlanApproved`

**Emits:** `PlanCompleted` or `PlanFailed`

**Note:** Currently has placeholder implementation. Replace with actual Cursor/AI integration.

### Manual Approval Agent
Provides API endpoints for manual plan management.

**Endpoints:**
- `GET /api/plans` - List pending plans
- `POST /api/plans/approve` - Approve a plan
- `POST /api/plans/reject` - Reject a plan
- **POST `/api/plans/block`** - Block a plan

**Emits:** `PlanApproved`, `PlanRejected`, `PlanBlocked`

### Alert Observer
Sends Telegram notifications for all plan events.

**Configuration:** Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`

**Listens for:** All plan events

### Log Observer
Logs all events to `~/.ronin/logs/plan-events.log`

**Listens for:** All plan and task events

## Workflow Examples

### Manual Approval Workflow

1. **Create Plan via Telegram:**
   ```
   #ronin #plan Refactor authentication module
   ```

2. **Review in Todo Board:**
   - Visit `/todo`
   - See new card in "To Do"

3. **Approve via API:**
   ```bash
   curl -X POST http://localhost:3000/api/plans/approve \
     -H "Content-Type: application/json" \
     -d '{"planId": "plan-1234567890"}'
   ```

4. **Watch Execution:**
   - Coder Bot receives `PlanApproved`
   - Executes work
   - Emits `PlanCompleted`
   - Todo Agent moves card to "Done"
   - Alert Observer sends notification

### Auto-Approval (Future)
You can add a `ConfidenceGateAgent` that auto-approves plans meeting certain criteria:

```typescript
this.api.events.on("PlanProposed", (plan) => {
  if (plan.confidence > 0.8 && plan.risk === "low") {
    this.api.events.emit("PlanApproved", { id: plan.id });
  }
});
```

### Task Lifecycle Policy (Future)
Add timeouts and retries:

```typescript
this.api.events.on("PlanApproved", (plan) => {
  // Start timeout
  setTimeout(() => {
    this.api.events.emit("PlanBlocked", {
      id: plan.id,
      reason: "Timeout: No completion after 1 hour"
    });
  }, 3600000);
});
```

## API Reference

### Manual Approval API

#### List Pending Plans
```http
GET /api/plans
```

Response:
```json
{
  "plans": [
    {
      "cardId": "card-uuid",
      "planId": "plan-1234567890",
      "title": "Refactor auth",
      "description": "...",
      "labels": ["plan", "telegram"],
      "proposedAt": 1234567890
    }
  ]
}
```

#### Approve Plan
```http
POST /api/plans/approve
Content-Type: application/json

{
  "planId": "plan-1234567890"
}
```

#### Reject Plan
```http
POST /api/plans/reject
Content-Type: application/json

{
  "planId": "plan-1234567890",
  "reason": "Out of scope"
}
```

#### Block Plan
```http
POST /api/plans/block
Content-Type: application/json

{
  "planId": "plan-1234567890",
  "reason": "Waiting for API key"
}
```

## Configuration

### Telegram Bot Setup
1. Create bot with @BotFather
2. Set environment variables:
   ```bash
   export TELEGRAM_BOT_TOKEN="your-token"
   export TELEGRAM_CHAT_ID="your-chat-id"
   ```

### Coder Bot Integration
The Coder Bot has placeholder implementation. To integrate with real execution:

1. **Cursor Integration:**
   ```typescript
   private async executeViaCursor(plan: Plan): Promise<string> {
     const result = await this.api.shell.execAsync(
       `cursor --agent "${plan.description}"`
     );
     return result;
   }
   ```

2. **AI Integration:**
   ```typescript
   private async executeViaAI(plan: Plan): Promise<string> {
     const prompt = `Execute: ${plan.description}`;
     return await this.api.ai.complete(prompt);
   }
   ```

3. **CI/CD Integration:**
   ```typescript
   private async executeViaCI(plan: Plan): Promise<string> {
     await this.api.http.post("https://ci.example.com/run", {
       task: plan.description
     });
     return "CI pipeline triggered";
   }
   ```

## Event Log Format

Events are logged to `~/.ronin/logs/plan-events.log`:

```json
{"timestamp":1707312345678,"eventType":"PlanProposed","payload":{"id":"plan-123","title":"..."},"source":"log-observer"}
{"timestamp":1707312345890,"eventType":"PlanApproved","payload":{"id":"plan-123"},"source":"log-observer"}
{"timestamp":1707312346123,"eventType":"PlanCompleted","payload":{"id":"plan-123","result":"..."},"source":"log-observer"}
```

## Best Practices

1. **Never mutate state directly** - Always emit events
2. **Handle failures gracefully** - Emit `PlanFailed` on errors
3. **Log everything** - Use Log Observer for debugging
4. **Notify stakeholders** - Alert Observer keeps team informed
5. **Start simple** - Manual approval before auto-approval
6. **Test events** - Verify event flow before adding complexity

## Future Enhancements

- **Confidence Gate:** Auto-approve based on confidence scores
- **Task Lifecycle Policy:** Timeouts, auto-retry, escalation
- **Multi-Step Plans:** Break complex plans into subtasks
- **Plan Templates:** Pre-defined plan structures
- **Batch Operations:** Approve/reject multiple plans at once
