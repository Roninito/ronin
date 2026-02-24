# Phase 9: Conditional Branching Guide

Conditional branching enables runtime decision-making in katas. Choose which phase to execute next based on skill output or task variables.

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Kata DSL Syntax](#kata-dsl-syntax)
4. [Condition Types](#condition-types)
5. [Logical Operators](#logical-operators)
6. [API Reference](#api-reference)
7. [Real-World Examples](#real-world-examples)
8. [Best Practices](#best-practices)

---

## Overview

**Problem:** What if the next phase depends on the result of the previous phase?

**Solution:** Conditional branching allows if/else logic:

```
phase check_risk
run skill risk.assess
if risk_level == "high"
  next escalate
else
  next approve
```

### Key Capabilities

✅ **Simple Conditions** - Compare variables to values
✅ **Complex Conditions** - AND/OR combinations
✅ **Multiple Branches** - More than if/else (switch-like)
✅ **Default Branch** - Fallback if no condition matches
✅ **Nested Paths** - Different workflows based on logic

---

## Core Concepts

### Condition

A condition compares a variable to a value:

```
variable operator value
```

**Example:**
```
risk_level == "high"
score >= 80
user.role in ["admin", "moderator"]
status contains "failed"
```

### Condition Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| `==` | Equal | `status == "complete"` |
| `!=` | Not equal | `status != "error"` |
| `>` | Greater than | `score > 80` |
| `>=` | Greater or equal | `score >= 80` |
| `<` | Less than | `count < 10` |
| `<=` | Less or equal | `count <= 10` |
| `in` | In array | `role in ["admin", "user"]` |
| `not_in` | Not in array | `status not_in ["pending", "error"]` |
| `contains` | String/array contains | `tags contains "urgent"` |
| `starts_with` | String starts with | `filename starts_with "report_"` |
| `ends_with` | String ends with | `filename ends_with ".pdf"` |

### Branches

A branch specifies which phase to go to if condition matches:

```
if condition1
  next phase_a
else if condition2
  next phase_b
else
  next phase_default
```

---

## Kata DSL Syntax

### Simple If/Else

```
phase decide
run skill evaluate
if result == "approved"
  next complete
else
  next review
```

### Multiple Branches

```
phase route
run skill categorize
if category == "urgent"
  next handle_urgent
else if category == "important"
  next handle_important
else if category == "normal"
  next queue
else
  next archive
```

### Logical AND

All conditions must be true:

```
phase check_permission
run skill validate
if user.role == "admin" AND environment == "production"
  next execute
else
  next deny
```

### Logical OR

At least one condition must be true:

```
phase evaluate_risk
run skill assess
if risk_score >= 80 OR user.is_admin == false
  next escalate
else
  next approve
```

### Complex Nested Logic

```
phase complex_decision
run skill analyze
if (priority == "high" OR deadline_urgent == true) AND (resources_available == true)
  next fast_track
else if priority == "high" OR deadline_urgent == true
  next queue_priority
else
  next standard_queue
```

### Complete Example

```
kata lending.decision v2
requires skill borrower.verify
requires skill credit.check
requires skill fraud.detect
requires skill approval.decide

initial verify

phase verify
run skill borrower.verify
next credit_check

phase credit_check
run skill credit.check
if credit_score >= 700
  next fraud_check
else
  next decline

phase fraud_check
run skill fraud.detect
if fraud_risk == "high"
  next review
else
  next approval

phase approval
run skill approval.decide
if recommendation == "approve"
  next create_account
else
  next collect_documents

phase create_account
run skill account.create
complete

phase collect_documents
run skill document.request
complete

phase review
run skill manager.review
complete

phase decline
run skill customer.notify
complete
```

---

## Condition Types

### Variable Reference

Access from task variables (including skill outputs):

```
if status == "complete"  # Direct variable
if user.role == "admin"  # Nested object
if results.chunk1.count >= 100  # Deep nesting
```

### Supported Value Types

**String:**
```
if status == "pending"
if name starts_with "Report_"
```

**Number:**
```
if score >= 80
if count < 10
```

**Boolean:**
```
if is_approved == true
if has_errors == false
```

**Array (for `in` operator):**
```
if status in ["pending", "approved", "rejected"]
if role not_in ["user", "guest"]
```

**Null:**
```
if result == null
if error != null
```

### Deep Variable Access

Use dot notation to access nested properties:

```
if user.profile.tier == "premium"
if request.headers.content_type contains "json"
if parallel_results.chunk1.status == "complete"
```

---

## Logical Operators

### AND (All conditions must be true)

```
if condition1 AND condition2 AND condition3
  next success
```

**Example:**
```
if environment == "production" AND user.role == "admin" AND feature_flag == true
  next deploy
else
  next test
```

### OR (At least one must be true)

```
if condition1 OR condition2 OR condition3
  next action
```

**Example:**
```
if priority == "critical" OR user.is_vip == true OR deadline_today == true
  next fast_track
else
  next normal
```

### Grouping (Parentheses)

Control evaluation order:

```
if (condition1 OR condition2) AND condition3
  next branch_a

if condition1 OR (condition2 AND condition3)
  next branch_b
```

**Example:**
```
if (risk_score >= 80 OR has_previous_incidents == true) AND is_verified == true
  next escalate
else
  next approve
```

---

## API Reference

### ConditionParser

```typescript
const condition = ConditionParser.parseCondition("risk_level == high");
// Returns: { variable: "risk_level", operator: "==", value: "high" }
```

### evaluateCondition

```typescript
import { evaluateCondition } from "src/kata/conditions.js";

const result = evaluateCondition(
  { variable: "status", operator: "==", value: "complete" },
  { status: "complete", ... }
);
// Returns: true
```

### evaluateConditionalBranch

```typescript
import { evaluateConditionalBranch } from "src/kata/conditions.js";

const nextPhase = evaluateConditionalBranch(
  {
    branches: [
      { condition: { variable: "status", operator: "==", value: "high" }, next: "escalate" },
      { condition: { variable: "status", operator: "==", value: "low" }, next: "queue" }
    ],
    defaultNext: "pending"
  },
  { status: "high" }
);
// Returns: "escalate"
```

### Condition Creation Helpers

```typescript
import {
  createCondition,
  createAndGroup,
  createOrGroup
} from "src/kata/conditions.js";

const cond = createCondition("score", ">=", 80);
const andGroup = createAndGroup([cond1, cond2]);
const orGroup = createOrGroup([cond1, cond2]);
```

---

## Real-World Examples

### Example 1: Loan Approval

```
kata lending.decision v1
requires skill verify.identity
requires skill check.credit
requires skill assess.risk
requires skill generate.offer

initial verify

phase verify
run skill verify.identity
if verified == true
  next credit
else
  next reject_identity

phase credit
run skill check.credit
if credit_score >= 700
  next risk
else if credit_score >= 600
  next risk_moderate
else
  next reject_credit

phase risk
run skill assess.risk
if risk_level == "low"
  next offer
else
  next risk_review

phase risk_moderate
run skill assess.risk
if risk_level == "low" OR risk_level == "medium"
  next offer_adjusted
else
  next risk_review

phase offer
run skill generate.offer
complete

phase offer_adjusted
run skill generate.offer
complete

phase risk_review
run skill manager.review
complete

phase reject_identity
run skill notify_applicant
complete

phase reject_credit
run skill notify_applicant
complete
```

### Example 2: Content Moderation

```
kata content.moderate v1
requires skill analyze.content
requires skill check.policies
requires skill escalate.urgent

initial analyze

phase analyze
run skill analyze.content
if contains_harmful == true OR flagged_by_ai == true
  next check_policy
else
  next approve_direct

phase check_policy
run skill check.policies
if violates_policy == true
  next escalate
else
  next approve_override

phase escalate
run skill escalate.urgent
complete

phase approve_direct
run skill notify.user
complete

phase approve_override
run skill notify.reviewer
complete
```

### Example 3: Data Pipeline Routing

```
kata data.process v1
requires skill validate.schema
requires skill transform.data
requires skill load.warehouse
requires skill quarantine.invalid

initial validate

phase validate
run skill validate.schema
if valid == true
  next transform
else if fixable == true
  next fix_and_retry
else
  next quarantine

phase transform
run skill transform.data
if row_count >= 1000000
  next load_parallel
else
  next load_sequential

phase load_parallel
spawn parallel fail_continue
  spawn kata load.partition v1 -> part1
  spawn kata load.partition v1 -> part2
  spawn kata load.partition v1 -> part3
join all_completed
complete

phase load_sequential
run skill load.direct
complete

phase fix_and_retry
run skill data.repair
next validate

phase quarantine
run skill quarantine.invalid
complete
```

### Example 4: Environment-Based Deployment

```
kata deploy.app v1
requires skill build.artifact
requires skill test.smoke
requires skill deploy.staging
requires skill deploy.production
requires skill notify.team

initial build

phase build
run skill build.artifact
next test

phase test
run skill test.smoke
if tests_passed == true
  next deploy_env
else
  next notify_failure

phase deploy_env
run skill deploy.check_env
if environment == "staging"
  next deploy_staging
else if environment == "production" AND approved == true
  next deploy_production
else
  next notify_blocked

phase deploy_staging
run skill deploy.staging
next notify_success

phase deploy_production
run skill deploy.production
next notify_success

phase notify_success
run skill notify.team
complete

phase notify_failure
run skill notify.team
complete

phase notify_blocked
run skill notify.team
complete
```

---

## Best Practices

### 1. Use Clear Variable Names

```
// Good
if user.is_admin == true AND environment == "production"
  next execute

// Poor
if u == true AND e == "p"
  next execute
```

### 2. Keep Conditions Simple

```
// Good
if score >= 80
  next next_phase

// Complex (avoid if possible)
if (score >= 80 AND previous_score >= 75) OR (is_retake == true AND score >= 70) OR (is_recovery == true AND score >= 60)
  next next_phase
```

**Instead: Simplify with intermediate skills**
```
phase evaluate
run skill calculate_final_score  # Returns: should_pass (true/false)
if should_pass == true
  next next_phase
else
  next retry
```

### 3. Provide Default Path

Always include `else` or default branch:

```
// Good
if priority == "high"
  next fast_track
else
  next normal_queue

// Risky (what if neither matches?)
if priority == "high"
  next fast_track
```

### 4. Document Complex Logic

```
phase evaluate_loan
run skill assess

# Branch 1: Excellent credit + no risk = fast approve
if credit_score >= 750 AND risk_level == "low"
  next fast_approve

# Branch 2: Good credit but some risk = review needed
else if credit_score >= 650 AND risk_level == "medium"
  next review

# Branch 3: Default = deny
else
  next decline
```

### 5. Use AND for Multiple Requirements

```
// Good: Both conditions required
if role == "admin" AND environment == "production"
  next execute

// Confusing: Not clear it's AND
if role == "admin"
  if environment == "production"
    next execute
```

### 6. Test Edge Cases

```
# What if variable doesn't exist? (returns undefined, fails comparison)
# What if value is null? (returns false, goes to else)
# What if string case doesn't match? (case-sensitive, goes to else)

# Always handle these in your next phases
if status == "COMPLETE"  # Case matters!
  next success
else
  next retry
```

---

## Performance Considerations

### Condition Evaluation

Each condition is evaluated in order:

```
if condition1 OR condition2 OR condition3  # Stops at first true
  next action

# If condition1 is true, condition2 and condition3 not evaluated (short-circuit)
```

### Best Practice: Order Conditions by Likelihood

```
// Good: Most likely first
if status == "complete" OR status == "error" OR status == "pending"
  next log_result

// Poor: Least likely first
if status == "pending" OR status == "error" OR status == "complete"
  next log_result
```

---

## Limitations & Future Work

### Current Limitations

- Conditions evaluated once per phase (no continuous monitoring)
- No arithmetic expressions: `if score + bonus >= 100` not supported
- No regex patterns: `if email matches "/.*@gmail.com/"` not supported
- Conditions in phase action only (not in spawn action parameters)

### Phase 10 Enhancements

- Arithmetic expressions: `if score + bonus >= 100`
- Regex patterns: `if email matches ".*@domain.com"`
- Conditional parallel spawning: `spawn parallel if condition`
- Conditional child spawning: `spawn kata ... if condition`

---

## Monitoring & Debugging

### Log Condition Evaluations

```typescript
// In task executor
if (nextPhase !== currentPhase) {
  console.log(`Conditional branch taken: ${currentPhase} → ${nextPhase}`);
  console.log(`Condition variables:`, task.variables);
}
```

### Trace Events

```typescript
api.events.emit("task.condition_evaluated", {
  taskId,
  currentPhase,
  condition,
  result,
  nextPhase
}, "conditional");
```

### Inspect Variables

View task variables to understand condition evaluation:

```json
{
  "status": "complete",
  "risk_level": "high",
  "credit_score": 720,
  "user": {
    "role": "admin",
    "is_verified": true
  }
}
```

---

## Next Steps

**Phase 9 Complete:** Conditional branching is production-ready!

**Future Phases (Phase 10+):**
- Arithmetic expressions in conditions
- Regex pattern matching
- Conditional parallel spawning
- Event-driven task spawning
- State machine visualization

---

*Phase 9: Conditional Branching complete. Ronin workflows now support runtime decision-making based on skill output.*
