import { watch } from "fs";
import { join, dirname, basename, extname } from "path";
import { existsSync } from "fs";
import type { AgentRegistry } from "./AgentRegistry.js";
import type { AgentAPI } from "../types/api.js";

interface HotReloadOptions {
  agentsDir: string;
  externalAgentsDir: string;
  registry: AgentRegistry;
  api: AgentAPI;
}

interface ReloadResult {
  success: boolean;
  agentName?: string;
  error?: string;
  routes?: string[];
  schedules?: string[];
  stable?: boolean;
}

/**
 * Hot Reload Service
 * 
 * Watches agent directories for new/changed files and loads them
 * without restarting the entire Ronin system.
 */
export class HotReloadService {
  private agentsDir: string;
  private externalAgentsDir: string;
  private registry: AgentRegistry;
  private api: AgentAPI;
  private watchers: Map<string, ReturnType<typeof watch>> = new Map();
  private loadedAgents: Map<string, string> = new Map(); // filePath -> agentName
  private stabilityCheckDuration = 10000; // 10 seconds

  constructor(options: HotReloadOptions) {
    this.agentsDir = options.agentsDir;
    this.externalAgentsDir = options.externalAgentsDir;
    this.registry = options.registry;
    this.api = options.api;
  }

  /**
   * Start watching agent directories
   */
  start(): void {
    console.log("[hot-reload] Starting file watchers...");
    
    // Watch built-in agents directory
    if (existsSync(this.agentsDir)) {
      this.watchDirectory(this.agentsDir);
    }
    
    // Watch external agents directory
    if (existsSync(this.externalAgentsDir)) {
      this.watchDirectory(this.externalAgentsDir);
    }
  }

  /**
   * Stop all watchers
   */
  stop(): void {
    console.log("[hot-reload] Stopping file watchers...");
    for (const [path, watcher] of this.watchers) {
      watcher.close();
      console.log(`[hot-reload] Stopped watching: ${path}`);
    }
    this.watchers.clear();
  }

  /**
   * Watch a directory for changes
   */
  private watchDirectory(dir: string): void {
    const watcher = watch(dir, { recursive: false }, (eventType, filename) => {
      if (!filename) return;
      
      // Only process .ts files
      if (!filename.endsWith('.ts')) return;
      
      const filePath = join(dir, filename);
      
      // Debounce - wait for file to be fully written
      setTimeout(() => {
        this.handleFileChange(filePath, eventType);
      }, 100);
    });

    this.watchers.set(dir, watcher);
    console.log(`[hot-reload] Watching: ${dir}`);
  }

  /**
   * Handle file change event
   */
  private async handleFileChange(filePath: string, eventType: string): Promise<void> {
    if (eventType === 'rename' || eventType === 'change') {
      if (!existsSync(filePath)) {
        // File deleted - ignore for now (could add unload later)
        return;
      }

      // Check if already loaded (reload) or new
      const isReload = this.loadedAgents.has(filePath);
      
      if (isReload) {
        console.log(`[hot-reload] Detected change in: ${basename(filePath)}`);
      } else {
        console.log(`[hot-reload] Detected new agent: ${basename(filePath)}`);
      }

      // Load the agent
      const result = await this.loadAgent(filePath);
      
      if (result.success) {
        // Emit event for other agents to track
        this.api.events.emit(isReload ? 'agent_reloaded' : 'agent_created', {
          agentName: result.agentName,
          filePath,
          routes: result.routes,
          schedules: result.schedules,
          stable: result.stable,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Load an agent from file
   */
  async loadAgent(filePath: string): Promise<ReloadResult> {
    try {
      // Check file exists
      if (!existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }

      // Import the agent module
      const module = await import(filePath + '?t=' + Date.now()); // Cache bust
      const AgentClass = module.default;

      if (!AgentClass) {
        return { success: false, error: `No default export found in ${filePath}` };
      }

      // Get agent name from class or filename
      const agentName = AgentClass.name || basename(filePath, '.ts');

      // Check if agent is already registered
      const existingAgent = this.registry.get(agentName);
      if (existingAgent) {
        console.log(`[hot-reload] Reloading agent: ${agentName}`);
        // Unload existing first
        this.registry.unregister(agentName);
      }

      // Instantiate the agent
      const agentInstance = new AgentClass(this.api);

      // Extract metadata
      const metadata = {
        name: agentName,
        description: AgentClass.description || `${agentName} agent`,
        schedule: AgentClass.schedule,
        watch: AgentClass.watch,
        webhook: AgentClass.webhook,
        instance: agentInstance,
      };

      // Register with the registry
      this.registry.register(metadata);
      this.loadedAgents.set(filePath, agentName);

      // Collect info about what was registered
      const routes: string[] = [];
      const schedules: string[] = [];

      if (metadata.webhook) {
        routes.push(metadata.webhook);
      }
      
      // Check for HTTP routes registered by the agent
      if (agentInstance.routes) {
        routes.push(...agentInstance.routes);
      }

      if (metadata.schedule) {
        schedules.push(metadata.schedule);
      }

      console.log(`[hot-reload] ✅ Loaded agent: ${agentName}`);
      if (routes.length > 0) {
        console.log(`[hot-reload]   Routes: ${routes.join(', ')}`);
      }
      if (schedules.length > 0) {
        console.log(`[hot-reload]   Schedules: ${schedules.join(', ')}`);
      }

      // Start stability observation
      const isStable = await this.observeStability(agentName, agentInstance);

      return {
        success: true,
        agentName,
        routes,
        schedules,
        stable: isStable,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[hot-reload] ❌ Failed to load agent: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Observe agent for stability
   */
  private async observeStability(agentName: string, agentInstance: any): Promise<boolean> {
    console.log(`[hot-reload] Observing ${agentName} for ${this.stabilityCheckDuration}ms...`);
    
    return new Promise((resolve) => {
      let errors = 0;
      let errorHandler: (err: Error) => void;

      // Track errors during observation period
      errorHandler = (err: Error) => {
        errors++;
        console.error(`[hot-reload] ⚠️  Error observed in ${agentName}:`, err.message);
      };

      // Listen for errors if agent has error event
      if (agentInstance.on) {
        agentInstance.on('error', errorHandler);
      }

      // Wait for observation period
      setTimeout(() => {
        // Cleanup
        if (agentInstance.off) {
          agentInstance.off('error', errorHandler);
        }

        const isStable = errors === 0;
        if (isStable) {
          console.log(`[hot-reload] ✅ ${agentName} is stable`);
        } else {
          console.log(`[hot-reload] ⚠️  ${agentName} had ${errors} errors during observation`);
        }
        
        resolve(isStable);
      }, this.stabilityCheckDuration);
    });
  }

  /**
   * Get list of loaded agents
   */
  getLoadedAgents(): Array<{ filePath: string; agentName: string }> {
    return Array.from(this.loadedAgents.entries()).map(([filePath, agentName]) => ({
      filePath,
      agentName,
    }));
  }

  /**
   * Check if agent is loaded from specific file
   */
  isLoaded(filePath: string): boolean {
    return this.loadedAgents.has(filePath);
  }
}
