/**
 * MCP Client Manager
 *
 * Connects to MCP servers via stdio, lists their tools, and registers them
 * with the ToolRouter. Tools are prefixed with mcp_<server>_ to avoid collisions.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDefinition, ToolContext, ToolResult } from "../tools/types.js";
import type { ToolRouter } from "../tools/ToolRouter.js";
import type { AgentAPI } from "../types/index.js";
import type { MCPConfig, MCPServerConfig } from "../config/types.js";
import { logger } from "../utils/logger.js";

const PREFIX = "mcp_";

export interface ServerConnection {
  serverName: string;
  client: Client;
  transport: StdioClientTransport;
  toolNames: string[]; // mcp_<server>_<tool> names
  error?: string;
}

export class MCPClientManager {
  private toolRouter: ToolRouter;
  private api: AgentAPI;
  private connections: Map<string, ServerConnection> = new Map();

  constructor(toolRouter: ToolRouter, api: AgentAPI) {
    this.toolRouter = toolRouter;
    this.api = api;
  }

  /**
   * Connect to all enabled MCP servers and register their tools
   */
  async connectEnabledServers(mcpConfig: MCPConfig): Promise<void> {
    const servers = mcpConfig?.servers ?? {};
    for (const [name, serverConfig] of Object.entries(servers)) {
      if (!serverConfig.enabled) continue;
      await this.connectServer(name, serverConfig);
    }
  }

  /**
   * Connect to a single MCP server
   */
  async connectServer(serverName: string, config: MCPServerConfig): Promise<void> {
    if (this.connections.has(serverName)) {
      const existing = this.connections.get(serverName)!;
      if (!existing.error) {
        logger.debug(`[MCP] Server ${serverName} already connected`);
        return;
      }
      this.disconnectServer(serverName);
    }

    try {
      let env = config.env ? { ...config.env } : {};
      if (serverName === "brave-search") {
        const apiKey =
          config.env?.BRAVE_API_KEY ??
          process.env.BRAVE_API_KEY ??
          this.api.config.getBraveSearch?.()?.apiKey;
        if (apiKey) {
          env = { ...env, BRAVE_API_KEY: apiKey };
        }
      }

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: Object.keys(env).length > 0 ? env : undefined,
      });

      const client = new Client({
        name: "ronin",
        version: "1.0.0",
      });

      client.onerror = (err) => {
        logger.error(`[MCP] Server ${serverName} error:`, err);
      };

      await client.connect(transport);

      const listResult = await client.listTools();
      const toolNames: string[] = [];

      for (const mcpTool of listResult.tools) {
        const roninName = `${PREFIX}${serverName}_${mcpTool.name}`;
        toolNames.push(roninName);

        const inputSchema = mcpTool.inputSchema ?? {
          type: "object",
          properties: {},
          required: [],
        };

        const toolDef: ToolDefinition = {
          name: roninName,
          description: mcpTool.description ?? `MCP tool ${mcpTool.name}`,
          parameters: inputSchema as ToolDefinition["parameters"],
          provider: `mcp:${serverName}`,
          handler: this.createHandler(serverName, mcpTool.name, client),
          riskLevel: "medium",
          cacheable: false,
        };

        this.toolRouter.register(toolDef);
      }

      this.connections.set(serverName, {
        serverName,
        client,
        transport,
        toolNames,
      });

      logger.info(`[MCP] Connected to ${serverName}, registered ${toolNames.length} tools`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[MCP] Failed to connect to ${serverName}:`, errMsg);
      this.connections.set(serverName, {
        serverName,
        client: null as any,
        transport: null as any,
        toolNames: [],
        error: errMsg,
      });
    }
  }

  private createHandler(
    serverName: string,
    mcpToolName: string,
    client: Client
  ): ToolDefinition["handler"] {
    return async (args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> => {
      const startTime = Date.now();
      const callId = `mcp-${serverName}-${Date.now()}`;

      try {
        const result = await client.callTool({
          name: mcpToolName,
          arguments: args ?? {},
        });

        if (result.isError) {
          return {
            success: false,
            data: null,
            error: result.content?.[0]?.type === "text" ? result.content[0].text : String(result),
            metadata: {
              toolName: `${PREFIX}${serverName}_${mcpToolName}`,
              provider: `mcp:${serverName}`,
              duration: Date.now() - startTime,
              cached: false,
              timestamp: Date.now(),
              callId,
            },
          };
        }

        const content = result.content ?? [];
        const textParts: string[] = [];
        const data: Record<string, unknown> = { raw: [] };

        for (const item of content) {
          if (item.type === "text") {
            textParts.push(item.text);
          }
          (data.raw as unknown[]).push(item);
        }

        return {
          success: true,
          data: {
            text: textParts.join("\n"),
            ...data,
          },
          metadata: {
            toolName: `${PREFIX}${serverName}_${mcpToolName}`,
            provider: `mcp:${serverName}`,
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId,
          },
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          data: null,
          error: errMsg,
          metadata: {
            toolName: `${PREFIX}${serverName}_${mcpToolName}`,
            provider: `mcp:${serverName}`,
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId,
          },
        };
      }
    };
  }

  /**
   * Disconnect from a server and unregister its tools
   */
  async disconnectServer(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) return;

    for (const toolName of conn.toolNames) {
      this.toolRouter.unregister(toolName);
    }

    try {
      if (conn.transport && typeof conn.transport.close === "function") {
        await conn.transport.close();
      }
    } catch (err) {
      logger.warn(`[MCP] Error closing transport for ${serverName}:`, err);
    }

    this.connections.delete(serverName);
    logger.info(`[MCP] Disconnected from ${serverName}`);
  }

  /**
   * Get status of all server connections
   */
  getStatus(): { serverName: string; connected: boolean; toolCount: number; error?: string }[] {
    return Array.from(this.connections.values()).map((c) => ({
      serverName: c.serverName,
      connected: !c.error,
      toolCount: c.toolNames.length,
      error: c.error,
    }));
  }

  /**
   * Get list of registered tool names for a server
   */
  getToolNames(serverName: string): string[] {
    return this.connections.get(serverName)?.toolNames ?? [];
  }
}
