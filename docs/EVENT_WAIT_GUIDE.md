# Event Wait Guide — Phase 10

**Event Wait** enables workflows to pause execution and wait for external events before continuing. This enables human-in-the-loop automation, event-driven orchestration, and multi-system coordination.

## Quick Start

### Minimal Example

```
kata approval_workflow v1
requires skill send.email

initial submit

phase submit
  run skill send.email
  wait event user.approved
  next process

phase process
  run skill log.decision
  complete
```

**How it works:**
1. Send email notification
2. **Wait** for `user.approved` event (blocks indefinitely)
3. When event arrives, continue to next phase
4. Log the decision

### With Timeout

```
kata approval_workflow v1
requires skill send.email

initial submit

phase submit
  run skill send.email
  wait event user.approved timeout 86400
  next process

phase process
  run skill log.decision
  complete
```

**Difference:** Task fails after 24 hours (86400 seconds) if event doesn't arrive.

---

## Syntax

### Wait Action

```
wait event <event.name>
wait event <event.name> timeout <seconds>
```

**Rules:**
- Must follow a `run skill` or `spawn kata` action in the phase
- Terminal (`next`/`complete`) comes after wait
- Event name is IDENTIFIER (dot-separated: `user.approved`, `webhook.payment`, etc.)
- Timeout is optional; if omitted, waits indefinitely

### Examples

**Simple wait:**
```
phase request
  run skill send.notification
  wait event user.approved
  next process
```

**With timeout (1 hour):**
```
phase request
  run skill send.notification
  wait event user.approved timeout 3600
  next process
```

**With longer timeout (24 hours):**
```
phase request
  run skill send.notification
  wait event user.approved timeout 86400
  next process
```

---

## Event Data Access

When an event arrives, its data is stored in `task.variables`:

```typescript
task.variables = {
  ...previousVariables,
  event_received: event,        // The event payload
  event_timestamp: Date.now(),  // Unix timestamp when event arrived
  event_name: "user.approved"   // Which event triggered
}
```

### Using Event Data in Next Phase

Access via conditional branching (Phase 9):

```
phase submit
  run skill send.email
  wait event approval.decision timeout 3600
  next check_decision

phase check_decision
  if variables.event_received.approved == true
    next approve_request
  else
    next deny_request

phase approve_request
  run skill process.approved
  complete

phase deny_request
  run skill log.denied
  complete
```

**Explanation:**
1. Send email, wait for event
2. Event arrives with `{ approved: true/false }`
3. Check `variables.event_received.approved`
4. Route to approve or deny phase

---

## Emitting Events

### From Agent Code

```typescript
// In an agent
await this.api.events?.emit("user.approved", {
  userId: "u123",
  approved: true,
  timestamp: Date.now(),
});
```

**Flow:**
1. Workflow task waiting for `user.approved`
2. Agent emits event with payload
3. Task wakes up, stores payload in variables
4. Task continues to next phase

### From External System

Use the Ronin HTTP API or webhook listener:

```bash
curl -X POST http://localhost:3000/webhooks/events \
  -H "Content-Type: application/json" \
  -d '{
    "eventName": "payment.completed",
    "payload": { "amount": 100, "transactionId": "tx_123" }
  }'
```

**Event arrives in workflow:**
```
task.variables.event_received = { amount: 100, transactionId: "tx_123" }
```

---

## Use Cases

### 1. Human Approval

```
kata expense_approval v1
requires skill send.email
requires skill process.expense
requires skill notify.manager

initial request

phase request
  run skill send.email         # Send to approver
  wait event expense.approved timeout 604800  # 7 days
  next process

phase process
  if variables.event_received.approved == true
    next approve
  else
    next deny

phase approve
  run skill process.expense
  run skill notify.manager
  complete

phase deny
  run skill notify.manager
  complete
```

**Usage:**
1. Expense submitted → email sent to approver
2. Approver approves/denies (emits event)
3. Workflow continues based on decision

### 2. Webhook Callbacks

```
kata external_processing v1
requires skill call.api
requires skill store.result

initial submit

phase submit
  run skill call.api          # Call external service
  wait event api.callback timeout 1800  # Wait 30 min
  next store

phase store
  run skill store.result      # Store returned data
  complete
```

**Usage:**
1. Call external API (provides callback URL)
2. External system processes, calls webhook
3. Workflow stores result and continues

### 3. Event-Driven Coordination

```
kata order_processing v1
requires skill validate.order
requires skill reserve.inventory
requires skill notify.user

initial validate

phase validate
  run skill validate.order
  next reserve

phase reserve
  run skill reserve.inventory
  wait event inventory.reserved timeout 600  # Wait 10 min
  next notify

phase notify
  run skill notify.user
  complete
```

**Usage:**
1. Validate order
2. Reserve inventory service
3. Wait for inventory reservation confirmation
4. Notify user

### 4. Multi-Step Approval

