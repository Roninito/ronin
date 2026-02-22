import type { Plugin } from "../src/plugins/base.js";
import type { AgentAPI } from "../src/types/api.js";
import { Ollama } from "@langchain/community/llms/ollama";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { createToolCallingAgent, AgentExecutor } from "langchain/agents";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { StateGraph, END } from "@langchain/langgraph";
import { getConfigService } from "../src/config/ConfigService.js";

// Configurable defaults - will be overridden by ConfigService when available
const getDefaults = () => {
  try {
    const configService = getConfigService();
    const configAI = configService.getAI();
    return {
      ollamaUrl: configAI.ollamaUrl,
      model: configAI.ollamaModel,
    };
  } catch {
    // Fallback to env vars if config service not initialized
    return {
      ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
      model: process.env.OLLAMA_MODEL || "ministral-3:3b",
    };
  }
};

/**
 * LangChain integration plugin for Ronin
 * Provides chains, agents, and graph-based workflows
 */
const langchainPlugin: Plugin = {
  name: "langchain",
  description: "LangChain integration for chains, agents, and graph workflows",
  methods: {
    /**
     * Execute a simple LangChain chain
     */
    runChain: async (promptTemplate: string, input: Record<string, any>, api?: AgentAPI) => {
      const defaults = getDefaults();
      const model = new Ollama({
        model: defaults.model,
        baseUrl: defaults.ollamaUrl,
      });

      const prompt = ChatPromptTemplate.fromMessages([
        ["system", "You are a helpful assistant."],
        ["human", promptTemplate],
      ]);

      const chain = prompt.pipe(model);
      const result = await chain.invoke(input);
      return typeof result === "string" ? result : result.content;
    },

    /**
     * Execute a LangChain agent with tools
     */
    runAgent: async (query: string, tools: any[] = [], api?: AgentAPI) => {
      const defaults = getDefaults();
      const model = new Ollama({
        model: defaults.model,
        baseUrl: defaults.ollamaUrl,
      });

      // Wrap Ronin plugins as LangChain tools if API is provided
      const roninTools = api ? await wrapRoninPluginsAsTools(api) : [];
      const allTools = [...roninTools, ...tools];

      const agent = createToolCallingAgent({
        llm: model,
        tools: allTools,
        prompt: ChatPromptTemplate.fromMessages([
          ["system", "You are an agent using tools to accomplish tasks."],
          ["human", "{input}"],
        ]),
      });

      const executor = new AgentExecutor({ agent, tools: allTools });
      const result = await executor.invoke({ input: query });
      return result.output;
    },

    /**
     * Build LangGraph for agent creation workflow
     */
    buildAgentCreationGraph: async (
      cancellationToken?: { isCancelled: boolean },
      api?: AgentAPI
    ) => {
      const defaults = getDefaults();
      const model = new Ollama({
        model: defaults.model,
        baseUrl: defaults.ollamaUrl,
      });

      // Wrap Ronin plugins as tools
      const roninTools = api ? await wrapRoninPluginsAsTools(api) : [];

      // Planner Node
      async function plannerNode(state: any) {
        if (cancellationToken?.isCancelled) {
          throw new Error("Creation cancelled");
        }

        const prompt = ChatPromptTemplate.fromMessages([
          [
            "system",
            "You are a planning agent. Analyze the task and create a detailed plan in JSON format with: subtasks (array), tools (array of needed tools), tests (array of test criteria).",
          ],
          ["human", "Plan agent for task: {task}"],
        ]);

        const chain = prompt.pipe(model);
        const planText = await chain.invoke({ task: state.task });
        const planContent = typeof planText === "string" ? planText : planText.content;

        // Try to parse JSON from response
        let plan;
        try {
          const jsonMatch = planContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            plan = JSON.parse(jsonMatch[0]);
          } else {
            plan = { subtasks: [], tools: [], tests: [] };
          }
        } catch {
          plan = { subtasks: [], tools: [], tests: [] };
        }

        return { plan };
      }

      // Researcher Node
      async function researcherNode(state: any) {
        if (cancellationToken?.isCancelled) {
          throw new Error("Creation cancelled");
        }

        if (!state.plan?.needsResearch && !state.plan?.subtasks?.some((s: any) => s.includes("research"))) {
          return { research: null, plan: state.plan };
        }

        const webSearchTool = roninTools.find((t) => t.name === "ronin_web_search");
        if (!webSearchTool) {
          return { research: null, plan: state.plan };
        }

        const agent = createToolCallingAgent({
          llm: model,
          tools: [webSearchTool],
          prompt: ChatPromptTemplate.fromMessages([
            ["system", "Research information needed for the agent plan."],
            ["human", "Research for plan: {plan}"],
          ]),
        });

        const executor = new AgentExecutor({ agent, tools: [webSearchTool] });
        const research = await executor.invoke({
          plan: JSON.stringify(state.plan),
        });

        return { research: research.output, plan: { ...state.plan, augmented: true } };
      }

      // Coder Node
      async function coderNode(state: any) {
        if (cancellationToken?.isCancelled) {
          throw new Error("Creation cancelled");
        }

        const prompt = ChatPromptTemplate.fromMessages([
          [
            "system",
            `You are a TypeScript code generator for Ronin agents. Generate complete, working code that:
- Extends BaseAgent from "@ronin/agent/index.js"
- Imports AgentAPI type from "@ronin/types/index.js"
- Has a constructor that calls super(api)
- Implements execute() method
- Optionally includes static schedule, watch, or webhook properties
- Uses this.api for accessing Ronin APIs

Generate ONLY the TypeScript code, no explanations.`,
          ],
          [
            "human",
            "Generate Ronin agent code from plan: {plan} and research: {research}",
          ],
        ]);

        const chain = prompt.pipe(model);
        const codeResult = await chain.invoke({
          plan: JSON.stringify(state.plan),
          research: state.research || "",
        });

        const codeContent = typeof codeResult === "string" ? codeResult : codeResult.content;
        
        // Extract code from markdown code blocks if present
        const codeBlockMatch = codeContent.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)```/);
        const code = codeBlockMatch ? codeBlockMatch[1] : codeContent;

        return { code: code.trim() };
      }

      // Tester Node
      async function testerNode(state: any) {
        if (cancellationToken?.isCancelled) {
          throw new Error("Creation cancelled");
        }

        const shellTool = roninTools.find((t) => t.name === "ronin_shell");
        if (!shellTool) {
          return { finalCode: state.code, passed: true, errors: null };
        }

        const agent = createToolCallingAgent({
          llm: model,
          tools: [shellTool],
          prompt: ChatPromptTemplate.fromMessages([
            [
              "system",
              "Test the generated code. Check for syntax errors, missing imports, and basic validation. Return 'passed: true' if valid, or 'passed: false' with errors if invalid.",
            ],
            [
              "human",
              "Test code: {code} against criteria: {tests}",
            ],
          ]),
        });

        const executor = new AgentExecutor({ agent, tools: [shellTool] });
        const result = await executor.invoke({
          code: state.code,
          tests: JSON.stringify(state.plan?.tests || []),
        });

        const output = result.output.toLowerCase();
        const passed = output.includes("passed: true") || output.includes("valid");
        const errors = passed ? null : result.output;

        return { finalCode: state.code, passed, errors };
      }

      // Build graph
      const graph = new StateGraph({
        channels: {
          task: { reducer: (x: any, y: any) => y ?? x, default: () => "" },
          plan: { reducer: (x: any, y: any) => y ?? x, default: () => null },
          research: { reducer: (x: any, y: any) => y ?? x, default: () => null },
          code: { reducer: (x: any, y: any) => y ?? x, default: () => "" },
          finalCode: { reducer: (x: any, y: any) => y ?? x, default: () => "" },
          passed: { reducer: (x: any, y: any) => y ?? x, default: () => false },
          errors: { reducer: (x: any, y: any) => y ?? x, default: () => null },
        },
      })
        .addNode("planner", plannerNode)
        .addNode("researcher", researcherNode)
        .addNode("coder", coderNode)
        .addNode("tester", testerNode)
        .addEdge("planner", "researcher")
        .addEdge("researcher", "coder")
        .addEdge("coder", "tester")
        .addConditionalEdges("tester", (state: any) => {
          if (cancellationToken?.isCancelled) {
            return END;
          }
          return state.passed ? END : "coder";
        })
        .setEntryPoint("planner");

      return graph.compile();
    },

    /**
     * Run analysis chain for chat queries
     */
    runAnalysisChain: async (input: string, dataSource?: string, api?: AgentAPI) => {
      const defaults = getDefaults();
      const model = new Ollama({
        model: defaults.model,
        baseUrl: defaults.ollamaUrl,
      });

      const tools = api ? await wrapRoninPluginsAsTools(api) : [];

      const agent = createToolCallingAgent({
        llm: model,
        tools,
        prompt: ChatPromptTemplate.fromMessages([
          [
            "system",
            "You are an analysis agent. Use available tools to gather data and provide comprehensive analysis.",
          ],
          ["human", "Analyze: {input}"],
        ]),
      });

      const executor = new AgentExecutor({ agent, tools });
      const result = await executor.invoke({ input });
      return result.output;
    },

    /**
     * Build research graph for multi-step research workflows
     */
    buildResearchGraph: async (api?: AgentAPI) => {
      const defaults = getDefaults();
      const model = new Ollama({
        model: defaults.model,
        baseUrl: defaults.ollamaUrl,
      });

      const tools = api ? await wrapRoninPluginsAsTools(api) : [];

      // Fetch Node
      async function fetchNode(state: any) {
        const fetchTool = tools.find((t) => t.name === "ronin_rss_query" || t.name === "ronin_web_search");
        if (!fetchTool) {
          return { data: null };
        }

        const agent = createToolCallingAgent({
          llm: model,
          tools: [fetchTool],
          prompt: ChatPromptTemplate.fromMessages([
            ["system", "Fetch data from available sources."],
            ["human", "Fetch: {query}"],
          ]),
        });

        const executor = new AgentExecutor({ agent, tools: [fetchTool] });
        const result = await executor.invoke({ query: state.query });
        return { data: result.output };
      }

      // Analyze Node
      async function analyzeNode(state: any) {
        const prompt = ChatPromptTemplate.fromMessages([
          ["system", "Analyze the provided data and extract key insights."],
          ["human", "Analyze: {data}"],
        ]);

        const chain = prompt.pipe(model);
        const result = await chain.invoke({ data: state.data || "" });
        const analysis = typeof result === "string" ? result : result.content;
        return { analysis };
      }

      // Synthesize Node
      async function synthesizeNode(state: any) {
        const prompt = ChatPromptTemplate.fromMessages([
          ["system", "Synthesize insights into a comprehensive summary."],
          ["human", "Synthesize: {analysis}"],
        ]);

        const chain = prompt.pipe(model);
        const result = await chain.invoke({ analysis: state.analysis || "" });
        const synthesis = typeof result === "string" ? result : result.content;
        return { synthesis };
      }

      const graph = new StateGraph({
        channels: {
          query: { reducer: (x: any, y: any) => y ?? x, default: () => "" },
          data: { reducer: (x: any, y: any) => y ?? x, default: () => null },
          analysis: { reducer: (x: any, y: any) => y ?? x, default: () => "" },
          synthesis: { reducer: (x: any, y: any) => y ?? x, default: () => "" },
        },
      })
        .addNode("fetch", fetchNode)
        .addNode("analyze", analyzeNode)
        .addNode("synthesize", synthesizeNode)
        .addEdge("fetch", "analyze")
        .addEdge("analyze", "synthesize")
        .addEdge("synthesize", END)
        .setEntryPoint("fetch");

      return graph.compile();
    },
  },
};

/**
 * Wrap Ronin plugins as LangChain tools
 */
async function wrapRoninPluginsAsTools(api: AgentAPI): Promise<any[]> {
  const tools: any[] = [];

  // Shell tool
  if (api.shell) {
    tools.push(
      tool(
        async ({ command }: { command: string }) => {
          const result = await api.shell!.exec(command);
          return JSON.stringify(result);
        },
        {
          name: "ronin_shell",
          description: "Execute shell commands via Ronin",
          schema: z.object({ command: z.string() }),
        }
      )
    );
  }

  // Web scraper tool
  if (api.scrape) {
    tools.push(
      tool(
        async ({ url, instructions }: { url: string; instructions?: string }) => {
          const result = await api.scrape!.scrape_to_markdown(url, { instructions });
          return JSON.stringify(result);
        },
        {
          name: "ronin_web_search",
          description: "Scrape web pages and search for information",
          schema: z.object({
            url: z.string(),
            instructions: z.string().optional(),
          }),
        }
      )
    );
  }

  // RSS query tool - query RSS feed database directly
  if (api.db) {
    tools.push(
      tool(
        async ({ topic, limit, category }: { topic?: string; limit?: number; category?: string }) => {
          try {
            let query = "SELECT id, feed_url, link, title, published_at, summary FROM items";
            const params: any[] = [];
            const conditions: string[] = [];

            // Filter by topic (search in title/summary)
            if (topic) {
              conditions.push("(title LIKE ? OR summary LIKE ?)");
              const searchTerm = `%${topic}%`;
              params.push(searchTerm, searchTerm);
            }

            // Filter by category (requires feed_url mapping, simplified here)
            if (category) {
              conditions.push("feed_url LIKE ?");
              params.push(`%${category}%`);
            }

            if (conditions.length > 0) {
              query += " WHERE " + conditions.join(" AND ");
            }

            query += " ORDER BY published_at DESC LIMIT ?";
            params.push(limit || 10);

            const results = await api.db.query(query, params);
            return JSON.stringify(results);
          } catch (error) {
            return `Error querying RSS: ${(error as Error).message}`;
          }
        },
        {
          name: "ronin_rss_query",
          description: "Query RSS feeds by topic, category, or get recent items",
          schema: z.object({
            topic: z.string().optional().describe("Search term to find in titles/summaries"),
            limit: z.number().optional().describe("Maximum number of results (default: 10)"),
            category: z.string().optional().describe("Filter by category"),
          }),
        }
      )
    );
  }

  // File operations tool
  if (api.files) {
    tools.push(
      tool(
        async ({ path, operation, content }: { path: string; operation: "read" | "write"; content?: string }) => {
          if (operation === "read") {
            return await api.files.read(path);
          } else if (operation === "write" && content) {
            await api.files.write(path, content);
            return "File written successfully";
          }
          return "Invalid operation";
        },
        {
          name: "ronin_files",
          description: "Read and write files via Ronin",
          schema: z.object({
            path: z.string(),
            operation: z.enum(["read", "write"]),
            content: z.string().optional(),
          }),
        }
      )
    );
  }

  // Skills tools (AgentSkills: discover, explore, use)
  if (api.skills) {
    tools.push(
      tool(
        async ({ query }: { query: string }) => {
          const result = await api.skills!.discover_skills(query);
          return JSON.stringify(result);
        },
        {
          name: "ronin_skills_discover",
          description: "Discover skills by query. Returns lite listing (name, description) of matching skills.",
          schema: z.object({ query: z.string().describe("What the skill should do (e.g. log monitoring)") }),
        }
      ),
      tool(
        async ({ skill_name, include_scripts }: { skill_name: string; include_scripts?: boolean }) => {
          const result = await api.skills!.explore_skill(skill_name, include_scripts);
          return JSON.stringify(result);
        },
        {
          name: "ronin_skills_explore",
          description: "Get full skill details: instructions, abilities, optional script contents.",
          schema: z.object({
            skill_name: z.string(),
            include_scripts: z.boolean().optional().describe("Include script file contents"),
          }),
        }
      ),
      tool(
        async ({
          skill_name,
          ability,
          params,
          pipeline,
        }: {
          skill_name: string;
          ability?: string;
          params?: Record<string, unknown>;
          pipeline?: string[];
        }) => {
          const result = await api.skills!.use_skill(skill_name, {
            ability,
            params: params ?? {},
            pipeline,
          });
          return JSON.stringify(result);
        },
        {
          name: "ronin_skills_use",
          description: "Run a skill: single ability or pipeline of abilities with params.",
          schema: z.object({
            skill_name: z.string(),
            ability: z.string().optional(),
            params: z.record(z.unknown()).optional(),
            pipeline: z.array(z.string()).optional().describe("Ordered ability names to run"),
          }),
        }
      )
    );
  }

  return tools;
}

export default langchainPlugin;
