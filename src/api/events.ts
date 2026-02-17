type EventHandler = (data: unknown) => void;

export class EventsAPI {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private requestIdCounter = 0;

  /**
   * Emit an event
   * @param event Event type name
   * @param data Event payload data
   * @param source Source agent name (REQUIRED - e.g., 'todo', 'coder-bot')
   * @throws Error if source is not provided
   */
  emit(event: string, data: unknown, source: string): void {
    // STRICT: source parameter is REQUIRED
    if (!source || typeof source !== 'string') {
      throw new Error(
        `EventsAPI.emit() requires source parameter. ` +
        `Usage: emit("${event}", data, "agent-name")`
      );
    }

    // Notify event handlers
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      for (const handler of eventHandlers) {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      }
    }

    // Capture for event monitor (non-blocking)
    this.captureEvent(event, data, source).catch((err) => {
      console.error('[EventsAPI] Failed to capture event:', err);
    });
  }

  /**
   * Capture event for event monitor
   * @private
   */
  private async captureEvent(
    event: string,
    data: unknown,
    source: string
  ): Promise<void> {
    try {
      // Beam to event-monitor agent
      // This is fire-and-forget, errors are logged but don't block
      this.beam('event-monitor', 'capture', {
        timestamp: Date.now(),
        type: event,
        source,
        payload: data,
      });
    } catch {
      // Silently fail - event monitor is optional
    }
  }

  /**
   * Register an event handler
   */
  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * Unregister an event handler
   */
  off(event: string, handler: EventHandler): void {
    const eventHandlers = this.handlers.get(event);
    if (eventHandlers) {
      eventHandlers.delete(handler);
      if (eventHandlers.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  /**
   * Remove all handlers for an event
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Send a targeted event to specific agent(s)
   * @param targets Agent name(s) to target (e.g., 'rss-feed' or ['rss-feed', 'gvec'])
   * @param eventType Event type name (e.g., 'get-new-items')
   * @param payload Event payload data
   */
  beam(targets: string | string[], eventType: string, payload: unknown): void {
    const targetArray = Array.isArray(targets) ? targets : [targets];
    targetArray.forEach((target) => {
      // Note: beam uses internal routing, source is not required here
      const eventHandlers = this.handlers.get(`target:${target}:${eventType}`);
      if (eventHandlers) {
        for (const handler of eventHandlers) {
          try {
            handler(payload);
          } catch (error) {
            console.error(`Error in beam handler for ${target}:${eventType}:`, error);
          }
        }
      }
    });
  }

  /**
   * Query an agent(s) and wait for a response
   * @param targets Agent name(s) to query
   * @param queryType Query type name (e.g., 'get-new-items')
   * @param payload Query payload data
   * @param timeout Timeout in milliseconds (default: 5000)
   * @returns Promise that resolves with the response data or rejects on timeout/error
   */
  query(
    targets: string | string[],
    queryType: string,
    payload: unknown,
    timeout: number = 5000
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = `req-${this.requestIdCounter++}`;
      const targetArray = Array.isArray(targets) ? targets : [targets];

      // Listen for response
      const handleResponse = (res: any) => {
        if (res.requestId === requestId) {
          this.off(`response:${requestId}`, handleResponse);
          clearTimeout(timer);
          if (res.error) {
            reject(new Error(res.error));
          } else {
            resolve(res.data);
          }
        }
      };
      this.on(`response:${requestId}`, handleResponse);

      // Timeout
      const timer = setTimeout(() => {
        this.off(`response:${requestId}`, handleResponse);
        reject(new Error(`Query timeout after ${timeout}ms`));
      }, timeout);

      // Send query to all targets
      targetArray.forEach((target) => {
        this.beam(target, queryType, { ...(payload as object), requestId });
      });
    });
  }

  /**
   * Reply to a query
   * @param requestId Request ID from the query payload
   * @param data Response data
   * @param error Error message (if any)
   */
  reply(requestId: string, data: unknown, error: string | null = null): void {
    // Note: reply uses internal routing, source is not required here
    const eventHandlers = this.handlers.get(`response:${requestId}`);
    if (eventHandlers) {
      for (const handler of eventHandlers) {
        try {
          handler({ data, error, requestId });
        } catch (err) {
          console.error(`Error in reply handler for ${requestId}:`, err);
        }
      }
    }
  }

  /**
   * Get all registered events (excluding internal target: and response: events)
   */
  getRegisteredEvents(): Array<{event: string, handlerCount: number}> {
    const events: Array<{event: string, handlerCount: number}> = [];
    for (const [event, handlers] of this.handlers.entries()) {
      // Filter out internal events (target:, response:)
      if (!event.startsWith('target:') && !event.startsWith('response:')) {
        events.push({ event, handlerCount: handlers.size });
      }
    }
    return events;
  }
}
