import { watch, mkdirSync, existsSync, readdirSync } from "fs";

export class FilesAPI {
  private watchers: Map<string, ReturnType<typeof watch>> = new Map();

  /**
   * Read a file as text
   */
  async read(path: string): Promise<string> {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      throw new Error(`File not found: ${path}`);
    }
    return await file.text();
  }

  /**
   * Write content to a file
   */
  async write(path: string, content: string): Promise<void> {
    await Bun.write(path, content);
  }

  /**
   * Ensure a directory exists (create recursively if needed)
   */
  async ensureDir(path: string): Promise<void> {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }

  /**
   * Watch a file pattern for changes
   * Note: This uses Node's fs.watch. For glob patterns, the AgentRegistry
   * will need to expand them to actual file paths.
   */
  watch(pattern: string, callback: (path: string, event: string) => void): void {
    // For now, we'll watch the exact path
    // The AgentRegistry should handle glob pattern expansion
    if (this.watchers.has(pattern)) {
      // Already watching
      return;
    }

    try {
      const watcher = watch(
        pattern,
        { recursive: pattern.includes("**") || pattern.includes("*") },
        (eventType, filename) => {
          if (filename) {
            // Convert Node.js event types to our format
            const event = eventType === "rename" ? "create" : eventType;
            callback(filename, event);
          }
        }
      );

      this.watchers.set(pattern, watcher);
    } catch (error) {
      console.error(`Failed to watch ${pattern}:`, error);
    }
  }

  /**
   * List files in a directory
   */
  async list(dir: string, pattern?: string): Promise<string[]> {
    const entries = readdirSync(dir, { withFileTypes: true });
    let files = entries.map((entry) => `${dir}/${entry.name}`);

    if (pattern) {
      const regex = new RegExp(
        "^" + pattern.replace(/\*/g, ".*").replace(/\//g, "\\/") + "$"
      );
      files = files.filter(file => regex.test(file));
    }

    return files;
  }

  /**
   * Stop watching a pattern
   */
  unwatch(pattern: string): void {
    const watcher = this.watchers.get(pattern);
    if (watcher) {
      watcher.close();
      this.watchers.delete(pattern);
    }
  }

  /**
   * Stop all watchers
   */
  unwatchAll(): void {
    for (const [pattern, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

