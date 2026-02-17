import type { RequestOptions } from "../types/api.js";

export interface RouteMetadata {
  title?: string;
  description?: string;
  icon?: string;
}

export class HTTPAPI {
  private routes: Map<string, (req: Request) => Response | Promise<Response>> = new Map();
  private routeMetadata: Map<string, RouteMetadata> = new Map();

  /**
   * Register a route handler with optional metadata
   */
  registerRoute(
    path: string, 
    handler: (req: Request) => Response | Promise<Response>,
    metadata?: RouteMetadata
  ): void {
    this.routes.set(path, handler);
    if (metadata) {
      this.routeMetadata.set(path, metadata);
    }
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
   * Get metadata for a route
   */
  getRouteMetadata(path: string): RouteMetadata | undefined {
    return this.routeMetadata.get(path);
  }

  /**
   * Get all routes with their metadata
   */
  getAllRoutesWithMetadata(): Array<{path: string, metadata?: RouteMetadata}> {
    const result: Array<{path: string, metadata?: RouteMetadata}> = [];
    for (const [path] of this.routes.entries()) {
      result.push({
        path,
        metadata: this.routeMetadata.get(path)
      });
    }
    return result;
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

