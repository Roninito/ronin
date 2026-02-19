import type { ToolDefinition, ToolContext, ToolResult } from "../types.js";
import type { AgentAPI } from "../../types/index.js";

/**
 * Send a pending-response question to the user's preferred chat (Telegram or Discord).
 * Used when local.notify.ask times out so the user can respond later.
 */
async function sendToChatChannel(
  api: AgentAPI,
  title: string,
  message: string,
  buttons: string[],
  taskId: string
): Promise<"telegram" | "discord" | null> {
  const preferred = api.config.getNotifications?.()?.preferredChat ?? "auto";

  const replyLine =
    buttons.length > 0
      ? `Reply with: ${buttons.map((b, i) => `${i + 1}) ${b}`).join("  ")}`
      : "Reply when ready.";
  const body = `[Ronin] ${title}\n\n${message}\n\n${replyLine}\nTask: ${taskId}`;

  const tryTelegram = async (): Promise<boolean> => {
    if (!api.telegram) return false;
    const tg = api.config.getTelegram();
    const token = tg.botToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = tg.chatId || process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return false;
    try {
      const botId = await api.telegram.initBot(token);
      await api.telegram.sendMessage(botId, chatId, body);
      return true;
    } catch {
      return false;
    }
  };

  const tryDiscord = async (): Promise<boolean> => {
    if (!api.discord) return false;
    const dc = api.config.getDiscord();
    if (!dc.enabled || !dc.botToken || !dc.channelIds?.length) return false;
    const channelId = dc.channelIds[0];
    try {
      const clientId = await api.discord.initBot(dc.botToken);
      await api.discord.sendMessage(clientId, channelId, body);
      return true;
    } catch {
      return false;
    }
  };

  if (preferred === "telegram") {
    return (await tryTelegram()) ? "telegram" : null;
  }
  if (preferred === "discord") {
    return (await tryDiscord()) ? "discord" : null;
  }
  // auto: try Telegram first, then Discord
  if (await tryTelegram()) return "telegram";
  if (await tryDiscord()) return "discord";
  return null;
}

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

  // 7. Emit Event Tool
  register({
    name: "local.events.emit",
    description:
      "Emit a Ronin event so other agents or the event monitor can react. Use for signaling completion, proposing plans (e.g. PlanProposed, TaskCreated), or custom events.",
    parameters: {
      type: "object",
      properties: {
        event: {
          type: "string",
          description: "Event type name (e.g. PlanProposed, TaskCreated, or custom)",
        },
        data: {
          type: "object",
          description: "Payload object (any JSON-serializable data)",
        },
        source: {
          type: "string",
          description: "Optional event source; defaults to 'ai' or current agent if known",
        },
      },
      required: ["event", "data"],
    },
    provider: "local",
    handler: async (
      args: { event: string; data: Record<string, unknown>; source?: string },
      context: ToolContext
    ): Promise<ToolResult> => {
      const startTime = Date.now();
      if (args.event == null || args.event === "") {
        return {
          success: false,
          data: null,
          error: "event is required and must be non-empty",
          metadata: {
            toolName: "local.events.emit",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
      if (args.data == null || typeof args.data !== "object") {
        return {
          success: false,
          data: null,
          error: "data is required and must be an object",
          metadata: {
            toolName: "local.events.emit",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      }
      const source = args.source ?? context.metadata?.agentName ?? "ai";
      try {
        api.events.emit(args.event, args.data, source);
        return {
          success: true,
          data: { emitted: true, event: args.event, source },
          metadata: {
            toolName: "local.events.emit",
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
          error: error instanceof Error ? error.message : "Emit failed",
          metadata: {
            toolName: "local.events.emit",
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
    riskLevel: "low",
  });

  // 8. Speech Say Tool (uses Piper TTS plugin)
  register({
    name: "local.speech.say",
    description: "Speak text aloud using text-to-speech. Use this to verbally communicate with the user.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to speak aloud" },
      },
      required: ["text"],
    },
    provider: "local",
    handler: async (args: { text: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        if (api.plugins.has("piper")) {
          await api.plugins.call("piper", "speakAndPlay", args.text);
        } else {
          // Fallback: macOS say command
          if (process.platform === "darwin") {
            const { exec } = require("child_process");
            const { promisify } = require("util");
            const execAsync = promisify(exec);
            const escaped = args.text.replace(/"/g, '\\"').replace(/'/g, "'\\''");
            await execAsync(`say "${escaped}"`);
          } else {
            throw new Error("No TTS backend available. Install piper plugin or run on macOS.");
          }
        }
        return {
          success: true,
          data: { spoken: true, text: args.text },
          metadata: {
            toolName: "local.speech.say",
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
          error: error instanceof Error ? error.message : "Speech synthesis failed",
          metadata: {
            toolName: "local.speech.say",
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
    riskLevel: "low",
  });

  // 9. Speech Listen Tool (uses STT plugin)
  register({
    name: "local.speech.listen",
    description: "Record audio from the microphone and transcribe to text. Use this to listen to the user speaking.",
    parameters: {
      type: "object",
      properties: {
        duration: { type: "number", description: "Recording duration in seconds (default: 5)" },
        language: { type: "string", description: "Language code (e.g. 'en')" },
      },
      required: [],
    },
    provider: "local",
    handler: async (args: { duration?: number; language?: string }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        if (api.plugins.has("stt")) {
          const result = await api.plugins.call("stt", "recordAndTranscribe", args.duration || 5, { language: args.language }) as { text: string; audioPath: string };
          return {
            success: true,
            data: { text: result.text, audioPath: result.audioPath },
            metadata: {
              toolName: "local.speech.listen",
              provider: "local",
              duration: Date.now() - startTime,
              cached: false,
              timestamp: Date.now(),
              callId: `local-${Date.now()}`,
            },
          };
        }
        throw new Error("STT plugin not loaded. Enable the stt plugin for speech recognition.");
      } catch (error) {
        return {
          success: false,
          data: null,
          error: error instanceof Error ? error.message : "Speech recognition failed",
          metadata: {
            toolName: "local.speech.listen",
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
    riskLevel: "low",
  });

  // 10. Notification Tool
  register({
    name: "local.notify",
    description: "Show a desktop notification to the user. Use this to alert the user about task status, errors, or important information.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Notification title" },
        message: { type: "string", description: "Notification body text" },
        subtitle: { type: "string", description: "Optional subtitle" },
        sound: { type: "boolean", description: "Play notification sound (default: true)" },
      },
      required: ["title", "message"],
    },
    provider: "local",
    handler: async (args: { title: string; message: string; subtitle?: string; sound?: boolean }): Promise<ToolResult> => {
      const startTime = Date.now();
      try {
        if (process.platform === "darwin") {
          const { exec } = require("child_process");
          const { promisify } = require("util");
          const execAsync = promisify(exec);
          const escTitle = args.title.replace(/"/g, '\\"');
          const escMsg = args.message.replace(/"/g, '\\"');
          let script = `display notification "${escMsg}" with title "${escTitle}"`;
          if (args.subtitle) {
            script += ` subtitle "${args.subtitle.replace(/"/g, '\\"')}"`;
          }
          if (args.sound !== false) {
            script += ` sound name "default"`;
          }
          await execAsync(`osascript -e '${script}'`);
        } else {
          // Linux fallback via notify-send
          const { exec } = require("child_process");
          const { promisify } = require("util");
          const execAsync = promisify(exec);
          await execAsync(`notify-send "${args.title}" "${args.message}"`);
        }
        return {
          success: true,
          data: { notified: true, title: args.title },
          metadata: {
            toolName: "local.notify",
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
          error: error instanceof Error ? error.message : "Notification failed",
          metadata: {
            toolName: "local.notify",
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
    riskLevel: "low",
  });

  // 11. Notification Ask Tool (interactive dialog with choices)
  register({
    name: "local.notify.ask",
    description:
      "Show an interactive notification dialog asking the user a question with choices. " +
      "Returns the user's selected answer. Use this when you need user input to proceed, " +
      "e.g. 'Unable to complete task. Would you like me to create these skills?' " +
      "If the dialog times out (default 30s), a pending task is created and the question is sent to your preferred chat (Telegram/Discord).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Dialog title" },
        message: { type: "string", description: "Question or message to display" },
        buttons: {
          type: "array",
          description: 'Button labels for choices (max 3). E.g. ["Yes", "No", "Skip"]',
          items: { type: "string" },
        },
        defaultButton: { type: "string", description: "Which button is the default (pressed on Enter)" },
        icon: { type: "string", description: "Icon type: 'note', 'caution', or 'stop'" },
        timeout: { type: "number", description: "Seconds before dialog times out (default from config, usually 30)" },
      },
      required: ["title", "message", "buttons"],
    },
    provider: "local",
    handler: async (args: {
      title: string;
      message: string;
      buttons: string[];
      defaultButton?: string;
      icon?: string;
      timeout?: number;
    }): Promise<ToolResult> => {
      const startTime = Date.now();
      const buttons = (args.buttons || ["OK", "Cancel"]).slice(0, 3);
      const timeoutSeconds =
        args.timeout ??
        api.config.getNotifications?.()?.timeoutSeconds ??
        30;

      try {
        const buttonsStr = buttons.map((b: string) => `"${b.replace(/"/g, '\\"')}"`).join(", ");
        const escTitle = args.title.replace(/"/g, '\\"');
        const escMsg = args.message.replace(/"/g, '\\"');
        let defaultClause = "";
        if (args.defaultButton) {
          defaultClause = ` default button "${args.defaultButton.replace(/"/g, '\\"')}"`;
        }
        let iconClause = "";
        if (args.icon && ["note", "caution", "stop"].includes(args.icon)) {
          iconClause = ` with icon ${args.icon}`;
        }

        if (process.platform === "darwin") {
          const { exec } = require("child_process");
          const { promisify } = require("util");
          const execAsync = promisify(exec);
          const script = `display dialog "${escMsg}" with title "${escTitle}" buttons {${buttonsStr}}${defaultClause}${iconClause} giving up after ${timeoutSeconds}`;
          const { stdout } = await execAsync(`osascript -e '${script}'`);
          const out = (stdout as string) || "";
          // Timeout: AppleScript returns "gave up:true"
          if (out.includes("gave up:true")) {
            const taskId = crypto.randomUUID();
            api.events.emit(
              "PendingResponse",
              {
                taskId,
                title: args.title,
                message: args.message,
                buttons,
                source: "notify.ask",
              },
              "local.notify.ask"
            );
            const sentToChat = await sendToChatChannel(
              api,
              args.title,
              args.message,
              buttons,
              taskId
            );
            return {
              success: true,
              data: {
                answer: null,
                timedOut: true,
                taskId,
                sentToChat,
              },
              metadata: {
                toolName: "local.notify.ask",
                provider: "local",
                duration: Date.now() - startTime,
                cached: false,
                timestamp: Date.now(),
                callId: `local-${Date.now()}`,
              },
            };
          }
          // Parse "button returned:Yes" format
          const match = out.match(/button returned:(.+)/);
          const chosen = match ? match[1].trim() : buttons[0];
          return {
            success: true,
            data: { answer: chosen, buttons, title: args.title },
            metadata: {
              toolName: "local.notify.ask",
              provider: "local",
              duration: Date.now() - startTime,
              cached: false,
              timestamp: Date.now(),
              callId: `local-${Date.now()}`,
            },
          };
        }

        // Non-macOS: emit event and wait for response via event system
        const requestId = `ask-${Date.now()}`;
        api.events.emit(
          "notify.ask",
          {
            requestId,
            title: args.title,
            message: args.message,
            buttons,
          },
          "local.notify.ask"
        );

        return {
          success: true,
          data: {
            answer: buttons[0],
            note: "Non-macOS: dialog emitted as notify.ask event. Default answer used.",
            buttons,
          },
          metadata: {
            toolName: "local.notify.ask",
            provider: "local",
            duration: Date.now() - startTime,
            cached: false,
            timestamp: Date.now(),
            callId: `local-${Date.now()}`,
          },
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        // User cancelled dialog (exit code 1)
        if (errMsg.includes("User canceled") || errMsg.includes("(-128)")) {
          return {
            success: true,
            data: { answer: null, cancelled: true, title: args.title },
            metadata: {
              toolName: "local.notify.ask",
              provider: "local",
              duration: Date.now() - startTime,
              cached: false,
              timestamp: Date.now(),
              callId: `local-${Date.now()}`,
            },
          };
        }
        return {
          success: false,
          data: null,
          error: errMsg,
          metadata: {
            toolName: "local.notify.ask",
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
    riskLevel: "low",
  });

  if (!process.env.RONIN_QUIET) console.log("[LocalTools] Registered 11 local tools");
}
