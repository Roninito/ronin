/**
 * Messenger Agent - Simplified SAR Chain Version
 *
 * Single responsibility: Receive user messages from Telegram, Discord, WhatsApp, etc.
 * Let AI choose appropriate tools/actions. No hardcoded command handlers.
 */

import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import type { ChainContext } from "../src/chain/types.js";
import { standardSAR } from "../src/chains/templates.js";

const SOURCE = "messenger";

/** System prompt - clean, tool-focused, no hardcoded command rules */
const SYSTEM_PROMPT = `You are the Messenger - the user's primary interface to Ronin. You receive messages and decide what to do using available tools.

**Your Role:**
- For questions, requests, or conversation → Respond directly using your knowledge and tools
- For skill execution → Call \`skills.run\` with the appropriate query and action
- For creating things (skills, agents, tasks) → Emit the appropriate event
- For information lookup → Use \`local.memory.search\` or \`ontology_search\`

**Available Tools:**
- \`skills.run\` - Execute existing AgentSkills (weather, notes, email, diagrams, etc.)
- \`local.memory.search\` - Search stored context and conversations
- \`local.file.read\` / \`local.file.list\` - Read files and directories
- \`local.shell.safe\` - Run safe shell commands (ls, cat, git, grep, etc.)
- \`local.db.query\` - Query the local database (SELECT only)
- \`ontology_search\` - Find tools, docs, and capabilities in the knowledge graph
- \`ontology_related\` - Find related nodes (e.g., use_tool edges)
- \`ontology_stats\` - Get ontology statistics

**Event Emission (for creating new things):**
Use the event system to request creation:
- \`create-skill\` with { request: "description" } → SkillMaker creates a new AgentSkill
- \`create-agent\` with { name, description } → AgentBuilder creates a new agent
- \`plan-proposed\` with { title, description, tags } → Propose a task/plan for approval

**CRITICAL: When to Stop Calling Tools**
- After a tool returns a result, DO NOT call the same tool again
- If a tool succeeded, you MUST respond to the user with the result
- Call tools maximum 1-2 times, then ALWAYS respond to the user
- Never call tools more than twice in a row

**How to Format Skill Results**
- When a skill returns data (JSON, code, URLs), present it nicely to the user
- For Mermaid diagrams: Show the diagram code in a code block AND include the mermaid.live link
- For lists: Format as bullet points, not raw JSON
- For code: Use code blocks with language specification
- Always explain what the result means - don't just echo raw output

**Response Style:**
- Be helpful, concise, and direct
- DO THE WORK yourself using tools - don't tell users to run commands
- AFTER TOOLS COMPLETE, respond to the user with the results
- For creation requests, guide users to the right command format if needed
- Include relevant context from memory/ontology when answering questions

**Examples:**
- "What's the weather?" → Call skills.run → Respond: "Here's the weather: [result]"
- "Create a flowchart" → Call skills.run → Respond: "Here's your flowchart: [diagram code + link]"
- "Show me my notes" → Call skills.run → Respond: "Found these notes: [formatted list]"

Remember: Tools are means to an end. After getting results, ALWAYS respond to the user.`;

interface ChatMessage {
  text: string;
  source: "telegram" | "discord" | "cli" | "webhook";
  sourceChannel: string;
  sourceUser: string;
  replyCallback?: (response: string) => Promise<void>;
}

export default class MessengerAgent extends BaseAgent {
  private botId: string | null = null;
  private model: string;
  private localModel: string;

  constructor(api: AgentAPI) {
    super(api);
    console.log("[messenger] Starting simplified SAR chain agent");

    const aiConfig = this.api.config.getAI();
    this.localModel = aiConfig.models?.default ?? aiConfig.ollamaModel ?? "ministral-3:3b";
    this.model = aiConfig.useSmartForTools && aiConfig.models?.smart ? "smart" : this.localModel;

    // Set up Telegram handler (initialize bot if needed)
    this.setupTelegramHandler();
    
    // Listen for Discord messages via events
    this.api.events.on("discord.message", (data: any) => {
      this.handleDiscordEvent(data).catch((err) => {
        console.error("[messenger] Error handling Discord event:", err);
      });
    });

    console.log("[messenger] Ready - using SAR chains for all message handling");
  }

