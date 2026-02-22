# Messenger Agent Simplification (formerly Intent-Ingress)

**Date:** February 21, 2026  
**Author:** AI Assistant

## Overview

Simplified the Messenger agent (formerly Intent-Ingress) from **2,367 lines → 266 lines** (89% reduction) by removing hardcoded command handlers and using SAR Chain for AI-driven message processing.

## Problem Statement

The original Messenger agent had:
- 20+ hardcoded command handlers (`handleMakeSkill`, `handleCreateAgent`, `handleTask`, etc.)
- Complex command parsing logic with special cases for each command type
- Manual routing decisions instead of AI-driven tool selection
- Repetitive code for Telegram, Discord, and CLI sources
- AI couldn't decide what to do—the code made all decisions

## Solution

Replaced with a **single SAR Chain** that:
1. Receives the user message
2. Lets AI choose tools via function calling
3. Handles chat, skill creation, task creation, etc. uniformly

## Files Modified

### 1. `agents/messenger.ts` (Complete Rewrite)

**Before:** 2,367 lines with 20+ specialized handlers  
**After:** 266 lines with single `processMessage()` method

**Key Changes:**
- Removed all `handle*` methods for specific commands
- Removed command parsing logic (`parseCommand`, `normalizeRequestArgs`, etc.)
- Created single `processMessage()` method using SAR Chain
- Uses middleware stack: logging → ontology resolve → AI tool loop → persistence
- AI decides: chat directly, call `skills.run`, emit events, etc.

**System Prompt (Clean, Tool-Focused):**
```typescript
const SYSTEM_PROMPT = `You are the Messenger - the user's primary interface to Ronin.

**Your Role:**
- For questions, requests, or conversation → Respond directly using your knowledge and tools
- For skill execution → Call \`skills.run\` with the appropriate query and action
- For creating things (skills, agents, tasks) → Emit the appropriate event
- For information lookup → Use \`local.memory.search\` or \`ontology_search\`

**Available Tools:**
- \`skills.run\` - Execute existing AgentSkills
- \`local.memory.search\` - Search stored context
- \`local.file.read\` / \`local.file.list\` - Read files
- \`local.shell.safe\` - Run safe shell commands
- \`ontology_search\` - Find tools, docs, and capabilities

**Event Emission:**
- \`create-skill\` → SkillMaker creates a new AgentSkill
- \`create-agent\` → AgentBuilder creates a new agent
- \`plan-proposed\` → Propose a task/plan for approval
`;
```

### 2. `agents/telegram_subscription.ts` (Minor Updates)

**Changes:**
- Added `setupRealTimeHandler()` method for future real-time support
- Added event emission for incoming messages (for other agents to consume)
- Maintains backward compatibility with polling-based approach

**Code Added:**
```typescript
// Emit event for other agents (e.g., messenger) to handle
this.api.events.emit(
  "telegram.message",
  {
    botId: this.botId,
    message: { /* message data */ },
    update_id: update.update_id,
  },
  "telegram-subscription"
);
```

### 3. `src/api/ai.ts` (Smart Model Fix)

**Problem:** Smart model tier only worked with separate cloud URL  
**Fix:** Allow local models to be used for smart tier

**Before:**
```typescript
if (aiConfig?.provider === "ollama" && smartUrl && aiConfig.models?.smart) {
  // Only created smart provider if ollamaSmartUrl was set
}
```

**After:**
```typescript
if (aiConfig?.provider === "ollama" && smartModel) {
  const effectiveSmartUrl = smartUrl || baseUrl; // Use cloud URL if set, otherwise local
  this.smartProvider = new OllamaProvider(
    effectiveSmartUrl,
    smartModel,  // Now works with local models like cogito:8b
    ...
  );
}
```

### 4. `agents/messenger.ts` (Rephrasing Fix)

**Problem:** Rephrasing transformed requests into structured format that confused skill-maker  
**Fix:** Skip rephrasing for make-skill commands

**Code Added:**
```typescript
private async rephraseRequestForCommand(original: string, command: string): Promise<string> {
  const trimmed = original.trim();
  if (!trimmed) return trimmed;
  
  // For make-skill, keep natural language - structured output confuses SkillMaker
  if (command === "make-skill") {
    return trimmed;
  }
  // ... rest of rephrasing logic
}
```

## Architecture Comparison

### Before (Hardcoded Routing)
```
User Message → parseCommand() → switch(command) → handleMakeSkill()
                                           → handleCreateAgent()
                                           → handleTask()
                                           → ... (20+ handlers)
```

### After (AI-Driven)
```
User Message → Messenger SAR Chain → AI decides → skills.run
                                                 → emit create-skill
                                                 → local.memory.search
                                                 → respond directly
```

## Benefits

1. **90% Less Code** (2,367 → 266 lines)
2. **AI-Driven Routing** instead of hardcoded if/else
3. **Extensible** - new capabilities via tools, not code changes
4. **Consistent** - all sources (Telegram, Discord, CLI) use same chain
5. **Maintainable** - no special cases to update

## Testing

### Skill Creation
```
User: @ronin make-skill mermaid diagram generator
AI: Calls skill_maker tools → Creates skill.md + scripts/run.ts
```

### Skill Execution
```
User: @ronin create a flowchart for login process
AI: Calls skills.run with query="mermaid-diagram-generator"
```

### Chat
```
User: @ronin how does telegram integration work?
AI: Calls local.memory.search or ontology_search → Responds with answer
```

## Configuration

### Smart Model Setup

Update `~/.ronin/config.json`:
```json
{
  "ai": {
    "models": {
      "smart": "cogito:8b"  // Or other capable model for tool-calling
    },
    "useSmartForTools": true
  }
}
```

Or use cloud models:
```json
{
  "ai": {
    "ollamaSmartUrl": "https://ollama.com",
    "ollamaSmartApiKey": "your-api-key",
    "models": {
      "smart": "gpt-oss:20b-cloud"
    }
  }
}
```

## Migration Notes

### For Existing Skills
No changes required. The new Messenger agent is backward compatible with all existing skills and commands.

### For Custom Commands
If you had custom command handlers, migrate them to:
1. **Skills** - for reusable capabilities (use `skills.run` tool)
2. **Events** - for triggering other agents (emit events)
3. **Tools** - for direct AI tool access

## Future Improvements

1. **Add WhatsApp support** - Extend Messenger to handle WhatsApp messages
2. **Implement semantic caching** for tool results
3. **Add token budget management** for long conversations
4. **Support multi-turn conversations** with session state

## Related Documentation

- [SAR Coding Guide](../docs/SAR%20Coding%20guide%20V1.md)
- [Chain Middleware](../src/middleware/)
- [Tool System](../src/tools/)

## Rollback

To revert to the original implementation:
```bash
git checkout HEAD -- agents/intent-ingress.ts
git checkout HEAD -- agents/telegram_subscription.ts
git checkout HEAD -- src/api/ai.ts
```

Note: The file was renamed from `intent-ingress.ts` to `messenger.ts`. To restore the old version:
```bash
git checkout HEAD -- agents/intent-ingress.ts
mv agents/intent-ingress.ts agents/messenger.ts  # If you want to keep the new name
```
