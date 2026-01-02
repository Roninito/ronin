import type { AgentConstructor, AgentMetadata } from "../types/agent.js";
import type { AgentAPI } from "../types/api.js";
import { readdir } from "fs/promises";
import { join, extname } from "path";

export interface LoadAgentOptions {
  agentDir?: string;
  api: AgentAPI;
}

/**
 * Discovers and loads agent files from a directory
 */
export class AgentLoader {
  private agentDir: string;
  private externalAgentDir: string | null;

  constructor(agentDir: string = "./agents") {
    this.agentDir = agentDir;
    // Check for external agent directory from environment variable
    this.externalAgentDir = process.env.RONIN_EXTERNAL_AGENT_DIR || null;
  }

  /**
   * Discover all agent files in the agent directory (recursively)
   * Also checks external agent directory if RONIN_EXTERNAL_AGENT_DIR is set
   */
  async discoverAgents(): Promise<string[]> {
    const files: string[] = [];
    
    // Discover agents in local directory
    await this.discoverRecursive(this.agentDir, files);
    
    // Discover agents in external directory if set
    if (this.externalAgentDir) {
      try {
        await this.discoverRecursive(this.externalAgentDir, files);
      } catch (error) {
        // External directory might not exist, that's okay
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`Warning: Could not read external agent directory ${this.externalAgentDir}:`, error);
        }
      }
    }
    
    return files.filter(file => !file.includes(".test.") && !file.includes(".spec."));
  }

  /**
   * Recursively discover files in a directory
   */
  private async discoverRecursive(dir: string, files: string[]): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await this.discoverRecursive(fullPath, files);
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          if (ext === ".ts" || ext === ".js") {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Directory might not exist, ignore
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Error reading directory ${dir}:`, error);
      }
    }
  }

  /**
   * Load a single agent file
   */
  async loadAgent(filePath: string, api: AgentAPI): Promise<AgentMetadata | null> {
    try {
      // Dynamic import of the agent file
      const module = await import(filePath);
      
      // Get the default export (should be the agent class)
      const AgentClass = module.default;
      
      if (!AgentClass) {
        console.warn(`No default export found in ${filePath}`);
        return null;
      }

      // Validate it's a constructor function
      if (typeof AgentClass !== "function") {
        console.warn(`Default export in ${filePath} is not a constructor`);
        return null;
      }

      // Check if it has the required execute method (will be checked when instantiated)
      const agentConstructor = AgentClass as AgentConstructor;
      
      // Extract agent name from file path
      const name = this.extractAgentName(filePath);
      
      // Instantiate the agent
      const instance = new agentConstructor(api);

      // Validate instance has execute method
      if (typeof instance.execute !== "function") {
        console.warn(`Agent ${name} does not have an execute method`);
        return null;
      }

      return {
        name,
        filePath,
        schedule: agentConstructor.schedule,
        watch: agentConstructor.watch,
        webhook: agentConstructor.webhook,
        instance,
      };
    } catch (error) {
      console.error(`Failed to load agent from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Load all agents from the agent directory
   */
  async loadAllAgents(api: AgentAPI): Promise<AgentMetadata[]> {
    const files = await this.discoverAgents();
    const agents: AgentMetadata[] = [];

    for (const file of files) {
      const agent = await this.loadAgent(file, api);
      if (agent) {
        agents.push(agent);
      }
    }

    return agents;
  }

  /**
   * Extract agent name from file path
   */
  private extractAgentName(filePath: string): string {
    const basename = filePath.split("/").pop() || filePath;
    return basename.replace(/\.(ts|js)$/, "");
  }
}

