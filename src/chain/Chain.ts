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
    this.ctx = { ...ctx, executor: this.executor };
    return this;
  }

  async run(): Promise<void> {
    await this.middleware.run(this.ctx);
  }
}
