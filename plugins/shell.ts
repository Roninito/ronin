import type { Plugin } from "../src/plugins/base.js";

/**
 * Shell command execution plugin
 */
const shellPlugin: Plugin = {
  name: "shell",
  description: "Execute shell commands safely",
  methods: {
    /**
     * Execute a shell command
     */
    exec: async (
      command: string,
      args?: string[],
      options?: { cwd?: string; env?: Record<string, string> }
    ) => {
      const proc = Bun.spawn([command, ...(args || [])], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      await proc.exited;

      return {
        exitCode: proc.exitCode,
        stdout,
        stderr,
        success: proc.exitCode === 0,
      };
    },

    /**
     * Execute command async with streaming output
     */
    execAsync: async (
      command: string,
      args?: string[],
      options?: { cwd?: string; env?: Record<string, string> }
    ) => {
      const proc = Bun.spawn([command, ...(args || [])], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
      });

      return {
        process: proc,
        async readOutput() {
          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();
          await proc.exited;
          return {
            exitCode: proc.exitCode,
            stdout,
            stderr,
            success: proc.exitCode === 0,
          };
        },
      };
    },

    /**
     * Find command path (like which)
     */
    which: async (command: string) => {
      const proc = Bun.spawn(["which", command], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      if (proc.exitCode !== 0) {
        return null;
      }

      return stdout.trim();
    },

    /**
     * Get environment variables
     */
    env: async () => {
      return { ...process.env };
    },

    /**
     * Get current working directory
     */
    cwd: async () => {
      return process.cwd();
    },
  },
};

export default shellPlugin;

