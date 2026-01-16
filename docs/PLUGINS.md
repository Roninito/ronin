# Plugin Development Guide

## Overview

Plugins extend Ronin's capabilities by providing reusable functionality that agents can access. Plugins are automatically discovered from the `plugins/` directory and made available to all agents.

## ✨ Direct API Access

**NEW!** Commonly used plugins now have direct API access with full TypeScript support:

```typescript
// Instead of this:
await this.api.plugins.call("git", "status");

// You can now do this:
await this.api.git?.status();
```

**Available Direct APIs:**
- `api.git.*` - Git operations (init, clone, status, add, commit, push, pull, branch, checkout)
- `api.shell.*` - Shell commands (exec, execAsync, which, env, cwd)
- `api.scrape.*` - Web scraping (scrape_to_markdown)
- `api.torrent.*` - Torrent operations (search, add, list, status, pause, resume, remove)

**Benefits:**
- ✅ Full TypeScript autocomplete and type checking
- ✅ Cleaner, more readable code
- ✅ Better IDE support
- ✅ Compile-time error detection

The generic `api.plugins.call()` method still works for all plugins (including custom ones) for backward compatibility.

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

### ✨ Direct API Access (Recommended)

For commonly used plugins (`git`, `shell`, `scrape`, `torrent`), you can use direct API access with full TypeScript support:

```typescript
export default class MyAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Git operations - clean and type-safe!
    const status = await this.api.git?.status();
    if (!status?.clean) {
      await this.api.git?.add(["."]);
      await this.api.git?.commit("Auto-commit");
    }

    // Shell operations
    const result = await this.api.shell?.exec("ls", ["-la"]);
    const cwd = await this.api.shell?.cwd();

    // Web scraping
    const scraped = await this.api.scrape?.scrape_to_markdown("https://example.com");

    // Torrent operations
    const torrents = await this.api.torrent?.search("ubuntu");
  }
}
```

**Benefits:**
- ✅ Full TypeScript autocomplete and type checking
- ✅ Cleaner, more readable code
- ✅ Better IDE support
- ✅ Compile-time error detection

### Direct Plugin Calls (Backward Compatible)

You can still use the generic plugin API for any plugin:

```typescript
export default class MyAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Call plugin method directly
    const result = await this.api.plugins.call("git", "status");
    console.log(result);
  }
}
```

This method works for all plugins, including custom ones that don't have direct API access.

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

### Torrent Plugin

**Methods**:
- `search(query, options?)` - Search for torrents on 1337x
- `add(magnetOrPath, options?)` - Add and download a torrent
- `list()` - List all active torrents
- `status(infoHash)` - Get status for a specific torrent
- `pause(infoHash)` - Pause a torrent download
- `resume(infoHash)` - Resume a paused torrent
- `remove(infoHash, options?)` - Remove a torrent

**Example (Direct API - Recommended)**:
```typescript
// Search for torrents
const results = await this.api.torrent?.search("ubuntu 24.04", { limit: 10 });
console.log(`Found ${results?.length} torrents`);

// Add a torrent
if (results && results.length > 0) {
  const torrent = await this.api.torrent?.add(results[0].magnet, {
    downloadPath: "./downloads"
  });
  console.log("Downloading:", torrent?.name);

  // Monitor progress
  const status = await this.api.torrent?.status(torrent?.infoHash || "");
  console.log(`Progress: ${status?.progress}%`);
}

// List all active torrents
const active = await this.api.torrent?.list();
console.log(`Active downloads: ${active?.length}`);
```

### Git Plugin

**Methods**:
- `init()` - Initialize a git repository
- `clone(url, dir?)` - Clone a repository
- `status()` - Get git status
- `add(files)` - Stage files
- `commit(message, files?)` - Commit changes
- `push(remote?, branch?)` - Push to remote
- `pull(remote?, branch?)` - Pull from remote
- `branch(name?)` - List or create branches
- `checkout(branch)` - Checkout a branch

**Example (Direct API - Recommended)**:
```typescript
// Clean, type-safe API
const status = await this.api.git?.status();
if (!status?.clean) {
  await this.api.git?.add(["."]);
  await this.api.git?.commit("Auto-commit");
}

// Clone a repository
await this.api.git?.clone("https://github.com/user/repo.git", "repo-dir");

// List branches
const branches = await this.api.git?.branch();
console.log("Available branches:", branches?.branches);
```

**Example (Generic API - Backward Compatible)**:
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
- `execAsync(command, args?, options?)` - Execute with streaming output
- `which(command)` - Find command path
- `env()` - Get environment variables
- `cwd()` - Get current working directory

**Example (Direct API - Recommended)**:
```typescript
// Execute a command
const result = await this.api.shell?.exec("ls", ["-la"]);
console.log(result?.stdout);

// Get current directory
const cwd = await this.api.shell?.cwd();
console.log("Working directory:", cwd);

// Get environment variables
const env = await this.api.shell?.env();
console.log("PATH:", env?.PATH);

// Find command location
const gitPath = await this.api.shell?.which("git");
console.log("Git found at:", gitPath);

// Async execution with streaming
const asyncProc = await this.api.shell?.execAsync("npm", ["install"]);
// ... do other work ...
const output = await asyncProc?.readOutput();
console.log("Install complete:", output?.success);
```

**Example (Generic API - Backward Compatible)**:
```typescript
const result = await this.api.plugins.call("shell", "exec", "ls", ["-la"]);
console.log(result.stdout);
```

## Web Scraper Plugin (`scrape`)

Ronin includes a generic web scraper plugin for fetching a URL and converting HTML into **clean Markdown**.

### Methods

- `scrape_to_markdown(url, options?)`
  - **url**: string
  - **options**: `{ instructions?: string; selector?: string; includeImages?: boolean; timeoutMs?: number; userAgent?: string }`
  - **returns**: `{ url, finalUrl, title?, markdown, images, links }`

### Example: Direct Call from an Agent

**Direct API (Recommended)**:
```typescript
const result = await this.api.scrape?.scrape_to_markdown(
  "https://www.noaa.gov/news-features",
  { instructions: "Extract titles, dates, and links" }
);

console.log(result?.markdown);
console.log("Found images:", result?.images);
console.log("Found links:", result?.links);
```

**Generic API (Backward Compatible)**:
```typescript
const result = await this.api.plugins.call(
  "scrape",
  "scrape_to_markdown",
  "https://www.noaa.gov/news-features",
  { instructions: "Extract titles, dates, and links" }
);

console.log(result.markdown);
```

### Example: Tool Calling

When using `api.ai.callTools(...)`, this plugin becomes available as the tool name:

- `scrape_scrape_to_markdown`

The tool call passes an `args` array under `toolCall.arguments.args`.

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

