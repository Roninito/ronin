type Plugin = Record<string, (...args: unknown[]) => unknown | Promise<unknown>>;

export class PluginsAPI {
  private plugins: Map<string, Plugin> = new Map();

  /**
   * Register a plugin
   */
  register(name: string, plugin: Plugin): void {
    this.plugins.set(name, plugin);
  }

  /**
   * Call a plugin method
   */
  async call(pluginName: string, method: string, ...args: unknown[]): Promise<unknown> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginName}`);
    }

    const fn = plugin[method];
    if (typeof fn !== "function") {
      throw new Error(`Method ${method} not found in plugin ${pluginName}`);
    }

    return await fn(...args);
  }

  /**
   * Check if a plugin is registered
   */
  has(pluginName: string): boolean {
    return this.plugins.has(pluginName);
  }

  /**
   * Get all registered plugin names
   */
  list(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Get methods for a plugin (for remote model access)
   */
  getMethods(pluginName: string): Plugin | null {
    return this.plugins.get(pluginName) || null;
  }
}

