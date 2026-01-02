import type { RequestOptions } from "../types/api.js";

export class HTTPAPI {
  private routes: Map<string, (req: Request) => Response | Promise<Response>> = new Map();

  /**
   * Register a route handler
   */
  registerRoute(path: string, handler: (req: Request) => Response | Promise<Response>): void {
    this.routes.set(path, handler);
  }

  /**
   * Register multiple routes at once
   */
  registerRoutes(routes: Record<string, (req: Request) => Response | Promise<Response>>): void {
    for (const [path, handler] of Object.entries(routes)) {
      this.routes.set(path, handler);
    }
  }

  /**
   * Get a route handler by path
   */
  getRouteHandler(path: string): ((req: Request) => Response | Promise<Response>) | undefined {
    return this.routes.get(path);
  }

  /**
   * Get all registered routes
   */
  getAllRoutes(): Map<string, (req: Request) => Response | Promise<Response>> {
    return this.routes;
  }

  /**
   * Make a GET request
   */
  async get(url: string, options: RequestOptions = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = options.timeout
      ? setTimeout(() => controller.abort(), options.timeout)
      : null;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: options.headers,
        signal: controller.signal,
      });

      return response;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Make a POST request
   */
  async post(url: string, data: unknown, options: RequestOptions = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = options.timeout
      ? setTimeout(() => controller.abort(), options.timeout)
      : null;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });

      return response;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Start an HTTP server using Bun.serve
   * Note: This should typically be called once for all webhooks
   */
  serve(handler: (req: Request) => Response | Promise<Response>): void {
    Bun.serve({
      port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
      fetch: handler,
    });
  }
}

