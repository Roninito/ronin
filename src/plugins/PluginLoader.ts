import { readdir, copyFile, mkdir } from "fs/promises";
import { join, extname, basename, dirname } from "path";
import { existsSync } from "fs";
import { pathToFileURL } from "url";
import type { Plugin, PluginMetadata } from "./base.js";
import { logger } from "../utils/logger.js";

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

    // Prefer dist/index.js over src/index.ts, and filter out non-plugin files
    const pluginFiles = this.filterPluginFiles([...builtinFiles, ...userFiles]);

    // Remove duplicates based on plugin name (user plugins override built-in)
    const seenNames = new Set<string>();
    const uniqueFiles: string[] = [];

    // Process user files first (they take precedence)
    for (const file of pluginFiles) {
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
   * Filter to only include valid plugin entry points
   * Prefers dist/index.js over src/index.ts
   */
  private filterPluginFiles(files: string[]): string[] {
    const pluginMap = new Map<string, string>();
    const seen = new Set<string>();

    for (const file of files) {
      // Skip individual module files in src/ directories
      if (file.includes("/src/") && !file.endsWith("/index.ts") && !file.endsWith("/index.js")) {
        continue;
      }

      // Extract plugin name from directory structure
      // e.g., plugins/cloudflare/src/index.ts -> cloudflare
      // e.g., plugins/cloudflare/dist/index.js -> cloudflare
      // e.g., plugins/telegram.ts -> telegram
      const match = file.match(/plugins\/([^\/]+)/);
      if (!match) continue;

      const pluginName = match[1];
      const isDist = file.includes("/dist/");
      const isIndex = file.endsWith("/index.ts") || file.endsWith("/index.js");
      const isRootPlugin = /^[^\/]+\.ts$/.test(file.split('/').pop() || '');

      // Only include:
      // - index files at root or src/ (isIndex)
      // - files in dist/ directories (isDist)
      // - root-level plugin files like telegram.ts (isRootPlugin)
      if (!isIndex && !isDist && !isRootPlugin) continue;

      // Prefer dist/ over src/
      if (isDist) {
        pluginMap.set(pluginName, file);
      } else if (!pluginMap.has(pluginName)) {
        pluginMap.set(pluginName, file);
      }
    }

    return Array.from(pluginMap.values());
  }

  /**
   * Get plugin name from file path (used for deduplication)
   */
  private getPluginName(filePath: string): string | null {
    // Extract plugin name from path like plugins/cloudflare/dist/index.js
    const match = filePath.match(/plugins\/([^\/]+)/);
    return match ? match[1] : null;
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
        logger.warn("Error reading plugin directory", { dir, error });
      }
    }
  }

  /**
   * Load a single plugin file
   */
  async loadPlugin(filePath: string): Promise<PluginMetadata | null> {
    try {
      // Dynamic import: use file URL so sub-imports resolve relative to the plugin file
      const url = pathToFileURL(filePath).href;
      const module = await import(url);

      // Get the plugin object - try default export first, then named exports
      let plugin = module.default;

      // If no default export, check for named exports like 'plugin'
      if (!plugin && module.plugin) {
        plugin = module.plugin;
      }

      // If still no plugin, try to find the first object export
      if (!plugin) {
        const possibleExports = ['cloudflare', 'plugin', 'Plugin'];
        for (const name of possibleExports) {
          if (module[name] && typeof module[name] === 'object' && module[name] !== null) {
            plugin = module[name];
            break;
          }
        }
      }

      if (!plugin) {
        logger.warn("Plugin has no exportable object", { filePath });
        return null;
      }

      // Validate plugin structure
      if (typeof plugin !== "object" || plugin === null) {
        logger.warn("Plugin export is not an object", { filePath });
        return null;
      }

      if (!plugin.name || typeof plugin.name !== "string") {
        logger.warn("Plugin missing or invalid name", { filePath });
        return null;
      }

      if (!plugin.description || typeof plugin.description !== "string") {
        logger.warn("Plugin missing or invalid description", { plugin: plugin.name });
        return null;
      }

      if (!plugin.methods || typeof plugin.methods !== "object") {
        logger.warn("Plugin missing or invalid methods", { plugin: plugin.name });
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
      const err = error as Error;
      logger.error("Failed to load plugin", {
        filePath,
        message: err?.message,
        stack: err?.stack,
        error
      });
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
          logger.info("Copied built-in plugin to user directory", { filename });
        }
      }
    } catch (error) {
      logger.warn("Failed to copy built-in plugins to user directory", { error });
    }
  }
}

