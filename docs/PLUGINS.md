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
- `api.telegram.*` - Telegram Bot API (initBot, sendMessage, sendPhoto, getUpdates, joinChannel, setWebhook, onMessage, getBotInfo)
- `api.discord.*` - Discord Bot API (initBot, sendMessage, getMessages, onMessage, onReady, joinGuild, getChannel)
- `api.langchain.*` - LangChain integration (runChain, runAgent, buildAgentCreationGraph, runAnalysisChain, buildResearchGraph)
- `api.rag.*` - RAG (Retrieval-Augmented Generation) for document storage, embedding, and semantic search
- `api.email.*` - Email management (addAccount, sendEmail, getInbox, replyToEmail, forwardEmail, deleteEmail, startMonitoring, etc.)

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

For commonly used plugins (`git`, `shell`, `scrape`, `torrent`, `telegram`, `discord`, `langchain`, `rag`), you can use direct API access with full TypeScript support:

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

    // Telegram operations
    const botId = await this.api.telegram?.initBot("YOUR_BOT_TOKEN");
    await this.api.telegram?.sendMessage(botId, "@channel", "Hello!");

    // Discord operations
    const clientId = await this.api.discord?.initBot("YOUR_DISCORD_TOKEN");
    await this.api.discord?.sendMessage(clientId, "channel-id", "Hello!");

    // LangChain operations
    const result = await this.api.langchain?.runChain("Hello {name}!", { name: "World" });

    // RAG operations
    await this.api.rag?.init("my-docs");
    await this.api.rag?.addDocuments("my-docs", [
      { content: "Document content here..." }
    ]);
    const ragResult = await this.api.rag?.query("my-docs", "What is this about?", {}, this.api);
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

Ronin includes 14 built-in plugins:

1. **git** - Git operations
2. **shell** - Shell command execution
3. **scrape** - Web scraping to markdown
4. **torrent** - Torrent search and management
5. **telegram** - Telegram Bot API integration
6. **discord** - Discord Bot API integration
7. **realm** - Peer-to-peer communication
8. **langchain** - LangChain integration for chains, agents, and graphs
9. **rag** - RAG (Retrieval-Augmented Generation) for document storage and semantic search
10. **grok** - Grok (xAI) API integration
11. **gemini** - Google Gemini API integration
12. **hyprland** - Hyprland window manager configuration
13. **web-scraper** - Advanced web scraping (alias for scrape)
14. **email** - Email management with IMAP/SMTP support

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

### Telegram Plugin

**Methods**:
- `initBot(token, options?)` - Initialize a Telegram bot with token
- `sendMessage(botId, chatId, text, options?)` - Send a text message
- `sendPhoto(botId, chatId, photo, caption?)` - Send a photo
- `getUpdates(botId, options?)` - Get recent updates/messages
- `joinChannel(botId, channelId)` - Join a channel or group
- `setWebhook(botId, url)` - Set webhook URL for receiving updates
- `onMessage(botId, callback)` - Register message handler callback
- `getBotInfo(botId)` - Get bot information

**Example (Direct API - Recommended)**:
```typescript
// Initialize bot
const botId = await this.api.telegram?.initBot("YOUR_BOT_TOKEN", {
  webhookUrl: "https://example.com/webhook" // Optional
});

// Send a message
await this.api.telegram?.sendMessage(botId, "@channel", "Hello from Ronin!", {
  parseMode: "Markdown"
});

// Send a photo
await this.api.telegram?.sendPhoto(botId, "@channel", "https://example.com/image.jpg", "Caption");

// Handle incoming messages
this.api.telegram?.onMessage(botId, (update) => {
  if (update.message?.text) {
    console.log("Received:", update.message.text);
  }
});

// Get bot info
const info = await this.api.telegram?.getBotInfo(botId);
console.log(`Bot: @${info?.username}`);
```

### Discord Plugin

**Methods**:
- `initBot(token, options?)` - Initialize a Discord bot client
- `sendMessage(clientId, channelId, content, options?)` - Send a message to a channel
- `getMessages(clientId, channelId, options?)` - Get recent messages from a channel
- `onMessage(clientId, callback)` - Register message event handler
- `onReady(clientId, callback)` - Register ready event handler
- `joinGuild(clientId, inviteCode)` - Get invite information
- `getChannel(clientId, channelId)` - Get channel information

