import { writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { createAPI } from "../../api/index.js";
import { stdin, stdout } from "process";
import { createInterface } from "readline";

export interface CreateAgentOptions {
  description?: string;
  agentDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  pluginDir?: string;
  noPreview?: boolean;
  edit?: boolean;
}

/**
 * Convert string to kebab-case
 */
function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extract agent name from description
 */
function extractAgentName(description: string): string {
  // Try to extract a meaningful name
  const words = description.toLowerCase().split(/\s+/);
  const meaningfulWords = words.filter(
    (w) => w.length > 2 && !["the", "and", "for", "with", "that", "this"].includes(w)
  );
  return toKebabCase(meaningfulWords.slice(0, 3).join("-") || "agent");
}

/**
 * Read user input from stdin
 */
async function readInput(prompt: string): Promise<string> {
  const rl = createInterface({
    input: stdin,
    output: stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Create agent command: AI-powered interactive agent creation
 */
export async function createAgentCommand(
  options: CreateAgentOptions
): Promise<void> {
  const agentDir = options.agentDir || "./agents";
  const description = options.description;

  // Check if Ollama is available
  try {
    const api = await createAPI({
      ollamaUrl: options.ollamaUrl,
      ollamaModel: options.ollamaModel,
      dbPath: options.dbPath,
      pluginDir: options.pluginDir,
    });

    console.log("🤖 AI Agent Creator");
    console.log("==================\n");

    // Get initial description if not provided
    let userDescription = description;
    if (!userDescription) {
      userDescription = await readInput(
        "What would you like your agent to do? "
      );
      if (!userDescription) {
        console.error("❌ Description is required");
        process.exit(1);
      }
    }

    // Generate agent name
    let agentName = extractAgentName(userDescription);
    let agentPath = join(agentDir, `${agentName}.ts`);

    // Check for conflicts
    if (existsSync(agentPath)) {
      console.log(`⚠️  Agent file already exists: ${agentPath}`);
      const alternative = await readInput(
        "Enter a different name (or press Enter to overwrite): "
      );
      if (alternative) {
        agentName = toKebabCase(alternative);
        agentPath = join(agentDir, `${agentName}.ts`);
      }
    }

    // Start interactive conversation with AI
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content: `You are an AI assistant helping to create Ronin agent files.

Ronin agents are TypeScript classes that extend BaseAgent. They have:
- A static schedule property (cron expression) if they should run on a schedule
- A static watch property (array of file patterns) if they should watch files
- A static webhook property (string path) if they should handle webhooks
- An execute() method that contains the main agent logic
- Optional onFileChange() and onWebhook() methods

Available APIs via this.api:
- api.ai - AI operations (complete, chat, callTools)
- api.memory - Memory storage (store, retrieve, search)
- api.files - File operations (read, write, list, watch)
- api.db - Database operations (query, execute, transaction)
- api.http - HTTP client (get, post)
- api.events - Events (emit, on, off)
- api.plugins - Plugin calls (call)

The agent class should:
1. Import BaseAgent from "../src/agent/index.js"
2. Import AgentAPI type from "../src/types/index.js"
3. Export default class that extends BaseAgent
4. Have a constructor that calls super(api)
5. Implement execute() method with the main logic

Generate complete, working TypeScript code for the agent.`,
      },
      {
        role: "user",
        content: `I want to create an agent that: ${userDescription}`,
      },
    ];

    // Interactive conversation to gather requirements
    console.log("\n💬 Let me ask a few questions to understand your requirements...\n");

    let conversationActive = true;
    while (conversationActive) {
      const response = await api.ai.chat(messages);
      messages.push(response);

      // Check if AI is asking a question or ready to generate code
      const content = response.content.toLowerCase();
      if (
        content.includes("here is the code") ||
        content.includes("```typescript") ||
        content.includes("```ts") ||
        content.includes("export default class")
      ) {
        conversationActive = false;
      } else {
        // AI is asking a question
        console.log(`🤖 ${response.content}\n`);
        const userAnswer = await readInput("> ");
        if (!userAnswer || userAnswer.toLowerCase() === "done") {
          // Ask AI to generate code
          messages.push({
            role: "user",
            content:
              "I'm done answering questions. Please generate the complete agent code now.",
          });
          conversationActive = false;
        } else {
          messages.push({
            role: "user",
            content: userAnswer,
          });
        }
      }
    }

    // Get final code generation - ask specifically for code
    messages.push({
      role: "user",
      content:
        "Now generate the complete TypeScript agent code. Include all imports, the class definition with static properties if needed, constructor, and execute method. Output only the code, wrapped in a markdown code block.",
    });

    const finalResponse = await api.ai.chat(messages);
    let agentCode = finalResponse.content;

    // Extract code from markdown code blocks if present
    const codeBlockMatch = agentCode.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      agentCode = codeBlockMatch[1];
    }

    // Clean up the code - remove any explanatory text before/after
    agentCode = agentCode
      .replace(/^[^i]*import/i, "import") // Remove text before first import
      .trim();

    // Basic validation
    if (!agentCode.includes("import")) {
      console.error("❌ Generated code is missing imports");
      process.exit(1);
    }
    if (!agentCode.includes("export default class")) {
      console.error("❌ Generated code is missing 'export default class'");
      process.exit(1);
    }
    if (!agentCode.includes("extends BaseAgent")) {
      console.error("❌ Generated code doesn't extend BaseAgent");
      process.exit(1);
    }
    if (!agentCode.includes("execute()")) {
      console.error("❌ Generated code is missing execute() method");
      process.exit(1);
    }

    // Preview
    if (!options.noPreview) {
      console.log("\n📝 Generated Agent Code:\n");
      console.log("=".repeat(60));
      console.log(agentCode);
      console.log("=".repeat(60));
      console.log(`\n📁 Will be saved to: ${agentPath}\n`);

      const confirm = await readInput("Create this agent? (y/n): ");
      if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
        console.log("❌ Agent creation cancelled");
        process.exit(0);
      }
    }

    // Write file
    try {
      await writeFile(agentPath, agentCode, "utf-8");
      console.log(`✅ Agent created: ${agentPath}`);

      if (options.edit) {
        // Try to open in editor
        const editor = process.env.EDITOR || "nano";
        const { spawn } = await import("child_process");
        spawn(editor, [agentPath], { stdio: "inherit" });
      }
    } catch (error) {
      console.error(`❌ Failed to create agent:`, error);
      process.exit(1);
    }
  } catch (error) {
    if ((error as Error).message.includes("Ollama API")) {
      console.error("❌ Ollama is not available. Please start Ollama first:");
      console.error("   ollama serve");
      process.exit(1);
    }
    throw error;
  }
}

