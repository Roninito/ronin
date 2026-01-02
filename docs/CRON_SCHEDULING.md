# Cron Scheduling Guide for Ronin Agents

This guide explains how to schedule agents in Ronin using cron expressions. Cron scheduling allows you to run agents automatically at specific times or intervals.

## Table of Contents

- [Anatomy of a Cron Expression](#anatomy-of-a-cron-expression)
- [Field Reference](#field-reference)
- [Pattern Syntax](#pattern-syntax)
- [Common Examples](#common-examples)
- [How It Works](#how-it-works)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Anatomy of a Cron Expression

A cron expression in Ronin consists of **5 fields** separated by spaces:

```
┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐
│   Minute    │    Hour     │     Day     │    Month    │   Weekday   │
│   (0-59)    │   (0-23)    │   (1-31)    │   (1-12)    │   (0-6)     │
│             │             │             │             │ 0=Sun,6=Sat │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
```

### Visual Breakdown

```
"* * * * *"
 │ │ │ │ │
 │ │ │ │ └─── Weekday (0-6, where 0 = Sunday, 6 = Saturday)
 │ │ │ └───── Month (1-12, where 1 = January, 12 = December)
 │ │ └─────── Day of Month (1-31)
 │ └───────── Hour (0-23, where 0 = midnight, 23 = 11 PM)
 └─────────── Minute (0-59)
```

### Field Reference Table

| Field | Position | Range | Description | Examples |
|-------|----------|-------|-------------|----------|
| **Minute** | 1st | 0-59 | Minute of the hour | `0`, `30`, `*/15` |
| **Hour** | 2nd | 0-23 | Hour of the day (24-hour format) | `0`, `9`, `14`, `*/6` |
| **Day** | 3rd | 1-31 | Day of the month | `1`, `15`, `*` |
| **Month** | 4th | 1-12 | Month of the year | `1`, `6`, `12`, `*` |
| **Weekday** | 5th | 0-6 | Day of the week | `0` (Sun), `5` (Fri), `*` |

**Note:** Weekday uses `0` for Sunday and `6` for Saturday, which differs from some cron implementations that use `7` for Sunday.

---

## Pattern Syntax

Ronin supports three types of patterns in each field:

### 1. Wildcard (`*`)
Matches **every** value in that field.

```typescript
"* * * * *"  // Every minute, every hour, every day, every month, every weekday
```

### 2. Specific Value (`N`)
Matches a **specific** value.

```typescript
"0 9 * * *"  // At 9:00 AM every day
"30 14 * * *"  // At 2:30 PM every day
```

### 3. Interval (`*/N`)
Matches **every N** units, starting from 0.

```typescript
"*/5 * * * *"   // Every 5 minutes
"0 */6 * * *"   // Every 6 hours (at :00 minutes)
"*/15 * * * *"  // Every 15 minutes
```

**Important:** The interval pattern `*/N` works with modulo arithmetic. For example:
- `*/6` in the hour field matches: 0, 6, 12, 18 (every 6 hours)
- `*/5` in the minute field matches: 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55

---

## Common Examples

### Basic Intervals

| Cron Expression | Description | Frequency |
|-----------------|------------|-----------|
| `"* * * * *"` | Every minute | 1,440 times/day |
| `"*/5 * * * *"` | Every 5 minutes | 288 times/day |
| `"*/15 * * * *"` | Every 15 minutes | 96 times/day |
| `"*/30 * * * *"` | Every 30 minutes | 48 times/day |
| `"0 * * * *"` | Every hour (at :00) | 24 times/day |

### Hourly Patterns

| Cron Expression | Description | Example Times |
|----------------|------------|---------------|
| `"0 */1 * * *"` | Every hour at :00 | 00:00, 01:00, 02:00, ... |
| `"0 */2 * * *"` | Every 2 hours | 00:00, 02:00, 04:00, ... |
| `"0 */6 * * *"` | Every 6 hours | 00:00, 06:00, 12:00, 18:00 |
| `"0 */12 * * *"` | Every 12 hours | 00:00, 12:00 |
| `"30 */3 * * *"` | Every 3 hours at :30 | 00:30, 03:30, 06:30, ... |

### Daily Patterns

| Cron Expression | Description | When It Runs |
|----------------|------------|--------------|
| `"0 0 * * *"` | Every day at midnight | 00:00 daily |
| `"0 9 * * *"` | Every day at 9 AM | 09:00 daily |
| `"0 12 * * *"` | Every day at noon | 12:00 daily |
| `"0 18 * * *"` | Every day at 6 PM | 18:00 daily |
| `"30 14 * * *"` | Every day at 2:30 PM | 14:30 daily |

### Weekly Patterns

| Cron Expression | Description | When It Runs |
|----------------|------------|--------------|
| `"0 9 * * 1"` | Every Monday at 9 AM | 09:00 on Mondays |
| `"0 9 * * 5"` | Every Friday at 9 AM | 09:00 on Fridays |
| `"0 9 * * 0"` | Every Sunday at 9 AM | 09:00 on Sundays |
| `"0 9 * * 1-5"` | Every weekday at 9 AM | 09:00 Mon-Fri |
| `"0 10 * * 0,6"` | Every weekend at 10 AM | 10:00 Sat & Sun |

**Note:** Weekday ranges like `1-5` and lists like `0,6` are supported in the current implementation, but the parser may need enhancement for full range/list support.

### Monthly Patterns

| Cron Expression | Description | When It Runs |
|----------------|------------|--------------|
| `"0 0 1 * *"` | First day of every month at midnight | 00:00 on the 1st |
| `"0 9 15 * *"` | 15th of every month at 9 AM | 09:00 on the 15th |
| `"0 0 1 1 *"` | January 1st at midnight | 00:00 on Jan 1st |
| `"0 0 1 */3 *"` | First day of every quarter | 00:00 on 1st of Jan, Apr, Jul, Oct |

### Business Hours Patterns

| Cron Expression | Description | When It Runs |
|----------------|------------|--------------|
| `"0 9 * * 1-5"` | Every weekday at 9 AM | Business hours start |
| `"0 17 * * 1-5"` | Every weekday at 5 PM | Business hours end |
| `"*/30 9-17 * * 1-5"` | Every 30 minutes during business hours | 09:00-17:00, Mon-Fri |

### Complex Examples

| Cron Expression | Description | Use Case |
|----------------|------------|----------|
| `"0 */4 * * *"` | Every 4 hours | Health checks, monitoring |
| `"*/10 9-17 * * 1-5"` | Every 10 minutes during work hours | Active monitoring during business hours |
| `"0 0,12 * * *"` | Twice daily (midnight and noon) | Daily reports |
| `"0 8 * * 1"` | Every Monday at 8 AM | Weekly team updates |
| `"0 0 1,15 * *"` | 1st and 15th of every month | Bi-weekly processing |

---

## How It Works

### Internal Mechanism

Ronin's cron scheduler works as follows:

1. **Registration**: When an agent is registered with a `static schedule` property, the scheduler creates a cron job.

2. **Checking Interval**: The scheduler checks **every minute** (60 seconds) to see if the current time matches the cron expression.

3. **Pattern Matching**: At each check, the `matchesCron()` function compares:
   - Current minute vs. minute pattern
   - Current hour vs. hour pattern
   - Current day vs. day pattern
   - Current month vs. month pattern
   - Current weekday vs. weekday pattern

4. **Execution**: If all fields match, the agent's `execute()` method is called.

### Code Example

```typescript
import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

export default class ScheduledAgent extends BaseAgent {
  // Schedule: Run every 5 minutes
  static schedule = "*/5 * * * *";

  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    console.log("🤖 Scheduled agent executing...");
    // Your agent logic here
  }
}
```

### Execution Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Agent Registration                                      │
│ static schedule = "*/5 * * * *"                        │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│ CronScheduler.schedule()                                │
│ Creates setInterval(check every 60 seconds)            │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
         ┌─────────────────┐
         │ Every 60 seconds│
         └────────┬────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│ matchesCron(cronExpr, new Date())                      │
│ Checks: minute, hour, day, month, weekday              │
└──────────────────┬──────────────────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │                   │
         ▼                   ▼
    ┌────────┐         ┌──────────┐
    │ Match? │  NO     │  Skip    │
    └───┬────┘         └──────────┘
        │ YES
        ▼
┌─────────────────────────────────────────────────────────┐
│ agent.execute()                                         │
│ Your agent code runs                                    │
└─────────────────────────────────────────────────────────┘
```

---

## Best Practices

### 1. Choose Appropriate Intervals

- **High-frequency tasks** (monitoring, health checks): `*/5 * * * *` or `*/10 * * * *`
- **Regular tasks** (data sync, reports): `0 */6 * * *` or `0 0 * * *`
- **Low-frequency tasks** (cleanup, backups): `0 0 * * 0` (weekly) or `0 0 1 * *` (monthly)

### 2. Avoid Over-Scheduling

```typescript
// ❌ BAD: Runs 1,440 times per day (every minute)
static schedule = "* * * * *";

// ✅ GOOD: Runs 4 times per day (every 6 hours)
static schedule = "0 */6 * * *";
```

### 3. Use Specific Times for Important Tasks

```typescript
// ✅ GOOD: Runs at a predictable time
static schedule = "0 9 * * 1-5";  // 9 AM weekdays

// ⚠️ LESS IDEAL: Runs at random times
static schedule = "*/7 * * * *";  // Every 7 minutes (unpredictable)
```

### 4. Consider Timezone Implications

The scheduler uses the **server's local timezone**. If you need UTC or a specific timezone, ensure your server is configured accordingly.

### 5. Handle Errors Gracefully

```typescript
async execute(): Promise<void> {
  try {
    // Your scheduled task
    await this.api.ai.complete("Daily report");
  } catch (error) {
    console.error("Scheduled task failed:", error);
    // Don't throw - let the scheduler continue
  }
}
```

### 6. Test Your Schedule

Before deploying, verify your cron expression:

```typescript
// Test with a short interval first
static schedule = "*/1 * * * *";  // Every minute (for testing)

// Then switch to production schedule
static schedule = "0 */6 * * *";  // Every 6 hours
```

---

## Troubleshooting

### Agent Not Running

**Problem**: Agent with schedule isn't executing.

**Solutions**:
1. Check that `static schedule` is defined correctly
2. Verify the cron expression has exactly 5 fields
3. Ensure the Ronin server is running
4. Check console logs for registration messages: `Registered schedule for AgentName: * * * * *`

### Agent Running Too Frequently

**Problem**: Agent executes more often than expected.

**Solutions**:
1. Verify your cron expression - `*` means "every"
2. Check for multiple registrations of the same agent
3. Review the interval pattern (`*/N`) - ensure N is correct

### Agent Running at Wrong Times

**Problem**: Agent executes at unexpected times.

**Solutions**:
1. Verify timezone settings on your server
2. Check hour field (0-23, not 1-12)
3. Verify weekday numbering (0=Sunday, 6=Saturday)
4. Test with a simple schedule first: `"0 9 * * *"` (9 AM daily)

### Common Mistakes

| Mistake | Incorrect | Correct | Why |
|---------|-----------|---------|-----|
| Missing spaces | `"** * * *"` | `"* * * * *"` | Must have 5 fields |
| Wrong hour format | `"0 9PM * * *"` | `"0 21 * * *"` | Use 24-hour format (0-23) |
| Wrong weekday | `"0 9 * * 7"` | `"0 9 * * 0"` | Sunday is 0, not 7 |
| Month numbering | `"0 0 1 0 *"` | `"0 0 1 1 *"` | Months are 1-12, not 0-11 |

---

## Quick Reference

### Field Positions
```
Position:  1    2    3    4    5
Field:   minute hour day month weekday
Example:  "0"  "9"  "*"  "*"   "1-5"
```

### Pattern Cheat Sheet

| Pattern | Meaning | Example |
|---------|---------|---------|
| `*` | Every value | `"*"` = every minute |
| `N` | Specific value | `"0"` = at :00 |
| `*/N` | Every N units | `"*/5"` = every 5 minutes |

### Common Schedules Cheat Sheet

| Schedule | Description |
|----------|------------|
| `"* * * * *"` | Every minute |
| `"*/5 * * * *"` | Every 5 minutes |
| `"0 * * * *"` | Every hour |
| `"0 */6 * * *"` | Every 6 hours |
| `"0 9 * * *"` | Daily at 9 AM |
| `"0 9 * * 1-5"` | Weekdays at 9 AM |
| `"0 0 * * 0"` | Weekly on Sunday at midnight |
| `"0 0 1 * *"` | Monthly on the 1st at midnight |

---

## Advanced Notes

### Current Limitations

The current Ronin cron implementation:
- ✅ Supports `*`, `*/N`, and specific values
- ✅ Checks every minute for matches
- ⚠️ Does not support ranges (e.g., `1-5`) in all contexts
- ⚠️ Does not support lists (e.g., `1,3,5`) in all contexts
- ⚠️ Does not support step values beyond `*/N`

### Future Enhancements

Potential improvements could include:
- Full range support: `"0 9-17 * * *"` (9 AM to 5 PM)
- List support: `"0 9 * * 1,3,5"` (Mon, Wed, Fri)
- Timezone configuration
- More precise scheduling (calculate next execution time)

---

## See Also

- [AGENTS.md](../AGENTS.md) - General agent documentation
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [Example Agent](../agents/example-agent.ts) - Working example with scheduling

---

**Last Updated**: Based on Ronin v1.0 cron scheduler implementation

