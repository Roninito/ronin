# CLI Integration Guide

Ronin integrates with popular AI-powered CLI tools to execute plans automatically based on tags. This enables a seamless workflow from plan creation to code execution.

## Supported CLI Tools

| Tool | Tag | Plugin | Installation |
|------|-----|--------|--------------|
| Qwen Code | `#qwen` | `qwen-cli` | `npm install -g @qwen/cli` |
| Cursor | `#cursor` | `cursor-cli` | Included with Cursor.app |
| Opencode | `#opencode` | `opencode-cli` | `npm install -g opencode` |
| Gemini | `#gemini` | `gemini-cli` | `npm install -g @google/gemini-cli` |

## Tag-Driven Execution

### Execution Tags

**#build** - Triggers CLI execution when plan is approved
```
#ronin #plan #build Create authentication middleware
```

**#auto** - Execute immediately without manual approval
```
#ronin #plan #build #auto Fix typo in README
```

### CLI Selection Tags

**#qwen** - Use Qwen Code CLI (default)
```
#ronin #plan #build Create API endpoint #qwen
```

**#cursor** - Use Cursor CLI
```
#ronin #plan #build Refactor component #cursor
```

**#opencode** - Use Opencode CLI
```
#ronin #plan #build Add logging #opencode
```

**#gemini** - Use Gemini CLI
```
#ronin #plan #build Generate docs #gemini
```

### Workspace Tags

**#app-{name}** - Target specific app/workspace
```
#ronin #plan #build Create user model #qwen #app-backend
#ronin #plan #build Create login form #cursor #app-frontend
```

## Configuration

### Default Settings (~/.ronin/config.json)

```json
{
  "defaultCLI": "qwen",
  "defaultAppsDirectory": "~/.ronin/apps",
  "apps": {
    "backend": "~/projects/api",
    "frontend": "~/projects/web",
    "docs": "~/projects/documentation"
  },
  "cliOptions": {
    "qwen": {
      "model": "qwen3:1.7b",
      "timeout": 300000
    },
    "cursor": {
      "timeout": 60000
    },
    "opencode": {
      "timeout": 120000
    },
    "gemini": {
      "model": "gemini-pro",
      "timeout": 60000
    }
  }
}
```

### App Workspaces

Apps can be configured in three ways:

1. **Config file**: Add to `config.json` apps section
2. **Auto-discovery**: Create directory in `~/.ronin/apps/{app-name}`
3. **Default**: Uses current working directory

## Execution Flow

```
1. Plan Created (Telegram/API)
   └─ Tags parsed: #build, #qwen, #app-backend

2. Manual Approval (or #auto)
   └─ PlanApproved event emitted

3. Coder Bot receives event
   ├─ Checks for #build tag
   ├─ Determines CLI from tags/config
   ├─ Resolves workspace from #app-* tag
   └─ Validates CLI installation

4. Execution
   ├─ PlanInProgress event (starting)
   ├─ CLI command executed
   ├─ PlanInProgress event (executing)
   ├─ Output saved to ~/.ronin/cli/builds/{plan-id}/
   └─ PlanCompleted or PlanFailed event

5. Todo Agent updates board
   ├─ Success: Move to "Done"
   └─ Failure: Move to "Failed" column
```

## Output Storage

All CLI outputs are saved for review:

```
~/.ronin/cli/
├── plans/
│   └── {plan-id}.json          # Plan metadata
├── builds/
│   └── {plan-id}/
│       ├── output.log          # Full CLI output
│       └── result.json         # Execution metadata
└── in-progress/
    └── {plan-id}.log           # Real-time logs
```

## Sequential Execution

Plans with #build tag are executed sequentially to avoid conflicts:

1. Plans are added to execution queue
2. Coder Bot processes one plan at a time
3. Next plan starts only after current completes/fails
4. Progress events emitted during execution

## Progress Events

Monitor execution via events:

