import type { ToolDefinition, ToolContext, ToolResult } from "../types.js";
import type { AgentAPI } from "../../types/index.js";

/**
 * Local Tools Registry
 * 
 * Built-in tools that run locally without external APIs
 */
export function registerLocalTools(api: AgentAPI, register: (tool: ToolDefinition) => void): void {
  
  // 1. Memory Search Tool
  register({
    name: "local.memory.search",
    description: "Search Ronin's memory for relevant information",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", default: 5, description: "Maximum results" },
      },
      required: ["query"],
    },
    provider: "local",
    handler: async (args: { query: string; limit?: number }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const results = await api.memory.search(args.query, args.limit || 5);
        return {
          success: true,
          data: { results },
          metadata: {
            toolName: "local.memory.search",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Search failed",
          metadata: {
            toolName: "local.memory.search",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: true,
    ttl: 300,
    riskLevel: "low",
  });

  // 2. File Read Tool
  register({
    name: "local.file.read",
    description: "Read a file from the filesystem",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        encoding: { type: "string", enum: ["utf8", "base64"], default: "utf8" },
      },
      required: ["path"],
    },
    provider: "local",
    handler: async (args: { path: string; encoding?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const content = await api.files.read(args.path);
        return {
          success: true,
          data: { content, path: args.path },
          metadata: {
            toolName: "local.file.read",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "File read failed",
          metadata: {
            toolName: "local.file.read",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: true,
    ttl: 60,
    riskLevel: "medium",
  });

  // 3. File List Tool
  register({
    name: "local.file.list",
    description: "List files in a directory",
    parameters: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Directory path" },
        pattern: { type: "string", description: "Glob pattern (optional)" },
      },
      required: ["directory"],
    },
    provider: "local",
    handler: async (args: { directory: string; pattern?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const files = await api.files.list(args.directory, args.pattern);
        return {
          success: true,
          data: { files, directory: args.directory },
          metadata: {
            toolName: "local.file.list",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "File listing failed",
          metadata: {
            toolName: "local.file.list",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: true,
    ttl: 30,
    riskLevel: "low",
  });

  // 4. Shell Command Tool (restricted)
  register({
    name: "local.shell.safe",
    description: "Execute safe shell commands (read-only operations)",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command" },
        cwd: { type: "string", description: "Working directory" },
      },
      required: ["command"],
    },
    provider: "local",
    handler: async (args: { command: string; cwd?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      
      // Whitelist of safe commands
      const safeCommands = ['ls', 'cat', 'head', 'tail', 'echo', 'pwd', 'git status', 'git log', 'git diff', 'find', 'grep'];
      const baseCmd = args.command.split(' ')[0];
      
      if (!safeCommands.includes(baseCmd)) {
        return {
          success: false,
          data: null,
          error: `Command '${baseCmd}' is not in the safe commands list`,
          metadata: {
            toolName: "local.shell.safe",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
      
      try {
        // Use exec from child_process
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        const { stdout, stderr } = await execAsync(args.command, {
          cwd: args.cwd,
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        });
        
        return {
          success: true,
          data: { stdout, stderr },
          metadata: {
            toolName: "local.shell.safe",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Command failed",
          metadata: {
            toolName: "local.shell.safe",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: false,
    riskLevel: "medium",
  });

  // 5. HTTP Request Tool
  register({
    name: "local.http.request",
    description: "Make HTTP requests to external APIs",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Request URL" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"], default: "GET" },
        headers: { type: "object", description: "Request headers" },
        body: { type: "string", description: "Request body" },
      },
      required: ["url"],
    },
    provider: "local",
    handler: async (args: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const response = await fetch(args.url, {
          method: args.method || "GET",
          headers: args.headers,
          body: args.body,
        });
        
        const contentType = response.headers.get("content-type");
        let data: any;
        
        if (contentType?.includes("application/json")) {
          data = await response.json();
        } else {
          data = await response.text();
        }
        
        return {
          success: response.ok,
          data: {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            data,
          },
          metadata: {
            toolName: "local.http.request",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Request failed",
          metadata: {
            toolName: "local.http.request",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: true,
    ttl: 60,
    riskLevel: "low",
  });

  // 6. Reasoning Tool (uses local Ollama)
  register({
    name: "local.reasoning",
    description: "Perform reasoning using the local Ollama model",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Reasoning prompt" },
        context: { type: "string", description: "Additional context" },
      },
      required: ["prompt"],
    },
    provider: "local",
    handler: async (args: { prompt: string; context?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        const fullPrompt = args.context 
          ? `Context: ${args.context}\n\nTask: ${args.prompt}`
          : args.prompt;
        
        const response = await api.ai.complete(fullPrompt, {
          maxTokens: 2000,
          temperature: 0.7,
        });
        
        return {
          success: true,
          data: { response: response.content },
          metadata: {
            toolName: "local.reasoning",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Reasoning failed",
          metadata: {
            toolName: "local.reasoning",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
    },
    cacheable: true,
    ttl: 300,
    riskLevel: "low",
  });

  console.log("[LocalTools] Registered 6 local tools");
}