**Example (Direct API - Recommended)**:
```typescript
// Initialize bot
const clientId = await this.api.discord?.initBot("YOUR_DISCORD_TOKEN", {
  intents: [/* custom intents */] // Optional
});

// Send a message
await this.api.discord?.sendMessage(clientId, "channel-id", "Hello from Ronin!", {
  embed: {
    title: "Title",
    description: "Description",
    color: 0x00ff00
  }
});

// Handle incoming messages
this.api.discord?.onMessage(clientId, (message) => {
  console.log(`${message.author.username}: ${message.content}`);
});

// Handle ready event
this.api.discord?.onReady(clientId, () => {
  console.log("Discord bot is ready!");
});

// Get channel info
const channel = await this.api.discord?.getChannel(clientId, "channel-id");
console.log(`Channel: ${channel?.name}`);
```

### LangChain Plugin

**Methods**:
- `runChain(promptTemplate, input, api?)` - Execute a simple LangChain chain
- `runAgent(query, tools?, api?)` - Execute a LangChain agent with tools
- `buildAgentCreationGraph(cancellationToken?, api?)` - Build LangGraph for agent creation workflow
- `runAnalysisChain(input, dataSource?, api?)` - Run analysis chain for chat queries
- `buildResearchGraph(api?)` - Build research graph for multi-step research workflows

**Example (Direct API - Recommended)**:
```typescript
// Run a simple chain
const result = await this.api.langchain?.runChain(
  "Translate '{text}' to {language}",
  { text: "Hello", language: "Spanish" }
);

// Run an agent with tools
const agentResult = await this.api.langchain?.runAgent(
  "Check git status and commit if there are changes",
  [], // Additional tools (Ronin plugins are automatically included)
  this.api
);

// Build agent creation graph
const graph = await this.api.langchain?.buildAgentCreationGraph(
  { isCancelled: false },
  this.api
);
const result = await graph.invoke({ task: "Monitor log files" });

// Run analysis chain
const analysis = await this.api.langchain?.runAnalysisChain(
  "Analyze recent git commits",
  undefined,
  this.api
);

// Build research graph
const researchGraph = await this.api.langchain?.buildResearchGraph(this.api);
const research = await researchGraph.invoke({ query: "Latest AI developments" });
```

### RAG Plugin

**Methods**:
- `init(namespace, options?)` - Initialize a RAG namespace (isolated document collection)
- `addDocuments(namespace, documents, options?)` - Add documents with automatic chunking and embedding
- `query(namespace, query, options?, api?)` - Query with RAG - retrieve context and generate AI response
- `search(namespace, query, limit?, options?)` - Semantic search only (returns matching chunks)
- `removeDocuments(namespace, documentIds)` - Remove documents from the store
- `listDocuments(namespace, limit?)` - List documents in a namespace
- `getStats(namespace)` - Get statistics for a namespace
- `clearNamespace(namespace)` - Clear all documents from a namespace

**Example (Direct API - Recommended)**:
```typescript
// Initialize a namespace
await this.api.rag?.init("my-docs", {
  embeddingModel: "nomic-embed-text",
  chunkSize: 500,
  chunkOverlap: 50,
});

// Add documents
const result = await this.api.rag?.addDocuments("my-docs", [
  { 
    content: "Ronin is an AI agent framework built on Bun.",
    metadata: { source: "docs", date: "2024-01-01" }
  },
  { 
    content: "Agents extend BaseAgent and implement execute().",
    metadata: { source: "docs" }
  },
]);
console.log(`Added ${result.documentIds.length} documents with ${result.chunksCreated} chunks`);

// Query with RAG
const queryResult = await this.api.rag?.query("my-docs", "What is Ronin?", {
  limit: 3,
  temperature: 0.3,
  systemPrompt: "You are a helpful assistant.",
}, this.api);
console.log("Response:", queryResult.response);
console.log("Sources:", queryResult.sources);

// Semantic search without AI generation
const searchResults = await this.api.rag?.search("my-docs", "agent framework", 5);
for (const result of searchResults) {
  console.log(`Score: ${result.score.toFixed(3)} - ${result.chunkText.substring(0, 100)}...`);
}

// Get statistics
const stats = await this.api.rag?.getStats("my-docs");
console.log(`Documents: ${stats.documentCount}, Chunks: ${stats.chunkCount}`);
```

