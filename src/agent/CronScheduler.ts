/**
 * Simple cron expression parser and scheduler
 * Supports: minute hour day month weekday
 * Cron format: minute hour day month weekday
 */
export class CronScheduler {
  private intervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  /**
   * Parse a cron expression and return the next execution time
   */
  private parseCron(cronExpr: string): number {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: ${cronExpr}`);
    }

    const [minute, hour, day, month, weekday] = parts;

    // For now, we'll support simple patterns:
    // - "*" means every
    // - "*/N" means every N
    // - "N" means specific value

    // Calculate next execution time (simplified - runs every minute and checks)
    // For a more robust implementation, we'd calculate the actual next time
    return 60000; // Check every minute
  }

  /**
   * Schedule a function to run based on a cron expression
   */
  schedule(cronExpr: string, fn: () => void): () => void {
    // For simplicity, we'll check every minute if the cron matches
    const interval = setInterval(() => {
      if (this.matchesCron(cronExpr, new Date())) {
        fn();
      }
    }, 60000); // Check every minute

    const id = `${cronExpr}-${Date.now()}`;
    this.intervals.set(id, interval);

    // Return cleanup function
    return () => {
      const interval = this.intervals.get(id);
      if (interval) {
        clearInterval(interval);
        this.intervals.delete(id);
      }
    };
  }

  /**
   * Check if current time matches cron expression
   */
  private matchesCron(cronExpr: string, now: Date): boolean {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) {
      return false;
    }

    const [minute, hour, day, month, weekday] = parts;

    const matches = (pattern: string, value: number, max: number): boolean => {
      if (pattern === "*") return true;
      if (pattern.startsWith("*/")) {
        const n = parseInt(pattern.slice(2));
        if (isNaN(n) || n <= 0) return false;
        // For modulo to work correctly, we need to handle the case where value is 0
        // For example, "*/6" should match 0, 6, 12, 18, etc.
        return n > 0 && value % n === 0;
      }
      const n = parseInt(pattern);
      return !isNaN(n) && n === value;
    };

    return (
      matches(minute, now.getMinutes(), 59) &&
      matches(hour, now.getHours(), 23) &&
      matches(day, now.getDate(), 31) &&
      matches(month, now.getMonth() + 1, 12) &&
      matches(weekday, now.getDay(), 6)
    );
  }

  /**
   * Clear all scheduled jobs
   */
  clearAll(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }
}

