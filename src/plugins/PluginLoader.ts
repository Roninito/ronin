import { readdir } from "fs/promises";
import { join, extname } from "path";
import type { Plugin, PluginMetadata } from "./base.js";

export interface PluginLoaderOptions {
  pluginDir?: string;
}

/**
 * Discovers and loads plugins from a directory
 */
export class PluginLoader {
  private pluginDir: string;

  constructor(pluginDir: string = "./plugins") {
    this.pluginDir = pluginDir;
  }

  /**
   * Discover all plugin files in the plugin directory (recursively)
   */
  async discoverPlugins(): Promise<string[]> {
    const files: string[] = [];
    await this.discoverRecursive(this.pluginDir, files);
    return files.filter(
      (file) => !file.includes(".test.") && !file.includes(".spec.")
    );
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
        console.warn(`Error reading plugin directory ${dir}:`, error);
      }
    }
  }

  /**
   * Load a single plugin file
   */
  async loadPlugin(filePath: string): Promise<PluginMetadata | null> {
    try {
      // Dynamic import of the plugin file
      const module = await import(filePath);

      // Get the default export (should be the plugin object)
      const plugin = module.default;

      if (!plugin) {
        console.warn(`No default export found in ${filePath}`);
        return null;
      }

      // Validate plugin structure
      if (typeof plugin !== "object" || plugin === null) {
        console.warn(`Default export in ${filePath} is not an object`);
        return null;
      }

      if (!plugin.name || typeof plugin.name !== "string") {
        console.warn(`Plugin in ${filePath} missing or invalid name`);
        return null;
      }

      if (!plugin.description || typeof plugin.description !== "string") {
        console.warn(`Plugin ${plugin.name} missing or invalid description`);
        return null;
      }

      if (!plugin.methods || typeof plugin.methods !== "object") {
        console.warn(`Plugin ${plugin.name} missing or invalid methods`);
        return null;
      }

      const pluginObj = plugin as Plugin;
      const methodNames = Object.keys(pluginObj.methods);

      return {
        name: pluginObj.name,
        description: pluginObj.description,
        methods: methodNames,
        filePath,
        plugin: pluginObj,
      };
    } catch (error) {
      console.error(`Failed to load plugin from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Load all plugins from the plugin directory
   */
  async loadAllPlugins(): Promise<PluginMetadata[]> {
    const files = await this.discoverPlugins();
    const plugins: PluginMetadata[] = [];

    for (const file of files) {
      const plugin = await this.loadPlugin(file);
      if (plugin) {
        plugins.push(plugin);
      }
    }

    return plugins;
  }
}

