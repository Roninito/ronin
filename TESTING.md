# Testing Guide

## AI Features

### Create Agent with AI

Use AI to interactively create new agents:

```bash
# Interactive mode - AI will ask questions
bun run ronin create agent

# With initial description
bun run ronin create agent "backup database daily"

# Direct creation (skip preview)
bun run ronin create agent "monitor files" --no-preview

# Create and open in editor
bun run ronin create agent "process images" --edit
```

### Ask Questions About Ronin

Get help understanding how Ronin works:

```bash
# Single question
bun run ronin ask "how do plugins work?"
bun run ronin ask "what agents are loaded?"

# Interactive chat mode
bun run ronin ask

# Show source references
bun run ronin ask "explain the memory system" --sources
```

## Quick Start Testing

### 1. Run a Single Agent Manually (Recommended for Testing)

This is the easiest way to test and see output:

```bash
# Run the example agent
bun run ronin run example-agent

# Run the tool-calling agent
bun run ronin run tool-calling-agent

# Run the test agent (no Ollama required)
bun run ronin run test-agent
```

**What you'll see:**
- Agent execution logs
- AI responses (if Ollama is running)
- Plugin calls and results
- Memory operations
- File operations

### 2. Test Plugins Directly

You can test plugins by creating a simple test agent:

```typescript
// agents/test-plugin.ts
import { BaseAgent } from "@ronin/agent/index.js";
import type { AgentAPI } from "@ronin/types/index.js";

export default class TestPluginAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
  }

  async execute(): Promise<void> {
    // Test git plugin (using direct API)
    const gitStatus = await this.api.git?.status();
    console.log("Git Status:", gitStatus);

    // Test shell plugin (using direct API)
    const cwd = await this.api.shell?.cwd();
    console.log("Current Directory:", cwd);

    // Test shell exec
    const result = await this.api.shell?.exec("echo", ["Hello from shell!"]);
    console.log("Shell output:", result?.stdout);

    // Test memory
    await this.api.memory.store("test", "Hello from agent!");
    const value = await this.api.memory.retrieve("test");
    console.log("Memory Value:", value);

    // You can still use the generic API for any plugin
    // const customResult = await this.api.plugins.call("custom-plugin", "method");
  }
}
```

Then run it:
```bash
bun run ronin run test-plugin
```

### 3. Start the Full System

This schedules all agents and keeps running:

```bash
bun run ronin start
```

**What happens:**
- All agents are discovered and loaded
- Scheduled agents are registered (cron jobs)
- System keeps running to maintain schedules
- Press Ctrl+C to stop

**Output:**
- Plugin loading messages
- Agent registration messages
- Agent execution logs (when scheduled)
- Status information

### 4. Check Status

See what's running:

```bash
bun run ronin status
```

### 5. List Everything

```bash
# List agents
bun run ronin list

# List plugins
bun run ronin plugins list

# Plugin details
bun run ronin plugins info git
```

## Testing Scenarios

### Test Without Ollama

If Ollama isn't running, agents will still work but AI calls will fail gracefully:

```bash
bun run ronin run example-agent
# You'll see: "Error calling AI: Ollama API error: Not Found"
# But file operations and other features still work
```

### Test With Ollama

1. Start Ollama:
```bash
ollama serve
```

2. Pull the model (if needed):
```bash
ollama pull qwen3:1.7b
```

3. Run an agent:
```bash
bun run ronin run example-agent
```

### Test Tool Calling

The tool-calling agent demonstrates function calling:

```bash
bun run ronin run tool-calling-agent
```

This will:
- Use AI to decide which tools to call
- Execute plugin methods
- Show tool results
- Continue conversation with results

## Expected Output Examples

### Running example-agent:

```
🚀 Running agent: example-agent
🤖 Example agent executing...
AI Response: Hello! How can I help you today?
Package.json size: 494 bytes
✅ Example agent completed
✅ Agent example-agent completed successfully
```

### Running tool-calling-agent:

```
🚀 Running agent: tool-calling-agent
🤖 Tool Calling Agent executing...
AI Response: I'll check the git status for you.
🔧 Executing tool: git_status
✅ Tool result: { clean: true, files: [] }
📝 Follow-up response: The git repository is clean with no uncommitted changes.
✅ Tool Calling Agent completed
```

### Starting the system:

```
🚀 Starting Ronin Agent System...
📁 Agent directory: ./agents
🔍 Discovering agents...
✅ Loaded 1 agent(s)
✅ Loaded 3 plugin(s): git, shell, hyprland
Registered schedule for example-agent: * * * * *

📊 Agent Status:
   Total agents: 1
   Scheduled: 1
   File watchers: 0
   Webhooks: 0

✨ All agents are running. Press Ctrl+C to stop.
```

## Troubleshooting

**No output?**
- Check if agents exist: `bun run ronin list`
- Check if plugins load: `bun run ronin plugins list`

**Agent not found?**
- Make sure agent file is in `agents/` directory
- Check file exports default class
- Verify class extends `BaseAgent`

**Plugin not loading?**
- Check plugin file is in `plugins/` directory
- Verify plugin exports default object with `name`, `description`, `methods`
- Check console for error messages

**AI not working?**
- Ensure Ollama is running: `ollama serve`
- Check model is available: `ollama list`
- Verify OLLAMA_URL environment variable if using custom setup

