import type { Plugin } from "../src/plugins/base.js";

/**
 * Check if current directory is a git repository
 */
async function isGitRepo(): Promise<boolean> {
  const proc = Bun.spawn(["git", "rev-parse", "--git-dir"], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
  });

  await proc.exited;
  return proc.exitCode === 0;
}

/**
 * Initialize a git repository if one doesn't exist
 */
async function ensureGitRepo(): Promise<void> {
  const isRepo = await isGitRepo();
  if (!isRepo) {
    console.log("📦 Initializing git repository...");
    const proc = Bun.spawn(["git", "init"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: process.cwd(),
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (proc.exitCode !== 0) {
      throw new Error(`Git init failed: ${stderr}`);
    }

    console.log("✅ Git repository initialized");
  }
}

/**
 * Git operations plugin
 */
const gitPlugin: Plugin = {
  name: "git",
  description: "Basic Git operations (clone, commit, push, pull, status)",
  methods: {
    /**
     * Initialize a git repository
     */
    init: async () => {
      await ensureGitRepo();
      return { success: true, message: "Git repository initialized" };
    },
    /**
     * Clone a git repository
     */
    clone: async (url: string, dir?: string) => {
      const proc = Bun.spawn(["git", "clone", url, ...(dir ? [dir] : [])], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(`Git clone failed: ${stderr}`);
      }

      return { success: true, output: stdout };
    },

    /**
     * Get git status (auto-initializes repo if needed)
     */
    status: async () => {
      // Auto-initialize git repo if it doesn't exist
      await ensureGitRepo();

      const proc = Bun.spawn(["git", "status", "--porcelain"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(`Git status failed: ${stderr}`);
      }

      return {
        clean: stdout.trim().length === 0,
        files: stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const status = line.substring(0, 2);
            const file = line.substring(3);
            return { status, file };
          }),
      };
    },

    /**
     * Stage files for commit (auto-initializes repo if needed)
     */
    add: async (files: string | string[]) => {
      await ensureGitRepo();
      const fileArray = Array.isArray(files) ? files : [files];
      const proc = Bun.spawn(["git", "add", ...fileArray], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(`Git add failed: ${stderr}`);
      }

      return { success: true };
    },

    /**
     * Commit changes (auto-initializes repo if needed)
     */
    commit: async (message: string, files?: string[]) => {
      await ensureGitRepo();
      const args = ["commit", "-m", message];
      if (files && files.length > 0) {
        args.push("--", ...files);
      }

      const proc = Bun.spawn(["git", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(`Git commit failed: ${stderr}`);
      }

      return { success: true, output: stdout };
    },

    /**
     * Push to remote
     */
    push: async (remote?: string, branch?: string) => {
      const args = ["push"];
      if (remote) args.push(remote);
      if (branch) args.push(branch);

      const proc = Bun.spawn(["git", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(`Git push failed: ${stderr}`);
      }

      return { success: true, output: stdout };
    },

    /**
     * Pull from remote
     */
    pull: async (remote?: string, branch?: string) => {
      const args = ["pull"];
      if (remote) args.push(remote);
      if (branch) args.push(branch);

      const proc = Bun.spawn(["git", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(`Git pull failed: ${stderr}`);
      }

      return { success: true, output: stdout };
    },

    /**
     * List or create branches
     */
    branch: async (name?: string) => {
      if (name) {
        // Create branch
        const proc = Bun.spawn(["git", "checkout", "-b", name], {
          stdout: "pipe",
          stderr: "pipe",
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();

        await proc.exited;

        if (proc.exitCode !== 0) {
          throw new Error(`Git branch creation failed: ${stderr}`);
        }

        return { success: true, output: stdout };
      } else {
        // List branches
        const proc = Bun.spawn(["git", "branch"], {
          stdout: "pipe",
          stderr: "pipe",
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();

        await proc.exited;

        if (proc.exitCode !== 0) {
          throw new Error(`Git branch list failed: ${stderr}`);
        }

        return {
          branches: stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((b) => b.trim().replace(/^\*\s*/, "")),
        };
      }
    },

    /**
     * Checkout a branch
     */
    checkout: async (branch: string) => {
      const proc = Bun.spawn(["git", "checkout", branch], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(`Git checkout failed: ${stderr}`);
      }

      return { success: true, output: stdout };
    },
  },
};

export default gitPlugin;

