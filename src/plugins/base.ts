/**
 * Plugin interface definition
 */
export interface Plugin {
  /**
   * Plugin name (must be unique)
   */
  name: string;

  /**
   * Plugin description
   */
  description: string;

  /**
   * Plugin methods - functions that can be called via api.plugins.call()
   */
  methods: Record<string, (...args: unknown[]) => unknown | Promise<unknown>>;
}

/**
 * Plugin metadata after loading
 */
export interface PluginMetadata {
  name: string;
  description: string;
  methods: string[];
  filePath: string;
  plugin: Plugin;
}

