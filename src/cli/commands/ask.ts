import { createAPI } from "../../api/index.js";
import { buildContextPrompt } from "./ask-context.js";
import { executeTool, getSystemTools } from "./ask-tools.js";
import { pluginsToTools } from "../../plugins/toolGenerator.js";
import { PluginLoader } from "../../plugins/PluginLoader.js";
import { askWithRemoteModel } from "./ask-remote.js";
import { stdin, stdout } from "process";
import { createInterface } from "readline";
import type { ToolCall } from "../../types/api.js";

export interface AskOptions {
  question?: string;
  model?: string; // Model name (e.g., "grok", "gemini", or "local" for default)
  agentDir?: string;
  pluginDir?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  dbPath?: string;
  showSources?: boolean;
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
 * Ask command: Interactive AI assistant for Ronin questions
 */
export async function askCommand(options: AskOptions = {}): Promise<void> {
  const agentDir = options.agentDir || "./agents";
  const pluginDir = options.pluginDir || "./plugins";

  // Check if a remote model is specified (grok, gemini, etc.)
  const remoteModels = ["grok", "gemini"];
  const isRemoteModel = options.model && remoteModels.includes(options.model.toLowerCase());
  
  if (isRemoteModel) {
    // Route to remote model handler
    const api = await createAPI({
      ollamaUrl: options.ollamaUrl,
      ollamaModel: options.ollamaModel,
      dbPath: options.dbPath,
      pluginDir,
    });
    await askWithRemoteModel(options.model!.toLowerCase(), options, api, agentDir, pluginDir);
    return;
  }

  // Use local Ollama model (default)
  try {
    const api = await createAPI({
      ollamaUrl: options.ollamaUrl,
      ollamaModel: options.ollamaModel,
      dbPath: options.dbPath,
      pluginDir,
    });

    // Build context prompt
    console.log("📚 Gathering context...");
    const systemPrompt = await buildContextPrompt(agentDir, pluginDir, ".", api);

    // Initialize conversation
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      {
        role: "system",
        content: systemPrompt,
      },
    ];

    // Get all available tools
    const systemTools = getSystemTools();
    const pluginLoader = new PluginLoader(pluginDir);
    const plugins = await pluginLoader.loadAllPlugins();
    const pluginTools = pluginsToTools(plugins.map(p => p.plugin));
    const allTools = [...systemTools, ...pluginTools];

    // Single question mode
    if (options.question) {
      console.log(`\n🤖 ${options.question}\n`);
      
      let userQuestion = options.question;
      let toolResults: Array<{ tool: string; result: unknown }> = [];

      // Pattern-based tool detection for common questions
      const questionLower = options.question.toLowerCase();
      
      // Check for file listing patterns
      if (questionLower.match(/list.*files?.*(?:in|from|of).*(?:plugins?|agents?|folder|directory)/i) ||
          questionLower.match(/what.*files?.*(?:in|from|of).*(?:plugins?|agents?|folder|directory)/i) ||
          questionLower.match(/show.*files?.*(?:in|from|of).*(?:plugins?|agents?|folder|directory)/i)) {
        // Extract directory from question
        let targetDir = "./plugins";
        if (questionLower.includes("agent")) {
          targetDir = agentDir;
        } else if (questionLower.includes("plugin")) {
          targetDir = pluginDir;
        }
        
        try {
          const files = await executeTool("list_files", { directory: targetDir }, api, agentDir, pluginDir);
          toolResults.push({ tool: "list_files", result: files });
          userQuestion = `${options.question}\n\nTool execution result:\n${JSON.stringify(files, null, 2)}\n\nPlease provide a clear answer based on this file list.`;
        } catch (error) {
          // Continue without tool result
        }
      }
      
      // Check for plugin listing patterns
      if (questionLower.match(/list.*plugins?/i) || questionLower.match(/what.*plugins?/i) || questionLower.match(/show.*plugins?/i)) {
        try {
          const plugins = await executeTool("list_plugins", {}, api, agentDir, pluginDir);
          toolResults.push({ tool: "list_plugins", result: plugins });
          userQuestion = `${options.question}\n\nTool execution result:\n${plugins}\n\nPlease provide a clear answer based on this plugin information.`;
        } catch (error) {
          // Continue without tool result
        }
      }
      
      // Check for agent listing patterns
      if (questionLower.match(/list.*agents?/i) || questionLower.match(/what.*agents?/i) || questionLower.match(/show.*agents?/i)) {
        try {
          const agents = await executeTool("list_agents", {}, api, agentDir, pluginDir);
          toolResults.push({ tool: "list_agents", result: agents });
          userQuestion = `${options.question}\n\nTool execution result:\n${agents}\n\nPlease provide a clear answer based on this agent information.`;
        } catch (error) {
          // Continue without tool result
        }
      }
      
      // Try function calling as fallback if no pattern matched
      if (toolResults.length === 0) {
        let toolCallResponse;
        try {
          // Add timeout for tool calling (5 seconds)
          toolCallResponse = await Promise.race([
            api.ai.callTools(userQuestion, allTools, {}),
            new Promise<{ message: { role: "assistant"; content: string }; toolCalls: ToolCall[] }>((_, reject) =>
              setTimeout(() => reject(new Error("Tool calling timeout")), 60000) // 1 minute
            ),
          ]);

          // Execute tool calls if any
          if (toolCallResponse.toolCalls && toolCallResponse.toolCalls.length > 0) {
            console.log("🔧 Gathering information...\n");
            
            for (const toolCall of toolCallResponse.toolCalls) {
              try {
                const toolName = toolCall.name;
                const args = toolCall.arguments as Record<string, unknown>;
                
                // Define system tools first - these take precedence
                const systemToolNames = ["list_files", "read_file", "list_plugins", "list_agents", "get_system_info"];
                
                // Check if it's a system tool FIRST (before checking for plugin tools)
                if (systemToolNames.includes(toolName)) {
                  // System tool
                  const result = await executeTool(toolName, args, api, agentDir, pluginDir);
                  toolResults.push({ tool: toolName, result });
                } else if (toolName.includes("_")) {
                  // Plugin tool (format: pluginName_methodName)
                  // Only treat as plugin if it's not a system tool
                  const parts = toolName.split("_");
                  const pluginName = parts[0];
                  const methodName = parts[1];
                  if (pluginName && methodName) {
                    // Validate plugin exists before calling
                    if (!api.plugins.has(pluginName)) {
                      throw new Error(
                        `Plugin "${pluginName}" not found. Available plugins: ${api.plugins.list().join(", ") || "none"}`
                      );
                    }
                    const result = await api.plugins.call(pluginName, methodName, ...Object.values(args));
                    toolResults.push({ tool: toolName, result });
                  } else {
                    throw new Error(`Invalid plugin tool name format: ${toolName}. Expected format: pluginName_methodName`);
                  }
                } else {
                  // Unknown tool - provide helpful error
                  const suggestions = systemToolNames.filter(t => 
                    t.startsWith(toolName) || (toolName.startsWith("list") && t.includes("list"))
                  );
                  throw new Error(
                    `Unknown tool: "${toolName}". ` +
                    `Available system tools: ${systemToolNames.join(", ")}. ` +
                    (suggestions.length > 0 ? `Did you mean: ${suggestions.join(" or ")}?` : "")
                  );
                }
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`❌ Error executing tool "${toolCall.name}": ${errorMessage}`);
                toolResults.push({ tool: toolCall.name, result: `Error: ${errorMessage}` });
              }
            }

            // Build follow-up message with tool results
            const toolResultsText = toolResults
              .map(tr => `Tool: ${tr.tool}\nResult: ${JSON.stringify(tr.result, null, 2)}`)
              .join("\n\n");
            
            userQuestion = `${options.question}\n\nTool execution results:\n${toolResultsText}\n\nPlease provide a clear answer based on this information.`;
          }
          // If no tool calls were returned, continue with regular chat
          // (The message from callTools might be incomplete if JSON parsing failed)
        } catch (error) {
          // If tool calling fails, continue with regular chat
          // Pattern-based detection already handled common cases
        }
      }
      
      if (toolResults.length > 0) {
        console.log("🔧 Gathered information from tools\n");
      }

      // Final response with tool results (if any) or direct answer
      // Simplify prompt if we have tool results
      if (toolResults.length > 0) {
        const toolData = toolResults.map(tr => 
          `${tr.tool} returned: ${JSON.stringify(tr.result)}`
        ).join("\n");
        messages.push({
          role: "user",
          content: `Question: ${options.question}\n\nTool Results:\n${toolData}\n\nProvide a brief, clear answer based on the tool results above.`,
        });
      } else {
        messages.push({
          role: "user",
          content: userQuestion,
        });
      }

      // Get response with timeout (use non-streaming for reliability)
      let fullResponse = "";
      
      // If we have tool results, format them nicely first
      if (toolResults.length > 0) {
        // Format tool results for display
        for (const tr of toolResults) {
          if (tr.tool === "list_files" && Array.isArray(tr.result)) {
            // Determine folder name from question
            const folderName = options.question.toLowerCase().includes("agent") ? "agents" : 
                              options.question.toLowerCase().includes("plugin") ? "plugins" : "folder";
            console.log(`\n📁 Files in ${folderName} folder:\n`);
            (tr.result as string[]).forEach(file => console.log(`  - ${file}`));
            fullResponse = `The ${folderName} folder contains ${(tr.result as string[]).length} files: ${(tr.result as string[]).join(", ")}`;
          } else if (tr.tool === "list_plugins" && typeof tr.result === "string") {
            console.log(`\n${tr.result}`);
            fullResponse = tr.result;
          } else if (tr.tool === "list_agents" && typeof tr.result === "string") {
            console.log(`\n${tr.result}`);
            fullResponse = tr.result;
          }
        }
        
        // Try to get AI response, but don't wait too long (optional enhancement)
        // Skip if we already have good formatted results
        if (toolResults.length > 0 && toolResults.some(tr => tr.tool === "list_files" || tr.tool === "list_plugins" || tr.tool === "list_agents")) {
          // We already displayed formatted results, skip AI response
          fullResponse = "Tool results displayed above";
        } else {
          try {
            process.stdout.write("\n💬 ");
            const chatPromise = api.ai.chat(messages);
            const timeoutPromise = new Promise<{ role: "assistant"; content: string }>((_, reject) => {
              setTimeout(() => reject(new Error("Response timeout")), 60000); // 1 minute
            });
            
            const response = await Promise.race([chatPromise, timeoutPromise]);
            if (response.content && response.content.trim()) {
              console.log(response.content);
              fullResponse = response.content;
            }
          } catch (error) {
            // AI response timed out, but we already showed tool results
            if (!(error as Error).message.includes("timeout")) {
              throw error;
            }
          }
        }
      } else {
        // No tool results, try AI response with streaming
        process.stdout.write("💬 ");
        let streamActive = true;
        let lastChunkTime = Date.now();
        
        try {
          const streamPromise = (async () => {
            for await (const chunk of api.ai.streamChat(messages)) {
              if (!streamActive) break;
              process.stdout.write(chunk);
              fullResponse += chunk;
              lastChunkTime = Date.now();
            }
          })();
          
          // 60 second timeout, but also check for inactivity (10 seconds without output)
          const timeoutPromise = new Promise((_, reject) => {
            const checkInterval = setInterval(() => {
              if (Date.now() - lastChunkTime > 10000 && fullResponse.length > 0) {
                // Got some response but stopped - consider it done
                streamActive = false;
                clearInterval(checkInterval);
                return; // Don't reject, just stop
              }
              if (Date.now() - lastChunkTime > 60000) {
                streamActive = false;
                clearInterval(checkInterval);
                reject(new Error("Response timeout"));
              }
            }, 1000);
          });
          
          await Promise.race([streamPromise, timeoutPromise]);
          process.stdout.write("\n");
        } catch (error) {
          if ((error as Error).message.includes("timeout")) {
            process.stdout.write("\n\n⚠️  Response timed out after 1 minute");
            if (fullResponse.trim()) {
              console.log(" (partial response shown above)");
            }
          } else {
            throw error;
          }
        }
      }

      // Add response to messages for context
      messages.push({
        role: "assistant",
        content: fullResponse,
      });

      if (options.showSources) {
        if (toolResults.length > 0) {
          console.log(`📚 Sources: Tools used: ${toolResults.map(tr => tr.tool).join(", ")}`);
        }
        console.log("📚 Additional sources: System context, documentation, and code structure");
      }
      return;
    }

