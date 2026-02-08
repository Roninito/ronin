import { readdir, copyFile, mkdir } from "fs/promises";
import { join, extname, basename, dirname } from "path";
import { existsSync } from "fs";
import type { Plugin, PluginMetadata } from "./base.js";

export interface PluginLoaderOptions {
  builtinPluginDir?: string;
  userPluginDir?: string;
}

/**
 * Discovers and loads plugins from multiple directories
 * User plugins in ~/.ronin/plugins take precedence over built-in plugins
 */
export class PluginLoader {
  private builtinPluginDir: string;
  private userPluginDir: string | null;

  constructor(
    builtinPluginDir: string = "./plugins",
    userPluginDir: string | null = null
  ) {
    this.builtinPluginDir = builtinPluginDir;
    this.userPluginDir = userPluginDir;
  }

  /**
   * Discover all plugin files from both built-in and user directories
   * User plugins override built-in plugins with the same name
   */
  async discoverPlugins(): Promise<string[]> {
    const builtinFiles: string[] = [];
    const userFiles: string[] = [];

    // Discover built-in plugins
    await this.discoverRecursive(this.builtinPluginDir, builtinFiles);

    // Discover user plugins (if user directory is set and different from builtin)
    if (this.userPluginDir && this.userPluginDir !== this.builtinPluginDir) {
      await this.discoverRecursive(this.userPluginDir, userFiles);
    }

    // Combine files, with user plugins taking precedence
    const allFiles = [...builtinFiles, ...userFiles];
    
    // Remove duplicates based on filename (user plugins override built-in)
    const seenNames = new Set<string>();
    const uniqueFiles: string[] = [];
    
    // Process user files first (they take precedence)
    for (const file of userFiles) {
      const name = this.getPluginName(file);
      if (name && !seenNames.has(name)) {
        seenNames.add(name);
        uniqueFiles.push(file);
      }
    }
    
    // Then add built-in files that haven't been overridden
    for (const file of builtinFiles) {
      const name = this.getPluginName(file);
      if (name && !seenNames.has(name)) {
        seenNames.add(name);
        uniqueFiles.push(file);
      }
    }

    return uniqueFiles.filter(
      (file) => !file.includes(".test.") && !file.includes(".spec.")
    );
  }

  /**
   * Get plugin name from file path (used for deduplication)
   */
  private getPluginName(filePath: string): string | null {
    const ext = extname(filePath);
    if (ext === ".ts" || ext === ".js") {
      return basename(filePath, ext);
    }
    return null;
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
   * Load all plugins from both directories
   * User plugins override built-in plugins
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

  /**
   * Copy built-in plugins to user directory on first run
   * This allows users to customize built-in plugins
   */
  async copyBuiltinsToUser(userPluginDir: string): Promise<void> {
    try {
      // Ensure user plugin directory exists
      if (!existsSync(userPluginDir)) {
        await mkdir(userPluginDir, { recursive: true });
      }

      // Discover built-in plugins
      const builtinFiles: string[] = [];
      await this.discoverRecursive(this.builtinPluginDir, builtinFiles);

      // Copy each plugin to user directory
      for (const file of builtinFiles) {
        const filename = basename(file);
        const userPath = join(userPluginDir, filename);
        
        // Only copy if user doesn't already have this plugin
        if (!existsSync(userPath)) {
          await copyFile(file, userPath);
          console.log(`📋 Copied built-in plugin to user directory: ${filename}`);
        }
      }
    } catch (error) {
      console.warn("Failed to copy built-in plugins to user directory:", error);
    }
  }
}

