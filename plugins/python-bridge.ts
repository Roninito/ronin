/**
 * Python Bridge Plugin
 * 
 * Enables Ronin plugins to execute Python code and communicate with Python subprocesses via IPC.
 * Uses JSON-over-stdin/stdout with null-byte framing for reliable message boundaries.
 * 
 * @example
 * // Execute Python code inline
 * const result = await api.python?.execute("return {'hello': 'world'}");
 * 
 * @example
 * // Spawn persistent Python backend
 * const backend = await api.python?.spawn("plugins/reticulum/backend.py");
 * await backend?.call("create_identity");
 * 
 * @packageDocumentation
 */

import type { Plugin } from "../src/plugins/base.js";
import { spawn, type ChildProcess } from "bun";
import { join } from "path";
import { existsSync } from "fs";

/**
 * Message frame for Python ↔ Bun IPC
 */
interface PythonMessage {
  id: number;
  cmd: string;
  params?: Record<string, unknown>;
}

/**
 * Response from Python backend
 */
interface PythonResponse {
  id: number;
  status: "success" | "error";
  result?: unknown;
  error?: string;
  traceback?: string;
}

/**
 * Handle to a running Python backend process
 */
export class PythonBackendHandle {
  private process: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests: Map<number, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timer?: NodeJS.Timeout;
  }> = new Map();
  private buffer = "";
  private eventHandlers: Map<string, Set<(data: unknown) => void>> = new Map();
  private scriptPath: string;
  private env?: Record<string, string>;

  constructor(scriptPath: string, env?: Record<string, string>) {
    this.scriptPath = scriptPath;
    this.env = env;
  }

  /**
   * Start the Python backend process
   */
  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    if (!existsSync(this.scriptPath)) {
      throw new Error(`Python script not found: ${this.scriptPath}`);
    }

    // Find python3
    const pythonPath = await this.findPython3();

    // Spawn Python process with stdio pipes
    this.process = spawn({
      cmd: [pythonPath, this.scriptPath],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: this.env,
      onExit: (proc, exitCode, signalCode) => {
        console.error(`[python] Backend process exited with code ${exitCode}, signal ${signalCode}`);
        this.process = null;
        
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests.entries()) {
          pending.reject(new Error(`Backend process exited with code ${exitCode}`));
        }
        this.pendingRequests.clear();
      },
    });

    // Handle stdout (responses from Python)
    this.handleStdout();

    // Handle stderr (errors from Python)
    this.handleStderr();

    // Wait for backend to initialize
    await this.waitForReady();
  }

  /**
   * Find python3 executable
   */
  private async findPython3(): Promise<string> {
    // Try common python3 paths
    const paths = [
      "python3",
      "python",
      "/usr/bin/python3",
      "/usr/local/bin/python3",
      process.execPath.replace("bun", "python3"),
    ];

    for (const path of paths) {
      try {
        const proc = spawn({
          cmd: [path, "--version"],
          stdout: "pipe",
          stderr: "pipe",
        });
        await proc.exited;
        return path;
      } catch {
        continue;
      }
    }

    throw new Error(
      "python3 not found. Please install Python 3.8+ and ensure it's in your PATH."
    );
  }

  /**
   * Handle stdout from Python process
   */
  private handleStdout(): void {
    if (!this.process?.stdout) return;

    const reader = this.process.stdout.getReader();
    const read = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Decode and buffer
          const text = new TextDecoder().decode(value);
          this.buffer += text;

          // Process complete messages (delimited by \0)
          this.processBuffer();
        }
      } catch (error) {
        console.error("[python] Error reading stdout:", error);
      }
    };

    read();
  }

  /**
   * Process buffered stdout data
   */
  private processBuffer(): void {
    // Split on null byte delimiter
    const messages = this.buffer.split("\0");
    
    // Keep incomplete message in buffer
    this.buffer = messages.pop() || "";

    for (const msg of messages) {
      if (!msg.trim()) continue;

      try {
        const response: PythonResponse = JSON.parse(msg);
        this.handleResponse(response);
      } catch (error) {
        console.error("[python] Failed to parse response:", msg, error);
      }
    }
  }

  /**
   * Handle parsed response from Python
   */
  private handleResponse(response: PythonResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      // Could be an event notification
      if (response.cmd) {
        this.emitEvent(response.cmd, response.result);
      }
      return;
    }

    // Clear timeout
    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    this.pendingRequests.delete(response.id);

    if (response.status === "error") {
      const error = new Error(response.error || "Unknown Python error");
      if (response.traceback) {
        error.stack = response.traceback;
      }
      pending.reject(error);
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Handle stderr from Python process
   */
  private handleStderr(): void {
    if (!this.process?.stderr) return;

    const reader = this.process.stderr.getReader();
    const read = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = new TextDecoder().decode(value);
          console.error("[python] stderr:", text.trim());
        }
      } catch (error) {
        console.error("[python] Error reading stderr:", error);
      }
    };

    read();
  }

  /**
   * Wait for backend to be ready
   */
  private async waitForReady(): Promise<void> {
    try {
      await this.call("ready", {}, 5000);
    } catch {
      // Backend may not implement ready check, that's ok
    }
  }

  /**
   * Call a Python backend method
   */
  async call(
    cmd: string,
    params?: Record<string, unknown>,
    timeout: number = 30000
  ): Promise<unknown> {
    if (!this.process) {
      throw new Error("Python backend not started. Call start() first.");
    }

    const id = ++this.messageId;

    return new Promise((resolve, reject) => {
      // Create timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Python call timeout: ${cmd} after ${timeout}ms`));
      }, timeout);

      // Store pending request
      this.pendingRequests.set(id, { resolve, reject, timer });

      // Send message
      const message: PythonMessage = { id, cmd, params };
      const json = JSON.stringify(message) + "\n";
      
      try {
        this.process?.stdin?.write(json);
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`Failed to write to Python stdin: ${error}`));
      }
    });
  }

  /**
   * Register event handler for async notifications from Python
   */
  on(event: string, handler: (data: unknown) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Remove event handler
   */
  off(event: string, handler: (data: unknown) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit event to handlers
   */
  private emitEvent(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`[python] Error in event handler for ${event}:`, error);
        }
      }
    }
  }

  /**
   * Terminate the Python backend
   */
  async terminate(): Promise<void> {
    if (!this.process) return;

    try {
      // Try graceful shutdown
      await this.call("shutdown", {}, 2000).catch(() => {});
    } finally {
      // Force kill
      this.process.kill();
      this.process = null;
      
      // Clear pending requests
      for (const pending of this.pendingRequests.values()) {
        if (pending.timer) clearTimeout(pending.timer);
      }
      this.pendingRequests.clear();
    }
  }
}

