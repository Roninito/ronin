/**
 * Koa-style middleware stack for SAR. Deterministic ordered execution.
 */

export type Middleware<Ctx = unknown> = (
  ctx: Ctx,
  next: () => Promise<void>
) => Promise<void>;

export class MiddlewareStack<Ctx = unknown> {
  private stack: Middleware<Ctx>[] = [];

  use(mw: Middleware<Ctx>): void {
    this.stack.push(mw);
  }

  async run(ctx: Ctx): Promise<void> {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      const fn = this.stack[i];
      if (!fn) return;
      await fn(ctx, () => dispatch(i + 1));
    };

    await dispatch(0);
  }
}
