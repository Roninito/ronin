import { buildContextPrompt } from "./ask-context.js";
import { stdin, stdout } from "process";
import { createInterface } from "readline";
import type { AgentAPI } from "../../types/api.js";
import type { AskOptions } from "./ask.js";

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
 * Ask with remote AI model (Grok, Gemini, etc.)
 */
export async function askWithRemoteModel(
  modelName: string,
  options: AskOptions,
  api: AgentAPI,
  agentDir: string,
  pluginDir: string
): Promise<void> {
  // Build context prompt (same as local)
  console.log("📚 Gathering context...");
  const systemPrompt = await buildContextPrompt(agentDir, pluginDir, ".", api);

  // Initialize conversation
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: systemPrompt,
    },
  ];

  // Single question mode
  if (options.question) {
    console.log(`\n🤖 [${modelName}] ${options.question}\n`);
    
    messages.push({
      role: "user",
      content: options.question,
    });

    // Use remote model plugin
    try {
      // Get plugin methods
      const pluginMethods = api.plugins.getMethods(modelName);
      if (!pluginMethods) {
        throw new Error(`Plugin '${modelName}' not found`);
      }
      
      const hasStreamChat = typeof pluginMethods.streamChat === "function";

      if (hasStreamChat) {
        // Stream the response
        let fullResponse = "";
        process.stdout.write("💬 ");
        
        try {
          const streamMethod = pluginMethods.streamChat;
          for await (const chunk of streamMethod(messages, {})) {
            process.stdout.write(chunk);
            fullResponse += chunk;
          }
          process.stdout.write("\n");
        } catch (error) {
          console.error(`\n❌ Streaming error: ${error}`);
          // Fallback to non-streaming
          const chatMethod = pluginMethods.chat;
          if (chatMethod) {
            fullResponse = await chatMethod(messages, {});
            console.log(fullResponse);
          } else {
            throw error;
          }
        }
      } else {
        // Non-streaming chat
        const chatMethod = pluginMethods.chat;
        if (chatMethod) {
          process.stdout.write("💬 ");
          const response = await chatMethod(messages, {});
          console.log(response);
        } else {
          throw new Error(`Plugin '${modelName}' does not support chat or streamChat methods`);
        }
      }
    } catch (error) {
      console.error(`\n❌ Error calling ${modelName}:`, error);
      if ((error as Error).message.includes("API_KEY")) {
        console.error(`\n💡 Tip: Set ${modelName.toUpperCase()}_API_KEY environment variable`);
      }
      process.exit(1);
    }
    return;
  }

  // Interactive mode
  console.log(`\n🤖 Ronin Assistant [${modelName}] - Ask me anything about Ronin!`);
  console.log("Type 'exit' or 'quit' to end the conversation.\n");

  const pluginMethods = api.plugins.getMethods(modelName);
  if (!pluginMethods) {
    console.error(`❌ Plugin '${modelName}' not found`);
    process.exit(1);
  }
  
  const hasStreamChat = typeof pluginMethods.streamChat === "function";
  const chatMethod = pluginMethods.chat;

  while (true) {
    const question = await readInput("> ");

    if (!question || question.toLowerCase() === "exit" || question.toLowerCase() === "quit") {
      console.log("\n👋 Goodbye!");
      break;
    }

    messages.push({
      role: "user",
      content: question,
    });

    try {
      let fullResponse = "";
      process.stdout.write("\n💬 ");

      if (hasStreamChat) {
        // Stream the response
        try {
          const streamMethod = pluginMethods.streamChat;
          const stream = streamMethod(messages, {});
          for await (const chunk of stream) {
            process.stdout.write(chunk);
            fullResponse += chunk;
          }
          process.stdout.write("\n");
        } catch (error) {
          // Fallback to non-streaming
          if (chatMethod) {
            fullResponse = await chatMethod(messages, {});
            console.log(fullResponse);
          } else {
            throw error;
          }
        }
      } else if (chatMethod) {
        // Non-streaming chat
        fullResponse = await chatMethod(messages, {});
        console.log(fullResponse);
      } else {
        throw new Error(`Plugin '${modelName}' does not support chat or streamChat methods`);
      }

      // Add response to messages for context
      messages.push({
        role: "assistant",
        content: fullResponse,
      });

      if (options.showSources) {
        console.log("📚 Sources: System context, documentation, and code structure\n");
      }
    } catch (error) {
      console.error(`\n❌ Error: ${error}`);
      if ((error as Error).message.includes("API_KEY")) {
        console.error(`💡 Tip: Set ${modelName.toUpperCase()}_API_KEY environment variable\n`);
      } else {
        console.log("Please try again.\n");
      }
    }
  }
}