    // Interactive mode
    console.log("\n🤖 Ronin Assistant - Ask me anything about Ronin!");
    console.log("Type 'exit' or 'quit' to end the conversation.\n");

    while (true) {
      const question = await readInput("> ");

      if (!question || question.toLowerCase() === "exit" || question.toLowerCase() === "quit") {
        console.log("\n👋 Goodbye!");
        break;
      }

      let userQuestion = question;
      let toolResults: Array<{ tool: string; result: unknown }> = [];

      // First pass: Check if AI wants to call tools
      let toolCallResponse;
      try {
        // Add timeout for tool calling (10 seconds)
        toolCallResponse = await Promise.race([
          api.ai.callTools(question, allTools, {}),
          new Promise<{ message: { role: "assistant"; content: string }; toolCalls: ToolCall[] }>((_, reject) =>
            setTimeout(() => reject(new Error("Tool calling timeout")), 60000) // 1 minute
          ),
        ]);

        // Execute tool calls if any
        if (toolCallResponse.toolCalls && toolCallResponse.toolCalls.length > 0) {
          process.stdout.write("\n🔧 Gathering information...\n");
          
          for (const toolCall of toolCallResponse.toolCalls) {
            try {
              const toolName = toolCall.name;
              const args = toolCall.arguments as Record<string, unknown>;
              
              // Define system tools first - these take precedence
              const systemToolNames = ["list_files", "read_file", "list_plugins", "list_agents", "get_system_info"];
              
              // Check if it's a system tool FIRST (before checking for plugin tools)
              if (systemToolNames.includes(toolName)) {
                // System tool
                const result = await executeTool(toolName, args, api, agentDir, pluginDir);
                toolResults.push({ tool: toolName, result });
              } else if (toolName.includes("_")) {
                // Plugin tool (format: pluginName_methodName)
                // Only treat as plugin if it's not a system tool
                const parts = toolName.split("_");
                const pluginName = parts[0];
                const methodName = parts[1];
                if (pluginName && methodName) {
                  // Validate plugin exists before calling
                  if (!api.plugins.has(pluginName)) {
                    throw new Error(
                      `Plugin "${pluginName}" not found. Available plugins: ${api.plugins.list().join(", ") || "none"}`
                    );
                  }
                  const result = await api.plugins.call(pluginName, methodName, ...Object.values(args));
                  toolResults.push({ tool: toolName, result });
                } else {
                  throw new Error(`Invalid plugin tool name format: ${toolName}. Expected format: pluginName_methodName`);
                }
              } else {
                // Unknown tool - provide helpful error
                const suggestions = systemToolNames.filter(t => 
                  t.startsWith(toolName) || (toolName.startsWith("list") && t.includes("list"))
                );
                throw new Error(
                  `Unknown tool: "${toolName}". ` +
                  `Available system tools: ${systemToolNames.join(", ")}. ` +
                  (suggestions.length > 0 ? `Did you mean: ${suggestions.join(" or ")}?` : "")
                );
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error(`❌ Error executing tool "${toolCall.name}": ${errorMessage}`);
              toolResults.push({ tool: toolCall.name, result: `Error: ${errorMessage}` });
            }
          }

          // Build follow-up message with tool results
          const toolResultsText = toolResults
            .map(tr => `Tool: ${tr.tool}\nResult: ${JSON.stringify(tr.result, null, 2)}`)
            .join("\n\n");
          
          userQuestion = `${question}\n\nTool execution results:\n${toolResultsText}\n\nPlease provide a clear answer based on this information.`;
        }
      } catch (error) {
        // If tool calling fails, continue with regular chat
        toolCallResponse = { message: { role: "assistant" as const, content: "" }, toolCalls: [] };
      }

      // Simplify prompt if we have tool results
      if (toolResults.length > 0) {
        const toolData = toolResults.map(tr => 
          `${tr.tool} returned: ${JSON.stringify(tr.result)}`
        ).join("\n");
        messages.push({
          role: "user",
          content: `Question: ${question}\n\nTool Results:\n${toolData}\n\nProvide a brief, clear answer based on the tool results above.`,
        });
      } else {
        messages.push({
          role: "user",
          content: userQuestion,
        });
      }

      try {
        // Get response with streaming and timeout
        let fullResponse = "";
        process.stdout.write("\n💬 ");
        let streamActive = true;
        let lastChunkTime = Date.now();
        const startTime = Date.now();
        
        try {
          const streamPromise = (async () => {
            for await (const chunk of api.ai.streamChat(messages)) {
              if (!streamActive) break;
              process.stdout.write(chunk);
              fullResponse += chunk;
              lastChunkTime = Date.now();
            }
          })();
          
          // 60 second timeout, but also check for inactivity (10 seconds without output)
          const timeoutPromise = new Promise((_, reject) => {
            const checkInterval = setInterval(() => {
              const elapsed = Date.now() - startTime;
              // If we got some response but stopped for 10 seconds, consider it done
              if (Date.now() - lastChunkTime > 10000 && fullResponse.length > 0) {
                streamActive = false;
                clearInterval(checkInterval);
                return; // Don't reject, just stop
              }
              // If total time exceeds 60 seconds, timeout
              if (elapsed > 60000) {
                streamActive = false;
                clearInterval(checkInterval);
                reject(new Error("Response timeout"));
              }
            }, 1000);
          });
          
          await Promise.race([streamPromise, timeoutPromise]);
          process.stdout.write("\n");
        } catch (error) {
          if ((error as Error).message.includes("timeout")) {
            process.stdout.write("\n\n⚠️  Response timed out after 1 minute");
            if (fullResponse.trim()) {
              console.log(" (partial response shown above)");
            } else {
              console.log(" - no response generated");
              if (toolResults.length > 0) {
                console.log("\nHere's the information gathered:");
                for (const tr of toolResults) {
                  console.log(`\n${tr.tool}:`);
                  console.log(JSON.stringify(tr.result, null, 2));
                }
              }
            }
          } else {
            throw error;
          }
        }

        // Add response to messages for context
        messages.push({
          role: "assistant",
          content: fullResponse,
        });

        if (options.showSources) {
          if (toolResults.length > 0) {
            console.log(`📚 Sources: Tools used: ${toolResults.map(tr => tr.tool).join(", ")}`);
          }
          console.log("📚 Additional sources: System context, documentation, and code structure\n");
        }
      } catch (error) {
        console.error(`\n❌ Error: ${error}`);
        console.log("Please try again.\n");
      }
    }
  } catch (error) {
    const errorMessage = (error as Error).message || String(error);
    if (errorMessage.includes("not found") || errorMessage.includes("Model")) {
      console.error(`\n❌ ${errorMessage}`);
      process.exit(1);
    }
    if (errorMessage.includes("Ollama API") || errorMessage.includes("Failed to fetch")) {
      console.error("❌ Ollama is not available. Please start Ollama first:");
      console.error("   ollama serve");
      process.exit(1);
    }
    throw error;
  }
}

