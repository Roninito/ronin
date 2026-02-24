/**
 * Cron Evaluator - Phase 7
 *
 * Evaluates cron expressions to determine if they match current time
 *
 * Format: "minute hour day month weekday"
 * Values:
 *   - minute: 0-59
 *   - hour: 0-23
 *   - day: 1-31
 *   - month: 1-12
 *   - weekday: 0-6 (0 = Sunday)
 *
 * Special:
 *   - asterisk = any value
 *   - asterisk/N = every N values
 *   - N-M = range
 *   - N,M = list
 */

/**
 * Cron Evaluator
 */
export class CronEvaluator {
  /**
   * Check if cron expression matches current time
   */
  static matches(expression: string, now: Date = new Date()): boolean {
    const parts = expression.trim().split(/\s+/);

    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: expected 5 parts, got ${parts.length}`);
    }

    const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = parts;

    const minute = now.getMinutes();
    const hour = now.getHours();
    const day = now.getDate();
    const month = now.getMonth() + 1; // getMonth is 0-indexed
    const weekday = now.getDay();

    // All parts must match
    return (
      this.matchesPart(minutePart, minute, 0, 59) &&
      this.matchesPart(hourPart, hour, 0, 23) &&
      this.matchesPart(dayPart, day, 1, 31) &&
      this.matchesPart(monthPart, month, 1, 12) &&
      this.matchesPart(weekdayPart, weekday, 0, 6)
    );
  }

  /**
   * Check if a cron part matches the value
   */
  private static matchesPart(
    part: string,
    value: number,
    min: number,
    max: number
  ): boolean {
    // * matches any
    if (part === "*") return true;

    // */N matches every N
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2), 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value: ${part}`);
      }
      return value % step === 0;
    }

    // N-M range
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((s) => parseInt(s, 10));
      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid range: ${part}`);
      }
      return value >= start && value <= end;
    }

    // N,M,O list
    if (part.includes(",")) {
      const values = part.split(",").map((s) => parseInt(s, 10));
      if (values.some(isNaN)) {
        throw new Error(`Invalid list: ${part}`);
      }
      return values.includes(value);
    }

    // Single number
    const num = parseInt(part, 10);
    if (isNaN(num)) {
      throw new Error(`Invalid cron part: ${part}`);
    }
    return value === num;
  }

  /**
   * Get next execution time for cron expression
   */
  static getNextExecution(expression: string, from: Date = new Date()): Date {
    // Start from next minute
    const next = new Date(from);
    next.setSeconds(0);
    next.setMilliseconds(0);
    next.setMinutes(next.getMinutes() + 1);

    // Search up to 4 years (reasonable limit)
    const maxTime = new Date(next);
    maxTime.setFullYear(maxTime.getFullYear() + 4);

    while (next <= maxTime) {
      if (this.matches(expression, next)) {
        return next;
      }
      next.setMinutes(next.getMinutes() + 1);
    }

    throw new Error(`No execution time found for cron: ${expression}`);
  }

  /**
   * Get next N execution times
   */
  static getNextExecutions(
    expression: string,
    count: number,
    from: Date = new Date()
  ): Date[] {
    const executions: Date[] = [];
    let current = from;

    for (let i = 0; i < count; i++) {
      current = this.getNextExecution(expression, current);
      executions.push(new Date(current));
      current = new Date(current.getTime() + 60000); // Move to next minute
    }

    return executions;
  }
}

/**
 * Cron Expression Helper - more readable alternatives
 */
export const CronPatterns = {
  // Common patterns
  every_minute: "* * * * *",
  every_5_minutes: "*/5 * * * *",
  every_hour: "0 * * * *",
  every_day_midnight: "0 0 * * *",
  every_day_9am: "0 9 * * *",
  every_monday_9am: "0 9 * * 1",
  weekdays_9am: "0 9 * * 1-5",
  first_day_of_month_midnight: "0 0 1 * *",
  first_day_of_month_3am: "0 3 1 * *",
};

/**
 * Build cron expression programmatically
 */
export class CronBuilder {
  private parts: string[] = ["*", "*", "*", "*", "*"];

  atMinute(minute: number): this {
    this.parts[0] = String(minute);
    return this;
  }

  everyMinutes(step: number): this {
    this.parts[0] = `*/${step}`;
    return this;
  }

  atHour(hour: number): this {
    this.parts[1] = String(hour);
    return this;
  }

  everyHours(step: number): this {
    this.parts[1] = `*/${step}`;
    return this;
  }

  atDay(day: number): this {
    this.parts[2] = String(day);
    return this;
  }

  atMonth(month: number): this {
    this.parts[3] = String(month);
    return this;
  }

  onWeekday(weekday: number | number[]): this {
    if (Array.isArray(weekday)) {
      this.parts[4] = weekday.join(",");
    } else {
      this.parts[4] = String(weekday);
    }
    return this;
  }

  build(): string {
    return this.parts.join(" ");
  }
}
