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
     * Read commit history (auto-initializes repo if needed).
     * Takes a plain positional number, not an options object — every other method on
     * this plugin (clone, commit, branch, checkout...) takes positional primitive args,
     * and the generic plugin-tool dispatcher (src/api/index.ts's registerPluginToolsWithRouter)
     * flattens whatever the model sends into a positional array before calling the plugin
     * method. An options-object parameter here would silently never receive its value.
     */
    log: async (limit?: number) => {
      await ensureGitRepo();
      const effectiveLimit = limit && limit > 0 ? limit : 10;

      // Use ASCII field/record separators so commit messages containing
      // arbitrary punctuation can't be misparsed as delimiters.
      const FS = "\x1f";
      const RS = "\x1e";
      const proc = Bun.spawn(
        [
          "git",
          "log",
          `-${effectiveLimit}`,
          `--pretty=format:%H${FS}%an${FS}%ad${FS}%s${RS}`,
          "--date=iso-strict",
        ],
        { stdout: "pipe", stderr: "pipe" }
      );

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      if (proc.exitCode !== 0) {
        // A brand-new repo with no commits yet isn't an error condition here.
        if (stderr.includes("does not have any commits yet")) {
          return { commits: [], count: 0 };
        }
        throw new Error(`Git log failed: ${stderr}`);
      }

      const commits = stdout
        .split(RS)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [hash, author, date, message] = entry.split(FS);
          return {
            hash: (hash ?? "").substring(0, 7),
            fullHash: hash ?? "",
            author: author ?? "",
            date: date ?? "",
            message: message ?? "",
          };
        });

      return { commits, count: commits.length };
    },

    /**
     * Show a diff: working tree vs. a ref (or unstaged changes if no ref
     * given), optionally scoped to one path. Same positional-args convention
     * as log() — the generic plugin-tool dispatcher flattens model args
     * positionally, so an options object here would never receive its value.
     */
    diff: async (ref?: string, path?: string) => {
      await ensureGitRepo();
      const args = ["diff", ...(ref ? [ref] : []), ...(path ? ["--", path] : [])];

      const proc = Bun.spawn(["git", ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(`Git diff failed: ${stderr}`);
      }

      return { diff: stdout };
    },

    /**
     * Show a commit (full patch), or a single file's content at a ref when
     * path is given (git's `ref:path` blob syntax).
     */
    show: async (ref: string, path?: string) => {
      await ensureGitRepo();
      const target = path ? `${ref}:${path}` : ref;

      const proc = Bun.spawn(["git", "show", target], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      if (proc.exitCode !== 0) {
        throw new Error(`Git show failed: ${stderr}`);
      }

      return { content: stdout };
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
  toolMetadata: {
    clone: {
      description: "Clone a git repository from a URL.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Repository URL to clone" },
          dir: { type: "string", description: "Optional destination directory" },
        },
        required: ["url"],
      },
    },
    status: {
      description:
        "Get the working tree status: whether it's clean, and which files are modified/staged/untracked. Auto-initializes a repo if none exists yet.",
    },
    add: {
      description: "Stage one or more files for the next commit.",
      parameters: {
        type: "object",
        properties: { files: { type: "array", description: "File path or paths to stage" } },
        required: ["files"],
      },
    },
    commit: {
      description: "Commit staged (or specified) changes with a message.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Commit message" },
          files: { type: "array", description: "Optional specific files to commit instead of everything staged" },
        },
        required: ["message"],
      },
    },
    push: {
      description: "Push commits to a remote.",
      parameters: {
        type: "object",
        properties: {
          remote: { type: "string", description: "Remote name, e.g. origin" },
          branch: { type: "string", description: "Branch to push" },
        },
        required: [],
      },
    },
    pull: {
      description: "Pull commits from a remote.",
      parameters: {
        type: "object",
        properties: {
          remote: { type: "string", description: "Remote name, e.g. origin" },
          branch: { type: "string", description: "Branch to pull" },
        },
        required: [],
      },
    },
    branch: {
      description: "List existing branches, or create a new one if a name is given.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name of a new branch to create; omit to just list existing branches" },
        },
        required: [],
      },
    },
    log: {
      description:
        "Read commit history — hashes, authors, dates, and messages. Use this for anything like \"show recent commits\" or \"summarize the last N updates\" instead of running raw shell git log commands.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max number of commits to return (default 10)" },
        },
        required: [],
      },
    },
    checkout: {
      description: "Switch to a branch.",
      parameters: {
        type: "object",
        properties: { branch: { type: "string", description: "Branch name to check out" } },
        required: ["branch"],
      },
    },
    diff: {
      description:
        "Show a diff — unstaged working-tree changes, or against a ref (branch/tag/commit) when given. Optionally scoped to a single file. Use this for \"what changed in X\" instead of running raw shell git diff commands.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Ref to diff against, e.g. a branch, tag, or commit hash. Omit to see unstaged changes." },
          path: { type: "string", description: "Limit the diff to this file path." },
        },
        required: [],
      },
    },
    show: {
      description:
        "Show a commit's full patch, or a single file's content at a specific ref when path is given. Use this for \"what did commit X change\" or \"show me file Y as of commit Z\" instead of running raw shell git show commands.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Commit hash, branch, or tag to show" },
          path: { type: "string", description: "Optional file path — returns that file's content at ref instead of the full commit patch" },
        },
        required: ["ref"],
      },
    },
  },
};

export default gitPlugin;

