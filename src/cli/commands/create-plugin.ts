import { writeFile } from "fs/promises";
import { join } from "path";

export interface CreatePluginOptions {
  pluginName: string;
  pluginDir?: string;
  description?: string;
  methods?: string[];
}

/**
 * Create plugin command: Generate a new plugin template
 */
export async function createPluginCommand(options: CreatePluginOptions): Promise<void> {
  const pluginDir = options.pluginDir || "./plugins";
  const pluginName = options.pluginName;
  const description = options.description || `Plugin for ${pluginName}`;
  const methods = options.methods || ["exampleMethod"];

  // Validate plugin name
  if (!/^[a-z][a-z0-9-]*$/.test(pluginName)) {
    console.error("❌ Plugin name must be lowercase alphanumeric with hyphens only");
    console.error("   Example: my-plugin, git-helper, shell-utils");
    process.exit(1);
  }

  const pluginPath = join(pluginDir, `${pluginName}.ts`);

  // Generate plugin template
  const methodsCode = methods
    .map((method) => {
      const camelCase = method.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return `    ${camelCase}: async (/* Add parameters here */) => {
      // TODO: Implement ${camelCase}
      throw new Error("Not implemented");
    },`;
    })
    .join("\n");

  const pluginTemplate = `import type { Plugin } from "../src/plugins/base.js";

/**
 * ${description}
 */
const ${pluginName.replace(/-/g, "_")}Plugin: Plugin = {
  name: "${pluginName}",
  description: "${description}",
  methods: {
${methodsCode}
  },
};

export default ${pluginName.replace(/-/g, "_")}Plugin;
`;

  try {
    // Ensure plugin directory exists
    await writeFile(pluginPath, pluginTemplate, "utf-8");
    console.log(`✅ Created plugin: ${pluginPath}`);
    console.log(`\n📝 Next steps:`);
    console.log(`   1. Edit ${pluginPath} to implement your methods`);
    console.log(`   2. Restart ronin to load the new plugin`);
    console.log(`   3. Use in agents: await this.api.plugins.call("${pluginName}", "methodName", ...args)`);
  } catch (error) {
    console.error(`❌ Failed to create plugin:`, error);
    process.exit(1);
  }
}

