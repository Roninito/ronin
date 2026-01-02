import { PluginLoader } from "../../plugins/PluginLoader.js";

export interface ListPluginsOptions {
  pluginDir?: string;
}

/**
 * List plugins command: Show all loaded plugins
 */
export async function listPluginsCommand(options: ListPluginsOptions = {}): Promise<void> {
  const pluginDir = options.pluginDir || "./plugins";

  const loader = new PluginLoader(pluginDir);
  const plugins = await loader.loadAllPlugins();

  if (plugins.length === 0) {
    console.log("No plugins found.");
    return;
  }

  console.log(`\n🔌 Found ${plugins.length} plugin(s):\n`);

  for (const plugin of plugins) {
    console.log(`📦 ${plugin.name}`);
    console.log(`   Description: ${plugin.description}`);
    console.log(`   Methods: ${plugin.methods.join(", ")}`);
    console.log(`   File: ${plugin.filePath}`);
    console.log();
  }
}

