import { stdin, stdout } from "process";
import { createInterface } from "readline";

export interface AskOptions {
  question?: string;
  model?: string; // Model/tier (e.g., "smart", "cloud", "local")
  askModel?: string; // Specific Ollama model for ask command (e.g., "ministral-3:3b")
  agentDir?: string;
  pluginDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  showSources?: boolean;
}

interface RunningStatus {
  running: boolean;
}

interface ChatRecord {
  id?: string;
  chatId?: string;
}

const ASK_TOTAL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for tool/cloud calls
const ASK_IDLE_TIMEOUT_MS = 2 * 60 * 1000; // Allow slower chunk cadence with tools

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

function getWebhookPort(): number {
  const raw = process.env.WEBHOOK_PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 3000;
}

async function isRoninRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/api/status`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    const status = (await response.json()) as RunningStatus;
    return Boolean(status?.running);
  } catch {
    return false;
  }
}

async function createChat(port: number): Promise<string> {
  const response = await fetch(`http://localhost:${port}/api/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "CLI Ask" }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`Failed to create chat (${response.status})`);
  }
  const chat = (await response.json()) as ChatRecord;
  const chatId = chat.id || chat.chatId;
  if (!chatId) {
    throw new Error("Chat API did not return a chat id");
  }
  return chatId;
}

function extractNinjaTag(message: string): { cleaned: string; ninja: boolean } {
  const ninjaPattern = /\s*@ninja\b\s*/gi;
  if (ninjaPattern.test(message)) {
    return { cleaned: message.replace(/\s*@ninja\b\s*/gi, " ").trim(), ninja: true };
  }
  return { cleaned: message, ninja: false };
}

function normalizeRequestedModel(model?: string): string | undefined {
  if (!model) return undefined;
  const m = model.trim().toLowerCase();
  if (!m || m === "local" || m === "ollama") return undefined;
  if (m === "cloud" || m === "ninja") return "smart";
  return model.trim();
}

async function askRunningInstance(
  port: number,
  chatId: string,
  question: string,
  model?: string,
): Promise<string> {
  const response = await fetch(`http://localhost:${port}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: question, chatId, model }),
    signal: AbortSignal.timeout(ASK_TOTAL_TIMEOUT_MS),
  });

  if (!response.ok) {
    let details = "";
    try {
      const text = await response.text();
      if (text) details = text;
    } catch {
      // ignore body parse errors
    }
    throw new Error(`Chat request failed (${response.status})${details ? `: ${details}` : ""}`);
  }

  if (!response.body) {
    throw new Error(`Chat request failed (${response.status}): empty response body`);
  }

  process.stdout.write("💬 ");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";
  let lastChunkTime = Date.now();
  const startedAt = Date.now();

  const readChunkWithTimeout = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    const now = Date.now();
    const remainingTotal = ASK_TOTAL_TIMEOUT_MS - (now - startedAt);
    const remainingIdle = ASK_IDLE_TIMEOUT_MS - (now - lastChunkTime);
    const timeoutMs = Math.max(1, Math.min(remainingTotal, remainingIdle));

    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Response timeout")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  while (true) {
    const { done, value } = (await readChunkWithTimeout()) as ReadableStreamReadResult<Uint8Array>;

    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    process.stdout.write(chunk);
    fullResponse += chunk;
    lastChunkTime = Date.now();
  }

  process.stdout.write("\n");
  return fullResponse;
}

/**
 * Ask command: Interactive AI assistant for Ronin questions
 */
export async function askCommand(options: AskOptions = {}): Promise<void> {
  const port = getWebhookPort();
  const running = await isRoninRunning(port);

  if (!running) {
    throw new Error("Ronin is not running. Start it first: ronin start");
  }

  const requestedModel = normalizeRequestedModel(
    options.askModel || options.model || options.ollamaModel
  );

  if (requestedModel) {
    console.log(`ℹ️  Using requested model/tier: ${requestedModel}`);
  } else if (options.model || options.askModel || options.ollamaModel) {
    console.log("ℹ️  Using running Ronin default model.");
  }

  const chatId = await createChat(port);

  if (options.question) {
    const { cleaned, ninja } = extractNinjaTag(options.question);
    const model = ninja ? "smart" : requestedModel;
    if (ninja) console.log("⚡ @ninja — using smart model");
    console.log(`\n🤖 ${cleaned}\n`);
    await askRunningInstance(port, chatId, cleaned, model);
    return;
  }

  console.log("\n🤖 Ronin Assistant - Ask me anything about Ronin!");
  console.log("Tip: Add @ninja to use the smart model for a message.");
  console.log("Type 'exit' or 'quit' to end the conversation.\n");

  while (true) {
    const question = await readInput("> ");
    if (!question || question.toLowerCase() === "exit" || question.toLowerCase() === "quit") {
      console.log("\n👋 Goodbye!");
      break;
    }
    const { cleaned, ninja } = extractNinjaTag(question);
    const model = ninja ? "smart" : requestedModel;
    if (ninja) console.log("⚡ @ninja — using smart model");
    await askRunningInstance(port, chatId, cleaned, model);
    process.stdout.write("\n");
  }
}