  async execute(): Promise<void> {
    // Event-driven - handlers registered in constructor
  }

  private setupTelegramHandler(): void {
    if (!this.api.telegram) {
      console.log("[intent-ingress] Telegram API not available");
      return;
    }

    const token = this.api.config.getTelegram().botToken;
    if (!token) {
      console.log("[intent-ingress] No Telegram bot token configured");
      return;
    }

    // Initialize bot (will reuse existing if already initialized)
    this.api.telegram.initBot(token).then((botId) => {
      // Store botId for later use
      this.api.memory.store("telegram_bot_id", botId).catch(() => {});
      
      // Register message handler
      this.api.telegram.onMessage(botId, (msg: any) => {
        this.handleTelegramMessage(msg, botId).catch((err) => {
          console.error("[messenger] Error handling Telegram message:", err);
        });
      });
      console.log(`[messenger] Telegram message handler registered for bot ${botId}`);
    }).catch((err) => {
      // Bot already initialized - get existing botId and register handler
      console.debug("[messenger] Bot init returned error (may already exist):", err.message);
      this.api.memory.retrieve("telegram_bot_id").then((storedBotId) => {
        if (storedBotId) {
          try {
            this.api.telegram.onMessage(storedBotId as string, (msg: any) => {
              this.handleTelegramMessage(msg, storedBotId as string).catch((err) => {
                console.error("[messenger] Error handling Telegram message:", err);
              });
            });
            console.log(`[messenger] Telegram message handler registered for existing bot ${storedBotId}`);
          } catch (retryErr) {
            console.error("[messenger] Failed to register handler for existing bot:", retryErr);
          }
        }
      }).catch(() => {});
    });
  }

  private async handleTelegramMessage(update: any, botId: string): Promise<void> {
    // Update structure: { update_id, message: { chat, from, text, ... } }
    const msg = update.message;
    if (!msg) {
      console.log("[messenger] No message in update");
      return;
    }
    
    const text = msg.text || msg.caption || "";
    const chatId = msg.chat?.id;
    const chatType = msg.chat?.type;
    const isPrivateChat = chatType === "private";
    
    console.log(`[messenger] Received Telegram message: "${text.substring(0, 50)}" (chat: ${chatType}, id: ${chatId})`);
    
    if (!text.trim()) {
      console.log("[messenger] Skipping empty message");
      return;
    }

    const sourceChannel = `telegram:${chatId}`;
    const sourceUser = msg.from?.username || msg.from?.id || `user:${chatId}`;

    // Only respond to @ronin mentions in group chats
    if (!isPrivateChat && !text.toLowerCase().includes("@ronin") && !text.includes("@T2RoninBot")) {
      console.log(`[messenger] Skipping non-mention in group chat`);
      return;
    }

    // Strip mention for processing
    const cleanText = text.replace(/@ronin|@T2RoninBot/gi, "").trim();
    console.log(`[messenger] Processing: "${cleanText.substring(0, 50)}"`);

    await this.processMessage({
      text: cleanText,
      source: "telegram",
      sourceChannel,
      sourceUser,
      replyCallback: async (response) => {
        if (chatId) {
          console.log(`[messenger] Sending reply to ${chatId}`);
          await this.api.telegram?.sendMessage(botId, chatId, response, { parseMode: "HTML" });
        }
      },
    });
  }

  private async handleDiscordEvent(data: any): Promise<void> {
    const botId = data.botId;
    const channelId = data.channelId;
    const text = data.content || "";
    if (!text.trim()) return;

    const botMention = botId ? `<@${botId}>` : "@ronin";
    if (!text.includes(botMention) && !text.toLowerCase().includes("@ronin")) {
      return;
    }

    const cleanText = text.replace(botMention, "@ronin").replace(/@ronin/gi, "").trim();

    await this.processMessage({
      text: cleanText,
      source: "discord",
      sourceChannel: `discord:${channelId}`,
      sourceUser: data.author?.username || data.author?.id || "unknown",
      replyCallback: async (response) => {
        if (botId && channelId) {
          await this.api.discord?.sendMessage(botId, channelId, response);
        }
      },
    });
  }

