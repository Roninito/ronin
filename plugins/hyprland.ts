import type { Plugin } from "../src/plugins/base.js";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

/**
 * Hyprland window manager configuration plugin
 */
const hyprlandPlugin: Plugin = {
  name: "hyprland",
  description: "Manage Hyprland window manager configuration",
  methods: {
    /**
     * Read Hyprland config file
     */
    readConfig: async (path?: string) => {
      const configPath =
        path || join(homedir(), ".config/hypr/hyprland.conf");
      try {
        const content = await readFile(configPath, "utf-8");
        return { content, path: configPath };
      } catch (error) {
        throw new Error(`Failed to read config: ${error}`);
      }
    },

    /**
     * Write Hyprland config file
     */
    writeConfig: async (content: string, path?: string) => {
      const configPath =
        path || join(homedir(), ".config/hypr/hyprland.conf");
      try {
        await writeFile(configPath, content, "utf-8");
        return { success: true, path: configPath };
      } catch (error) {
        throw new Error(`Failed to write config: ${error}`);
      }
    },

    /**
     * Parse and return keybindings from config
     */
    getKeybindings: async (path?: string) => {
      const configPath =
        path || join(homedir(), ".config/hypr/hyprland.conf");
      try {
        const content = await readFile(configPath, "utf-8");
        const lines = content.split("\n");
        const keybindings: Array<{ key: string; action: string }> = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("bind") && !trimmed.startsWith("#")) {
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 3) {
              keybindings.push({
                key: parts[1],
                action: parts.slice(2).join(" "),
              });
            }
          }
        }

        return { keybindings };
      } catch (error) {
        throw new Error(`Failed to get keybindings: ${error}`);
      }
    },

    /**
     * Update a keybinding in the config
     */
    setKeybinding: async (
      key: string,
      action: string,
      path?: string
    ) => {
      const configPath =
        path || join(homedir(), ".config/hypr/hyprland.conf");
      try {
        const content = await readFile(configPath, "utf-8");
        const lines = content.split("\n");
        let found = false;

        const newLines = lines.map((line) => {
          const trimmed = line.trim();
          if (
            trimmed.startsWith("bind") &&
            !trimmed.startsWith("#") &&
            trimmed.includes(key)
          ) {
            found = true;
            return `bind = ${key}, ${action}`;
          }
          return line;
        });

        if (!found) {
          newLines.push(`bind = ${key}, ${action}`);
        }

        await writeFile(configPath, newLines.join("\n"), "utf-8");
        return { success: true, path: configPath };
      } catch (error) {
        throw new Error(`Failed to set keybinding: ${error}`);
      }
    },

    /**
     * Reload Hyprland configuration
     */
    reload: async () => {
      const proc = Bun.spawn(["hyprctl", "reload"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(`Failed to reload: ${stderr}`);
      }

      return { success: true, output: stdout };
    },
  },
};

export default hyprlandPlugin;