```
kata contract_signing v1
requires skill send.for.legal
requires skill send.for.finance
requires skill execute.contract

initial legal_review

phase legal_review
  run skill send.for.legal
  wait event contract.legal_approved timeout 604800  # 7 days
  next finance_review

phase finance_review
  run skill send.for.finance
  wait event contract.finance_approved timeout 604800
  next execute

phase execute
  run skill execute.contract
  complete
```

**Usage:**
1. Send to legal review, wait for approval
2. Send to finance review, wait for approval
3. Execute contract

---

## Task States

### State Machine

```
pending
  ↓
running
  ├─ (run skill phase)
  ├─ (spawn kata)
  └─ (wait event) → waiting_for_event ←─┐
                                         │
                      (event arrives) ───┘
                           ↓
                        running (next phase)
                           ↓
                        completed
```

**Task.state values:**
- `pending` - Created, not started
- `running` - Executing a phase
- `waiting_for_event` - Waiting for event (NEW)
- `completed` - All phases done
- `failed` - Phase failed (including timeout)
- `canceled` - Manually canceled

### Checking Task State

```typescript
const task = await engine.getTask(taskId);

if (task.state === "waiting_for_event") {
  console.log("Task is waiting for event:", task.currentPhase);
}

if (task.variables.event_name) {
  console.log("Event received:", task.variables.event_name);
  console.log("Event data:", task.variables.event_received);
}
```

---

## Error Handling

### Timeout Failure

If timeout expires, task fails:

```
phase request
  run skill send.email
  wait event user.approved timeout 3600
  next process
```

If no event arrives within 3600 seconds:
- Task.state → `failed`
- Task.error → `"Timeout waiting for event 'user.approved' after 3600 seconds"`

### No Timeout (Indefinite Wait)

```
phase request
  run skill send.email
  wait event user.approved   # No timeout
  next process
```

Task waits indefinitely until event arrives. Use this for:
- Manual approval (human will eventually approve)
- Event-driven workflows (event will arrive eventually)
- Persistent notifications (system always responds eventually)

---

## Best Practices

### 1. Always Use Timeout for External Events

❌ **Don't:**
```
phase submit
  run skill call.external.api
  wait event external.response
  next process
```

✅ **Do:**
```
phase submit
  run skill call.external.api
  wait event external.response timeout 300  # 5 minutes
  next process
```

**Why:** Prevent indefinite blocking if external system fails.

### 2. Handle Missing Events Gracefully

❌ **Don't:**
```
phase submit
  wait event user.approved timeout 3600
  next always_approved  # Assumes success
```

✅ **Do:**
```
phase submit
  wait event user.approved timeout 3600
  next check_status

phase check_status
  if variables.event_received.approved == true
    next approved
  else
    next denied
```

**Why:** Event data might indicate failure/rejection.

### 3. Emit Events with Consistent Structure

❌ **Don't:**
```typescript
// Sometimes has `approved`, sometimes doesn't
api.events?.emit("user.approved", { result: true });
api.events?.emit("user.approved", { status: "ok" });
```

✅ **Do:**
```typescript
api.events?.emit("user.approved", {
  approved: true,
  userId: user.id,
  timestamp: Date.now(),
  reason: "auto-approved"
});
```

**Why:** Consistent structure makes event data reliable in workflows.

### 4. Log Events for Debugging

```typescript
api.events?.emit("user.approved", {
  approved: true,
  userId: user.id,
  timestamp: Date.now(),
}, "approval-agent");  // source for audit trail
```

---

## Limitations & Future Work

### Current Limitations

- ❌ Single event per phase (future: OR logic for multiple events)
- ❌ No event filtering by payload (future: `wait event if payload.approved`)
- ❌ No event persistence (events lost if system crashes)

### Phase 11+

- ✅ Event filtering: `wait event user.approved if payload.approved == true`
- ✅ Multiple events: `wait event (approval.decision OR timeout.expired)`
- ✅ Event logging: Persist events for replay on crash
- ✅ Event aggregation: `wait for 3 of [approval1, approval2, approval3]`

---

## FAQ

### Q: What happens if task is canceled while waiting?

**A:** Task state becomes `canceled`, event listener is removed. If event arrives after cancellation, it's ignored (task no longer waiting).

### Q: Can I emit same event from multiple sources?

**A:** Yes. First event to arrive wakes the task. Others are ignored (task already moved to next phase).

### Q: What if I emit event before task is waiting?

**A:** Event is lost. Event bus doesn't persist events. Task won't see it (wasn't subscribed yet).

### Q: Can wait phase be followed by another wait?

**A:** Yes, if next phase is a wait:
```
phase first_approval
  wait event user.approval1 timeout 3600
  next second_approval

phase second_approval
  wait event user.approval2 timeout 3600
  next process
```

Waits happen sequentially (one per phase).

### Q: Is there a max timeout value?

**A:** No hard limit. Use reasonable timeouts (seconds). 1 year = 31536000 seconds.

### Q: Can I cancel a waiting task?

**A:** Yes. Call task engine's cancel method (if implemented). Cleans up subscriptions.

---

## Examples

See `agents/example-approval-workflow.ts` for complete working example.

