# Trading Chain State

> Shared, human-visible state for portfolio kata personas.
> Newest run should be inserted at the top.

## Run Metadata
- Run ID: `pending`
- Timestamp: `pending`
- Mode: `paper`
- Dry Run: `true`
- Approval Required: `true`
- Approval Event: `portfolio.trading.approved`

---

## Persona: Market Sensor
**Prompt focus:** Fetch account/positions/orders and summarize current state.

### Inputs observed
- Account snapshot:
- Open positions:
- Recent orders:
- Notable market context:

### Output
- State summary:
- Risks spotted:
- Data quality notes:

```json
{
  "account": {},
  "positions": [],
  "orders": [],
  "notes": []
}
```

---

## Persona: Allocation Planner
**Prompt focus:** Propose target actions (hold/buy/sell/close) from current state + rules.

### Inputs observed
- Ruleset version:
- Universe:
- Position limits:

### Proposed actions
- Action list:
- Reasoning:
- Confidence:

```json
{
  "proposedActions": [],
  "rationale": [],
  "confidence": 0
}
```

---

## Persona: Risk Officer
**Prompt focus:** Validate proposed actions against guardrails and block unsafe trades.

### Checks
- Max position notional:
- Daily notional cap:
- Symbol allowlist:
- Mode constraints:

### Decision
- Status: `approved | blocked | revise`
- Block reasons:
- Required edits:

```json
{
  "status": "blocked",
  "violations": [],
  "requiredEdits": []
}
```

---

## Persona: Execution Trader
**Prompt focus:** Wait for user approval, then execute approved actions only.

### Approval
- Requested at:
- Approved by:
- Event payload:

### Execution result
- Placed:
- Skipped:
- Failed:

```json
{
  "approval": {
    "received": false,
    "event": "portfolio.trading.approved",
    "payload": {}
  },
  "execution": {
    "placed": [],
    "skipped": [],
    "failed": []
  }
}
```

---

## Persona: Portfolio Scribe
**Prompt focus:** Persist final run summary and next actions.

### Final summary
- Portfolio impact:
- Orders submitted:
- Outstanding issues:
- Next run recommendations:

```json
{
  "impact": {},
  "ordersSubmitted": [],
  "issues": [],
  "nextActions": []
}
```

