import { writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { createAPI } from "../../api/index.js";
import { stdin, stdout } from "process";
import { createInterface } from "readline";
import { ensureDefaultAgentDir, ensureDefaultExternalAgentDir } from "./config.js";

export interface CreateDutyOptions {
  description?: string;
  dutyDir?: string;
  local?: boolean;
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
function extractDutyName(description: string): string {
  // Try to extract a meaningful name
  const words = description.toLowerCase().split(/\s+/);
  const meaningfulWords = words.filter(
    (w) => w.length > 2 && !["the", "and", "for", "with", "that", "this"].includes(w)
  );
  return toKebabCase(meaningfulWords.slice(0, 3).join("-") || "duty");
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
 * Try to emit event via HTTP to running Ronin instance
 */
async function emitEventViaHTTP(event: string, data: unknown): Promise<boolean> {
  const port = process.env.WEBHOOK_PORT ? parseInt(process.env.WEBHOOK_PORT) : 3000;
  try {
    const response = await fetch(`http://localhost:${port}/api/events/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data }),
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Create duty command: Event-driven duty creation via orchestrator
 */
export async function createDutyCommand(
  options: CreateDutyOptions
): Promise<void> {
  const description = options.description;

  console.log("🤖 AI Duty Creator");
  console.log("==================\n");

  // Get initial description if not provided
  let userDescription = description;
  if (!userDescription) {
    userDescription = await readInput(
      "What would you like your duty to do? "
    );
    if (!userDescription) {
      console.error("❌ Description is required");
      process.exit(1);
    }
  }

  // Try to emit event to running Ronin instance
  const eventEmitted = await emitEventViaHTTP("create_duty", { task: userDescription });
  
  if (eventEmitted) {
    console.log("✅ Duty creation request sent to orchestrator");
    console.log("   The orchestrator will handle duty creation asynchronously");
    console.log("   Check the Ronin logs for progress updates");
    return;
  }

  // Fallback: Ronin not running, use direct creation (legacy mode)
  console.log("⚠️  Ronin instance not running. Using direct creation mode.");
  console.log("   For event-driven creation, start Ronin first: ronin start\n");

  // Use local directory (~/.ronin/duties) if --local flag is set or no dutyDir specified
  let dutyDir: string;
  if (options.local) {
    dutyDir = ensureDefaultExternalAgentDir();
  } else {
    dutyDir = options.dutyDir || ensureDefaultAgentDir();
  }

  // Check if Ollama is available
  try {
    const api = await createAPI({
      ollamaUrl: options.ollamaUrl,
      ollamaModel: options.ollamaModel,
      dbPath: options.dbPath,
      pluginDir: options.pluginDir,
    });

    // Generate duty name
    let dutyName = extractDutyName(userDescription);
    let dutyPath = join(dutyDir, `${dutyName}.ts`);

    // Check for conflicts
    if (existsSync(dutyPath)) {
      console.log(`⚠️  Duty file already exists: ${dutyPath}`);
      const alternative = await readInput(
        "Enter a different name (or press Enter to overwrite): "
      );
      if (alternative) {
        dutyName = toKebabCase(alternative);
        dutyPath = join(dutyDir, `${dutyName}.ts`);
      }
    }

    // Start interactive conversation with AI
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content: `You are an AI assistant helping to create Ronin duty files.

Ronin duties are TypeScript classes that extend BaseDuty. They have:
- A static schedule property (cron expression) if they should run on a schedule
- A static watch property (array of file patterns) if they should watch files
- A static webhook property (string path) if they should handle webhooks
- An execute() method that contains the main duty logic
- Optional onFileChange() and onWebhook() methods

Available APIs via this.api:
- api.ai - AI operations (complete, chat, callTools)
- api.memory - Memory storage (store, retrieve, search)
- api.files - File operations (read, write, list, watch)
- api.db - Database operations (query, execute, transaction)
- api.http - HTTP client (get, post)
- api.events - Events (emit, on, off)
- api.plugins - Plugin calls (call)

The duty class should:
1. Import BaseDuty from "../src/duty/index.js"
2. Import DutyAPI type from "../src/types/index.js"
3. Export default class that extends BaseDuty
4. Have a constructor that calls super(api)
5. Implement execute() method with the main logic

Generate complete, working TypeScript code for the duty.`,
      },
      {
        role: "user",
        content: `I want to create a duty that: ${userDescription}`,
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
              "I'm done answering questions. Please generate the complete duty code now.",
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
        "Now generate the complete TypeScript duty code. Include all imports, the class definition with static properties if needed, constructor, and execute method. Output only the code, wrapped in a markdown code block.",
    });

    const finalResponse = await api.ai.chat(messages);
    let dutyCode = finalResponse.content;

    // Extract code from markdown code blocks if present
    const codeBlockMatch = dutyCode.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      dutyCode = codeBlockMatch[1];
    }

    // Clean up the code - remove any explanatory text before/after
    dutyCode = dutyCode
      .replace(/^[^i]*import/i, "import") // Remove text before first import
      .trim();

    // Basic validation
    if (!dutyCode.includes("import")) {
      console.error("❌ Generated code is missing imports");
      process.exit(1);
    }
    if (!dutyCode.includes("export default class")) {
      console.error("❌ Generated code is missing 'export default class'");
      process.exit(1);
    }
    if (!dutyCode.includes("extends BaseDuty")) {
      console.error("❌ Generated code doesn't extend BaseDuty");
      process.exit(1);
    }
    if (!dutyCode.includes("execute()")) {
      console.error("❌ Generated code is missing execute() method");
      process.exit(1);
    }

    // Preview
    if (!options.noPreview) {
      console.log("\n📝 Generated Duty Code:\n");
      console.log("=".repeat(60));
      console.log(dutyCode);
      console.log("=".repeat(60));
      console.log(`\n📁 Will be saved to: ${dutyPath}\n`);

      const confirm = await readInput("Create this duty? (y/n): ");
      if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
        console.log("❌ Duty creation cancelled");
        process.exit(0);
      }
    }

    // Write file
    try {
      await writeFile(dutyPath, dutyCode, "utf-8");
      console.log(`✅ Duty created: ${dutyPath}`);

      if (options.edit) {
        // Try to open in editor
        const editor = process.env.EDITOR || "nano";
        const { spawn } = await import("child_process");
        spawn(editor, [dutyPath], { stdio: "inherit" });
      }
    } catch (error) {
      console.error(`❌ Failed to create duty:`, error);
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