/**
 * Python Bridge Plugin State
 */
interface PythonBridgeState {
  backends: Map<string, PythonBackendHandle>;
}

const state: PythonBridgeState = {
  backends: new Map(),
};

/**
 * Python Bridge Plugin
 */
const pythonBridgePlugin: Plugin = {
  name: "python",
  description: "Execute Python code and manage Python subprocesses via IPC. Enables integration with Reticulum, ML libraries, and other Python ecosystems.",
  methods: {
    /**
     * Execute Python code inline (one-off execution)
     * 
     * @param code - Python code to execute (should return a value)
     * @param options - Execution options
     * @returns Result from Python execution
     * 
     * @example
     * const result = await api.python?.execute("return {'hello': 'world'}");
     * 
     * @example
     * const result = await api.python?.execute(
     *   "import json; return json.dumps({'sum': 2 + 2})"
     * );
     */
    execute: async (
      code: string,
      options?: { timeout?: number; pythonPath?: string }
    ): Promise<unknown> => {
      const timeout = options?.timeout || 30000;
      
      // Create temporary script
      const wrappedCode = `
import sys
import json

try:
    result = ${code}
    response = {
        "id": 0,
        "status": "success",
        "result": result
    }
except Exception as e:
    import traceback
    response = {
        "id": 0,
        "status": "error",
        "error": str(e),
        "traceback": traceback.format_exc()
    }

sys.stdout.buffer.write(json.dumps(response).encode() + b'\\0')
sys.stdout.buffer.flush()
`;

      const pythonPath = options?.pythonPath || "python3";
      
      return new Promise((resolve, reject) => {
        const proc = spawn({
          cmd: [pythonPath, "-c", wrappedCode],
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });

        let output = "";
        const timer = setTimeout(() => {
          proc.kill();
          reject(new Error(`Python execute timeout after ${timeout}ms`));
        }, timeout);

        const readOutput = async () => {
          try {
            const text = await proc.stdout.text();
            output = text;
          } catch {
            // Ignore
          }
        };

        readOutput();

        proc.exited.then((exitCode) => {
          clearTimeout(timer);
          
          if (exitCode !== 0) {
            reject(new Error(`Python process exited with code ${exitCode}`));
            return;
          }

          try {
            // Parse response (may have multiple messages, take last complete one)
            const messages = output.split("\0").filter(m => m.trim());
            const lastMessage = messages[messages.length - 1];
            const response: PythonResponse = JSON.parse(lastMessage);

            if (response.status === "error") {
              const error = new Error(response.error || "Python execution failed");
              if (response.traceback) {
                error.stack = response.traceback;
              }
              reject(error);
            } else {
              resolve(response.result);
            }
          } catch (error) {
            reject(new Error(`Failed to parse Python output: ${error}\nOutput: ${output}`));
          }
        });
      });
    },

    /**
     * Spawn a persistent Python backend process
     * 
     * @param script - Path to Python script
     * @param options - Spawn options
     * @returns Handle to the backend process
     * 
     * @example
     * const backend = await api.python?.spawn("plugins/reticulum/backend.py");
     * await backend?.call("create_identity");
     * await backend?.call("announce", { appData: "ronin" });
     */
    spawn: async (
      script: string,
      options?: {
        env?: Record<string, string>;
        timeout?: number;
      }
    ): Promise<PythonBackendHandle> => {
      // Resolve script path
      let scriptPath = script;
      if (!scriptPath.startsWith("/")) {
        scriptPath = join(process.cwd(), script);
      }

      // Check if already spawned
      const existing = state.backends.get(scriptPath);
      if (existing) {
        return existing;
      }

      // Create new backend handle
      const handle = new PythonBackendHandle(scriptPath, options?.env);
      await handle.start();

      // Store handle
      state.backends.set(scriptPath, handle);

      return handle;
    },

    /**
     * Get a handle to a spawned backend
     * 
     * @param script - Path to Python script (same as used in spawn)
     * @returns Backend handle or undefined if not spawned
     */
    getBackend: (script: string): PythonBackendHandle | undefined => {
      let scriptPath = script;
      if (!scriptPath.startsWith("/")) {
        scriptPath = join(process.cwd(), script);
      }
      return state.backends.get(scriptPath);
    },

    /**
     * Terminate a spawned backend
     * 
     * @param script - Path to Python script
     */
    terminate: async (script: string): Promise<void> => {
      let scriptPath = script;
      if (!scriptPath.startsWith("/")) {
        scriptPath = join(process.cwd(), script);
      }

      const handle = state.backends.get(scriptPath);
      if (handle) {
        await handle.terminate();
        state.backends.delete(scriptPath);
      }
    },

    /**
     * Terminate all spawned backends
     */
    terminateAll: async (): Promise<void> => {
      const promises: Promise<void>[] = [];
      for (const [script, handle] of state.backends.entries()) {
        promises.push(handle.terminate().then(() => {
          state.backends.delete(script);
        }));
      }
      await Promise.all(promises);
    },

    /**
     * Check if Python 3 is available
     * 
     * @returns True if Python 3 is found
     */
    hasPython: async (): Promise<boolean> => {
      try {
        const proc = spawn({
          cmd: ["python3", "--version"],
          stdout: "pipe",
          stderr: "pipe",
        });
        await proc.exited;
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Get Python version
     * 
     * @returns Python version string
     */
    getPythonVersion: async (): Promise<string> => {
      try {
        const proc = spawn({
          cmd: ["python3", "--version"],
          stdout: "pipe",
          stderr: "pipe",
        });
        const output = await proc.stdout.text();
        return output.trim();
      } catch {
        return "unknown";
      }
    },
  },
};

export default pythonBridgePlugin;
