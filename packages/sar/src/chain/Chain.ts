/**
 * Chain — single execution timeline. Holds context, executor, middleware; run() invokes the stack.
 */

import type { Executor } from "../executor/Executor.js";
import type { MiddlewareStack } from "../middleware/MiddlewareStack.js";
import type { ChainContext } from "./types.js";

export class Chain {
  private ctx!: ChainContext;

  constructor(
    private executor: Executor,
    private middleware: MiddlewareStack<ChainContext>,
    private _name?: string
  ) {}

  withContext(ctx: ChainContext): this {
    // Mutate and hold onto the SAME object the caller passed in — do not spread it into
    // a copy. Middleware such as conversation-history injection reassigns `ctx.messages`
    // to a brand-new array (not an in-place push); if this.ctx were a separate object,
    // that reassignment would only be visible inside the chain, silently orphaning the
    // caller's own `ctx.messages` reference at whatever state it was in before the
    // reassignment — e.g. messenger.ts reading back an empty/stale message list after
    // chain.run() resolves, even though the chain itself ran with the full, correct
    // history- and tool-result-augmented context.
    ctx.executor = this.executor;
    this.ctx = ctx;
    return this;
  }

  /**
   * Replaces the chain's middleware stack with a new one.
   * This allows using template-based middleware stacks (e.g., standardSAR).
   *
   * @param stack - The middleware stack to use (e.g., from standardSAR())
   * @returns this for method chaining
   *
   * @example
   * const stack = standardSAR({ maxTokens: 8192 });
   * const chain = this.createChain("my-agent");
   * chain.useMiddlewareStack(stack);
   * chain.withContext(ctx);
   * await chain.run();
   */
  useMiddlewareStack(stack: MiddlewareStack<ChainContext>): this {
    (this as any).middleware = stack;
    return this;
  }

  async run(): Promise<void> {
    await this.middleware.run(this.ctx);
  }
}
