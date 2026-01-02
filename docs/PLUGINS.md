# Plugin Development Guide

## Overview

Plugins extend Ronin's capabilities by providing reusable functionality that agents can access. Plugins are automatically discovered from the `plugins/` directory and made available to all agents.

## Creating a Plugin

### Using the CLI

The easiest way to create a new plugin is using the CLI:

```bash
ronin create plugin my-plugin
```

This creates a template file at `plugins/my-plugin.ts` with the basic structure.

### Manual Creation

Create a `.ts` file in the `plugins/` directory:

```typescript
import type { Plugin } from "@ronin/plugins/base.js";

const myPlugin: Plugin = {
  name: "my-plugin",
  description: "Description of what this plugin does",
  methods: {
    methodName: async (arg1: string, arg2?: number) => {
      // Implementation
      return { result: "success" };
    },
  },
};

export default myPlugin;
```

## Plugin Structure

### Required Fields

- **`name`**: Unique plugin identifier (lowercase, alphanumeric, hyphens)
- **`description`**: Human-readable description
- **`methods`**: Object containing method functions

### Method Signatures

Methods can be:
- Synchronous: `(args) => value`
- Asynchronous: `async (args) => Promise<value>`
- Accept any number of arguments
- Return any type

## Using Plugins in Agents

### Direct Plugin Calls

```typescript
export default class MyAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Call plugin method directly
    const result = await this.api.plugins.call("git", "status");
    console.log(result);
  }
}
```

### Function Calling with AI

Plugins are automatically available as tools for function calling:

```typescript
export default class MyAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Use AI with plugin tools
    const { toolCalls } = await this.api.ai.callTools(
      "Check git status and commit if there are changes",
      [] // Plugin tools are automatically included
    );

    // Execute tool calls
    for (const toolCall of toolCalls) {
      const [pluginName, methodName] = toolCall.name.split("_");
      const result = await this.api.plugins.call(
        pluginName,
        methodName,
        ...(toolCall.arguments.args || [])
      );
      console.log(result);
    }
  }
}
```

## Built-in Plugins

### Git Plugin

**Methods**:
- `clone(url, dir?)` - Clone a repository
- `status()` - Get git status
- `add(files)` - Stage files
- `commit(message, files?)` - Commit changes
- `push(remote?, branch?)` - Push to remote
- `pull(remote?, branch?)` - Pull from remote
- `branch(name?)` - List or create branches
- `checkout(branch)` - Checkout a branch

**Example**:
```typescript
const status = await this.api.plugins.call("git", "status");
if (!status.clean) {
  await this.api.plugins.call("git", "add", ["."]);
  await this.api.plugins.call("git", "commit", "Auto-commit");
}
```

### Shell Plugin

**Methods**:
- `exec(command, args?, options?)` - Execute shell command
- `execAsync(command, args?, options?)` - Execute with streaming
- `which(command)` - Find command path
- `env()` - Get environment variables
- `cwd()` - Get current working directory

**Example**:
```typescript
const result = await this.api.plugins.call("shell", "exec", "ls", ["-la"]);
console.log(result.stdout);
```

## Best Practices

1. **Error Handling**: Always handle errors in plugin methods
2. **Type Safety**: Use TypeScript types for method parameters
3. **Documentation**: Document what each method does
4. **Idempotency**: Make methods idempotent when possible
5. **Security**: Validate inputs, especially for shell commands

## Plugin Discovery

Plugins are automatically discovered from:
- `plugins/` directory (default)
- Recursive subdirectories
- Files matching `*.ts` or `*.js`
- Excludes test files (`*.test.ts`, `*.spec.ts`)

## Tool Generation

Plugins are automatically converted to Ollama tool definitions:
- Tool name: `{pluginName}_{methodName}`
- Parameters: Generic `args` array (can be enhanced with schema)
- Description: Auto-generated from plugin and method names

## Example: Hyprland Plugin

```typescript
import type { Plugin } from "@ronin/plugins/base.js";
import { readFile, writeFile } from "fs/promises";

const hyprlandPlugin: Plugin = {
  name: "hyprland",
  description: "Manage Hyprland window manager configuration",
  methods: {
    readConfig: async (path?: string) => {
      const configPath = path || "~/.config/hypr/hyprland.conf";
      const content = await readFile(configPath, "utf-8");
      return { content };
    },
    
    writeConfig: async (content: string, path?: string) => {
      const configPath = path || "~/.config/hypr/hyprland.conf";
      await writeFile(configPath, content, "utf-8");
      return { success: true };
    },
    
    reload: async () => {
      const { exec } = await import("@ronin/plugins/shell.js");
      return exec("hyprctl", ["reload"]);
    },
  },
};

export default hyprlandPlugin;
```

## Troubleshooting

**Plugin not loading?**
- Check file is in `plugins/` directory
- Verify default export exists
- Check console for error messages

**Method not found?**
- Verify method name matches exactly
- Check plugin is loaded: `ronin plugins list`

**Tool calling not working?**
- Ensure Ollama supports function calling
- Check tool definitions are generated correctly
- Verify plugin methods are callable

