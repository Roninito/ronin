import type { Agent, AgentAPI } from "../types/index.js";
import { Executor } from "../executor/Executor.js";
import { Chain } from "../chain/Chain.js";
import { MiddlewareStack } from "../middleware/MiddlewareStack.js";
import type { ChainContext } from "../chain/types.js";
import type { Middleware } from "../middleware/MiddlewareStack.js";

/**
 * Base Agent class that all agents should extend.
 * Optional SAR support: use use() and createChain() to run middleware-driven chains.
 */
export abstract class BaseAgent implements Agent {
  protected api: AgentAPI;
  protected executor: Executor | null = null;
  protected middleware: MiddlewareStack<ChainContext> | null = null;

  constructor(api: AgentAPI) {
    this.api = api;
  }

  /**
   * Main execution method - must be implemented by subclasses
   */
  abstract execute(): Promise<void>;

  /**
   * SAR: Register middleware. Lazily creates Executor and MiddlewareStack on first use.
   */
  use(mw: Middleware<ChainContext>): void {
    if (!this.middleware) {
      this.executor = new Executor(this.api);
      this.middleware = new MiddlewareStack<ChainContext>();
    }
    this.middleware.use(mw);
  }

  /**
   * SAR: Create a chain with the current executor and middleware. Lazily creates them if needed.
   */
  createChain(name?: string): Chain {
    if (!this.middleware || !this.executor) {
      this.executor = new Executor(this.api);
      this.middleware = new MiddlewareStack<ChainContext>();
    }
    return new Chain(this.executor, this.middleware, name);
  }

  /**
   * Optional: Called when a watched file changes
   */
  async onFileChange?(_path: string, _event: "create" | "update" | "delete"): Promise<void> {
    // Default: do nothing
  }

  /**
   * Optional: Called when a webhook is received
   */
  async onWebhook?(_payload: unknown): Promise<void> {
    // Default: do nothing
  }
}

