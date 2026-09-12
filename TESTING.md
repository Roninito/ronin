# Testing Guide

## AI Features

### Create a Duty with AI

Use AI to interactively create new duties:

```bash
# Interactive mode - AI will ask questions
bun run ronin create duty

# With initial description
bun run ronin create duty "backup database daily"

# Direct creation (skip preview)
bun run ronin create duty "monitor files" --no-preview

# Create and open in editor
bun run ronin create duty "process images" --edit
```

### Ask Questions About Ronin

Get help understanding how Ronin works:

```bash
# Single question
bun run ronin ask "how do plugins work?"
bun run ronin ask "what duties are loaded?"

# Interactive chat mode
bun run ronin ask

# Show source references
bun run ronin ask "explain the memory system" --sources
```

## Quick Start Testing

### 1. Run a Single Duty Manually (Recommended for Testing)

This is the easiest way to test and see output. These three duty files still
carry their pre-rename `*-agent.ts` names (see `ARCHITECTURE.md` §4), so
their duty ids are `example-agent`, `tool-calling-agent`, and `test-agent`:

```bash
# Run the example duty
bun run ronin run example-agent

# Run the tool-calling duty
bun run ronin run tool-calling-agent

# Run the test duty (no Ollama required)
bun run ronin run test-agent
```

**What you'll see:**
- Duty execution logs
- AI responses (if Ollama is running)
- Plugin calls and results
- Memory operations
- File operations

### 2. Test Plugins Directly

You can test plugins by creating a simple test duty:

```typescript
// duties/test-plugin.ts
import { BaseDuty } from "../src/duty/index.js";
import type { DutyAPI } from "../src/types/index.js";

export default class TestPluginDuty extends BaseDuty {
  constructor(api: DutyAPI) {
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
    await this.api.memory.store("test", "Hello from duty!");
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

This schedules all duties and keeps running:

```bash
bun run ronin start
```

**What happens:**
- All duties are discovered and loaded
- Scheduled duties are registered (cron jobs)
- System keeps running to maintain schedules
- Press Ctrl+C to stop

**Output:**
- Plugin loading messages
- Duty registration messages
- Duty execution logs (when scheduled)
- Status information

### 4. Check Status

See what's running:

```bash
bun run ronin status
```

### 5. List Everything

```bash
# List duties
bun run ronin list

# List plugins
bun run ronin plugins list

# Plugin details
bun run ronin plugins info git
```

## Testing Scenarios

### Test Without Ollama

If Ollama isn't running, duties will still work but AI calls will fail gracefully:

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

3. Run a duty:
```bash
bun run ronin run example-agent
```

### Test Tool Calling

The tool-calling duty demonstrates function calling:

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
🚀 Running duty: example-agent
🤖 Example duty executing...
AI Response: Hello! How can I help you today?
Package.json size: 494 bytes
✅ Example duty completed
✅ Duty example-agent completed successfully
```

### Running tool-calling-agent:

```
🚀 Running duty: tool-calling-agent
🤖 Tool Calling Duty executing...
AI Response: I'll check the git status for you.
🔧 Executing tool: git_status
✅ Tool result: { clean: true, files: [] }
📝 Follow-up response: The git repository is clean with no uncommitted changes.
✅ Tool Calling Duty completed
```

### Starting the system:

```
🚀 Starting Ronin...
📁 Duty directory: ./duties
🔍 Discovering duties...
✅ Loaded 1 duty(s)
✅ Loaded 3 plugin(s): git, shell, hyprland
Registered schedule for example-agent: * * * * *

📊 Duty Status:
   Total duties: 1
   Scheduled: 1
   File watchers: 0
   Webhooks: 0

✨ All duties are running. Press Ctrl+C to stop.
```

## Troubleshooting

**No output?**
- Check if duties exist: `bun run ronin list`
- Check if plugins load: `bun run ronin plugins list`

**Duty not found?**
- Make sure the duty file is in the `duties/` directory
- Check file exports default class
- Verify class extends `BaseDuty`

**Plugin not loading?**
- Check plugin file is in `plugins/` directory
- Verify plugin exports default object with `name`, `description`, `methods`
- Check console for error messages

**AI not working?**
- Ensure Ollama is running: `ollama serve`
- Check model is available: `ollama list`
- Verify OLLAMA_URL environment variable if using custom setup
