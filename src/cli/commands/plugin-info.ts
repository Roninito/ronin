import { PluginLoader } from "../../plugins/PluginLoader.js";

export interface PluginInfoOptions {
  pluginName: string;
  pluginDir?: string;
}

/**
 * Plugin info command: Show detailed information about a plugin
 */
export async function pluginInfoCommand(
  options: PluginInfoOptions
): Promise<void> {
  const pluginDir = options.pluginDir || "./plugins";

  const loader = new PluginLoader(pluginDir);
  const plugins = await loader.loadAllPlugins();

  const plugin = plugins.find((p) => p.name === options.pluginName);

  if (!plugin) {
    console.error(`❌ Plugin not found: ${options.pluginName}`);
    console.log(`Available plugins: ${plugins.map((p) => p.name).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n📦 Plugin: ${plugin.name}\n`);
  console.log(`Description: ${plugin.description}`);
  console.log(`File: ${plugin.filePath}`);
  console.log(`\nMethods (${plugin.methods.length}):\n`);

  for (const methodName of plugin.methods) {
    const method = plugin.plugin.methods[methodName];
    console.log(`  • ${methodName}`);
    console.log(`    Type: ${typeof method === "function" ? "function" : "unknown"}`);
    console.log(`    Async: ${method.constructor.name === "AsyncFunction" ? "yes" : "no"}`);
    console.log();
  }
}