**RagAgent Base Class:**

For structured RAG workflows, extend the `RagAgent` base class:

```typescript
import { RagAgent } from "../agents/rag-agent.js";

export default class MyRagAgent extends RagAgent {
  protected namespace = "my-docs";
  protected documentsPath = "./data/docs";
  protected maxRetrievedDocs = 5;
  static schedule = "0 0 * * *"; // Daily ingestion

  async execute() {
    await this.ingestFromDirectory(this.documentsPath);
  }
}
```

The `RagAgent` base class automatically registers HTTP routes at `/api/rag/{namespace}/*` for query, search, ingest, and stats endpoints.

**Requirements:**
- Ollama must be running with an embedding model pulled (e.g., `ollama pull nomic-embed-text`)
- Set `OLLAMA_EMBEDDING_MODEL` environment variable to use a different model

See [docs/RAG.md](./RAG.md) for complete RAG documentation.

### Email Plugin

**Methods**:
- `addAccount(config)` - Add email account with IMAP/SMTP settings
- `removeAccount(accountId)` - Remove an account
- `listAccounts()` - List all configured accounts (without passwords)
- `getInbox(accountId, options?)` - Fetch emails from inbox
- `getEmail(accountId, messageId)` - Get single email details
- `sendEmail(accountId, to, subject, body, options?)` - Send email via SMTP
- `replyToEmail(accountId, messageId, body, options?)` - Reply to an email
- `forwardEmail(accountId, messageId, to, body?)` - Forward an email
- `deleteEmail(accountId, messageId, options?)` - Delete/trash an email
- `markRead(accountId, messageId)` - Mark email as read
- `markUnread(accountId, messageId)` - Mark email as unread
- `searchEmails(accountId, query, options?)` - Search emails
- `startMonitoring(accountId)` - Start IMAP IDLE monitoring for new emails
- `stopMonitoring(accountId)` - Stop monitoring
- `onNewEmail(accountId, callback)` - Register new email handler
- `listFolders(accountId)` - List folders/mailboxes

**Example (Direct API - Recommended)**:
```typescript
// Add an email account
const account = await this.api.email?.addAccount({
  name: "Work Email",
  email: "user@example.com",
  imap: {
    host: "imap.example.com",
    port: 993,
    secure: true,
    auth: { user: "user@example.com", pass: "password" }
  },
  smtp: {
    host: "smtp.example.com",
    port: 587,
    secure: false,
    auth: { user: "user@example.com", pass: "password" }
  }
});

// Get inbox emails
const emails = await this.api.email?.getInbox(account?.id || "", { limit: 20 });
console.log(`Found ${emails?.length} emails`);

// Send an email
await this.api.email?.sendEmail(
  account?.id || "",
  "recipient@example.com",
  "Hello from Ronin",
  "This is the email body",
  { cc: "cc@example.com" }
);

// Start monitoring for new emails
await this.api.email?.startMonitoring(account?.id || "");

// Register new email handler
this.api.email?.onNewEmail(account?.id || "", (email) => {
  console.log(`New email from ${email.from[0]?.address}: ${email.subject}`);
});

// Reply to an email
await this.api.email?.replyToEmail(
  account?.id || "",
  "message-uid",
  "Thanks for your email!",
  { quote: true }
);

// Search emails
const results = await this.api.email?.searchEmails(
  account?.id || "",
  "important keyword",
  { limit: 10 }
);
```

**Event Integration**:

The email plugin integrates with the Ronin event system. When monitoring is active, other agents can:

1. **Listen for new emails**:
```typescript
this.api.events.on("email:new", (data) => {
  const { accountId, email } = data as any;
  console.log(`New email: ${email.subject}`);
});
```

2. **Send commands to the email agent**:
```typescript
// Send a reply via the email agent
this.api.events.beam("email-manager", "email:command", {
  action: "reply",
  accountId: "account-id",
  messageId: "message-id",
  payload: { body: "Automated reply", quote: true }
});

// Delete an email
this.api.events.beam("email-manager", "email:command", {
  action: "delete",
  accountId: "account-id",
  messageId: "message-id"
});

// Send a new email
this.api.events.beam("email-manager", "email:command", {
  action: "send",
  accountId: "account-id",
  payload: {
    to: "recipient@example.com",
    subject: "Automated email",
    body: "This email was sent by an AI agent"
  }
});
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