  /**
   * Process any message using SAR Chain
   * AI decides: chat directly, call skills, emit events, use tools
   */
  private async processMessage(message: ChatMessage): Promise<void> {
    console.log(`[messenger] Processing from ${message.source}: "${message.text.substring(0, 60)}..."`);

    const conversationId = `${message.sourceChannel}-${Date.now()}`;

    const ctx: import("../src/chain/types.js").ChainContext = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message.text },
      ],
      ontology: {
        domain: "ingress",
        relevantSkills: [],
      },
      budget: {
        max: 8192,
        current: 0,
        reservedForResponse: 512,
      },
      conversationId,
      model: this.model,
      metadata: { maxToolIterations: 4 }, // Limit to 4 iterations max
    };

    try {
      const stack = standardSAR({ maxTokens: 8192 });
      const chain = this.createChain(SOURCE);
      chain.useMiddlewareStack(stack);
      chain.withContext(ctx);
      await chain.run();

      // Extract AI's response from messages
      const assistantMessages = ctx.messages
        .filter((m) => m.role === "assistant" && m.content)
        .map((m) => m.content)
        .join("\n\n");

      // If AI responded with text, send it
      if (assistantMessages && message.replyCallback) {
        await message.replyCallback(this.formatResponse(assistantMessages));
        return;
      }

      // Fallback: AI called tools but didn't respond - format tool results
      const toolResults = ctx.messages
        .filter((m) => m.role === "tool")
        .map((m: any) => {
          try {
            const data = JSON.parse(m.content);
            
            // skills.run wraps results: {success, data: {skill, output: {...}}}
            const skillData = data.data || data;
            const output = skillData.output;
            
            // Check for Mermaid diagram
            if (output && typeof output === 'object' && output.diagram) {
              return `✅ Here's your diagram:\n\n\`\`\`mermaid\n${output.diagram}\n\`\`\`\n\nView/Edit: ${output.url || "N/A"}`;
            }
            
            // Generic success with output
            if (skillData.success && output) {
              if (typeof output === 'string') return output;
              return `✅ Result:\n${JSON.stringify(output, null, 2)}`;
            }
            
            // Error case
            if (!skillData.success) {
              return `❌ Error: ${skillData.error || "Unknown error"}`;
            }
            
            // Last resort
            return `✅ Completed successfully`;
          } catch (e) {
            console.log("[messenger] Fallback parse error:", e);
            return m.content;
          }
        })
        .join("\n\n");

      if (toolResults && message.replyCallback) {
        console.log(`[messenger] Sending tool result fallback to ${message.sourceChannel}`);
        console.log(`[messenger] Reply content: ${toolResults.substring(0, 200)}...`);
        await message.replyCallback(this.formatResponse(toolResults));
      } else if (!assistantMessages) {
        console.warn("[messenger] No assistant messages AND no tool results to send!");
      }
    } catch (error) {
      console.error("[messenger] Chain execution failed:", error);
      if (message.replyCallback) {
        await message.replyCallback(`❌ Error processing request: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  }

  /**
   * Format AI response for Telegram/HTML
   */
  private formatResponse(text: string): string {
    // Convert markdown code blocks to HTML pre/code
    let formatted = text
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
      .replace(/\n/g, '<br>');

    // Truncate if too long for Telegram
    if (formatted.length > 4000) {
      formatted = formatted.substring(0, 3900) + '<br>...<br><i>(Response truncated)</i>';
    }

    return formatted;
  }

  /**
   * Handle CLI requests (called from CLI commands)
   */
  async handleCLIRequest(text: string): Promise<string> {
    let response = "";
    await this.processMessage({
      text,
      source: "cli",
      sourceChannel: "cli:terminal",
      sourceUser: process.env.USER || "user",
      replyCallback: async (r) => { response = r; },
    });
    return response;
  }
}
