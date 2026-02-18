# Event Monitor

The Event Monitor Agent provides comprehensive event tracking and visualization for the Ronin system. It captures all events emitted by agents, stores them with intelligent sampling, and presents them in a timeline UI.

## 🚨 Breaking Change

As of this version, `EventsAPI.emit()` **requires** a source parameter:

```typescript
// BEFORE (no longer works)
this.api.events.emit("PlanProposed", payload);

// AFTER (required)
this.api.events.emit("PlanProposed", payload, "intent-ingress");
```

All existing agents have been updated. When creating new agents, always include the source name.

## Overview

The Event Monitor:
- Captures **all events** automatically (no manual instrumentation needed)
- Stores events in memory with **24-hour retention**
- Applies **sampling** for high-volume event types (>100/hour)
- Provides a **timeline UI** at `/timeline`
- Supports **real-time updates** (30-second auto-refresh)
- Offers **multi-select filters** and **pagination**

## Timeline UI

Access the event timeline at:
```
http://localhost:3000/timeline
```

### Features

**Auto-Refresh**: Updates every 30 seconds with new events highlighted in orange

**Filters**:
- Event Types (multi-select checkbox)
- Sources (multi-select checkbox)
- Time Range (1 hour, 24 hours, 7 days, all time)
- Search (searches type, source, and payload)
- Hide Sampled Events toggle

**Event Display**:
- Timestamp with date
- Event type (bold)
- Source agent
- Sampled indicator (orange badge when applicable)
- Collapsible payload (click to expand)

**Sampled Event Indicators**:
- Dimmed opacity (70%)
- Orange left border
- "SAMPLED" badge
- Tooltip showing sample rate (e.g., "Every 10th event")

**Pagination**: 50 events per page with navigation

## Sampling

When an event type exceeds 100 events per hour, the system automatically samples:
- Only every Nth event is stored (default: every 10th)
- Visual indicators show which events are sampled
- Sampling reduces memory usage during high-traffic periods

### Configuration

```json
{
  "eventMonitor": {
    "enabled": true,
    "retentionHours": 24,
    "maxPayloadSize": 500,
    "autoRefreshSeconds": 30,
    "pageSize": 50,
    "sampling": {
      "enabled": true,
      "thresholdPerHour": 100,
      "rate": 10
    }
  }
}
```

## API Endpoints

### GET /timeline/api/events

Returns events with filtering and pagination.

**Query Parameters:**
- `type` - Filter by event type (can be specified multiple times)
- `source` - Filter by source agent (can be specified multiple times)
- `from` - Start timestamp (ms since epoch)
- `to` - End timestamp (ms since epoch)
- `search` - Search string (matches type, source, payload)
- `hideSampled` - Set to "true" to exclude sampled events
- `page` - Page number (default: 1)
- `limit` - Events per page (max: 100, default: 50)

**Example:**
```bash
# Get all PlanCompleted events from coder-bot
curl "http://localhost:3000/timeline/api/events?type=PlanCompleted&source=coder-bot"

# Search for auth-related events
curl "http://localhost:3000/timeline/api/events?search=auth"

# Get page 2, 25 per page
curl "http://localhost:3000/timeline/api/events?page=2&limit=25"
```

**Response:**
```json
{
  "events": [
    {
      "id": "evt-1707312345678-abc123",
      "timestamp": 1707312345678,
      "type": "PlanCompleted",
      "source": "coder-bot",
      "payload": "{ ... truncated ... }",
      "isSampled": false
    }
  ],
  "total": 156,
  "page": 1,
  "pages": 4,
  "allTypes": ["PlanProposed", "PlanCompleted", "TaskMoved"],
  "allSources": ["coder-bot", "todo", "intent-ingress"],
  "sampling": ["TaskMoved"]
}
```

## Event Storage

Events are stored in agent memory with this structure:

```typescript
// Events indexed by ID
{
  "event_monitor_events": {
    "evt-123": {
      "id": "evt-123",
      "timestamp": 1707312345678,
      "type": "PlanCompleted",
      "source": "coder-bot",
      "payload": "{ ... }",
      "isSampled": false
    }
  },
  
  // Index by type for efficient filtering
  "event_monitor_index": {
    "PlanCompleted": ["evt-123", "evt-124"],
    "TaskMoved": ["evt-125"]
  },
  
  // Metadata
  "event_monitor_meta": {
    "totalCount": 156,
    "lastCleanup": 1707312000000,
    "samplingActive": ["TaskMoved"]
  }
}
```

**Payload Truncation**: Payloads are truncated to 500 characters by default to save memory.

## Cleanup

Old events are automatically cleaned up every hour (via cron schedule). Events older than 24 hours are removed.

Manual cleanup can be triggered by running the agent:
```bash
bun run ronin run event-monitor
```

## Performance Considerations

**Memory Usage**:
- Each event ~1-2KB (with truncated payload)
- 1000 events ≈ 1-2MB
- 24h retention at high volume: 10-50MB typical

**Sampling Impact**:
- When sampling kicks in, only 10% of events stored
- Reduces memory by ~90% during high-traffic periods
- Visual indicators ensure you know sampling is active

**Query Performance**:
- Indexed by type for fast filtering
- Pagination prevents large result sets
- Sort by timestamp (newest first)

## Troubleshooting

### No events appearing
1. Check that agents are emitting events with source parameter
2. Verify event-monitor agent is running
3. Check browser console for JavaScript errors

### Too many sampled events
1. Increase threshold in config: `sampling.thresholdPerHour`
2. Decrease sample rate: `sampling.rate` (e.g., 5 = every 5th)
3. Or disable sampling: `sampling.enabled: false`

### Memory usage too high
1. Decrease retention: `retentionHours: 12`
2. Decrease payload size: `maxPayloadSize: 250`
3. Lower sampling threshold for earlier sampling

### Missing historical events
- Events older than 24h are automatically deleted
- To keep longer, increase `retentionHours` (not recommended for high volume)
- Consider exporting events periodically if needed

## Migration Guide

### For Agent Developers

When creating new agents, always pass source to emit():

```typescript
// In your-agent.ts
export default class YourAgent extends BaseAgent {
  async someMethod() {
    // Emit event with source
    this.api.events.emit(
      "YourEvent", 
      { data: "value" }, 
      "your-agent"  // Source name (match file name)
    );
  }
}
```

Source naming convention: Use the agent file name without `.ts` extension.

### For Existing Installations

All built-in agents have been updated. Custom agents need to be updated:

1. Find all `emit()` calls in your agents
2. Add source parameter as third argument
3. Use descriptive source names

## Best Practices

1. **Always include source**: Makes debugging much easier
2. **Use descriptive source names**: Match agent file names
3. **Check timeline regularly**: Helps debug event flow issues
4. **Monitor sampling indicators**: Know when sampling is active
5. **Use filters**: Narrow down to relevant events
6. **Search effectively**: Search terms match payloads too

## See Also

- [Plan Workflow](PLAN_WORKFLOW.md) - Event-driven architecture
- [CLI Integration](CLI_INTEGRATION.md) - CLI tool execution
- [Plan Workflow](PLAN_WORKFLOW.md) - Kanban board with event integration