```typescript
// Starting
PlanInProgress {
  id: "plan-123",
  status: "starting",
  message: "Initializing CLI execution..."
}

// Executing
PlanInProgress {
  id: "plan-123",
  status: "executing",
  message: "Running qwen CLI...",
  cli: "qwen",
  workspace: "~/.ronin/apps/backend"
}

// Completed
PlanCompleted {
  id: "plan-123",
  result: "...",
  outputPath: "~/.ronin/cli/builds/plan-123/output.log"
}

// Failed
PlanFailed {
  id: "plan-123",
  error: "CLI not installed"
}
```

## Usage Examples

### Basic Build
```
#ronin #plan #build Create user authentication
```
- Uses default CLI (qwen)
- Executes in current directory
- Waits for manual approval

### Specific CLI + App
```
#ronin #plan #build Create React component #cursor #app-frontend
```
- Uses Cursor CLI
- Targets frontend app workspace
- Viewable at `/todo` with badges

### Auto-Execute
```
#ronin #plan #build #auto Fix broken link #qwen
```
- Executes immediately on approval
- No manual start needed
- Good for quick fixes

### Multi-App Workflow
```
# Backend
#ronin #plan #build Create /api/users endpoint #qwen #app-backend

# Frontend
#ronin #plan #build Create user list component #cursor #app-frontend
```
- Two separate cards
- Different CLIs
- Different workspaces
- Sequential execution

## CLI Installation

### Qwen Code
```bash
npm install -g @qwen/cli
# or
pip install qwen-code

# Verify
qwen --version
```

### Cursor
```bash
# Download from https://cursor.com
# Enable CLI in Settings > General

# Or via Homebrew
brew install --cask cursor

# Verify
cursor --version
```

### Opencode
```bash
npm install -g opencode

# Verify
opencode --version
```

### Gemini
```bash
npm install -g @google/gemini-cli

# Set API key
export GEMINI_API_KEY="your-key"
# Get key: https://aistudio.google.com/app/apikey

# Verify
gemini --version
```

## Troubleshooting

### CLI Not Found
Coder Bot checks installations at startup and logs warnings:
```
[coder-bot] ⚠️ qwen not installed
    npm install -g @qwen/cli
```

### Execution Fails
Check logs:
```bash
cat ~/.ronin/cli/builds/{plan-id}/output.log
cat ~/.ronin/cli/builds/{plan-id}/result.json
```

### Wrong Workspace
Verify app configuration:
```bash
bun run ronin config --show
```

Or check `~/.ronin/config.json` apps section.

### Timeout Issues
Increase timeout in config:
```json
{
  "cliOptions": {
    "qwen": {
      "timeout": 600000  // 10 minutes
    }
  }
}
```

## Best Practices

1. **Start with #build**: Always include `#build` tag for execution
2. **Use descriptive titles**: Helps identify plans in kanban
3. **Specify CLI explicitly**: Use tags like `#qwen` or `#cursor` for clarity
4. **Organize apps**: Use `#app-*` tags to keep workspaces organized
5. **Review outputs**: Check `~/.ronin/cli/builds/` for execution details
6. **Monitor queue**: Only one plan executes at a time (sequential)
7. **Use #auto carefully**: Auto-execution skips manual review
8. **Handle failures**: Failed plans move to "Failed" column with logs

## Future Enhancements

- **Parallel execution**: Option to run non-conflicting plans simultaneously
- **Pre-flight checks**: Validate workspace state before execution
- **Rollbacks**: Automatic git commits before execution for easy rollback
- **Dry runs**: Preview what CLI would do without making changes
- **Custom CLI plugins**: Add support for additional CLI tools

## See Also

- [Plan Workflow](PLAN_WORKFLOW.md) - Event-driven architecture overview
- [CLI Tool Documentation](https://cursor.com/docs/cli/overview)
- [Qwen Code](https://github.com/QwenLM/qwen-code)
- [Opencode](https://opencode.ai/docs/cli/)
