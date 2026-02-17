export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export type LogContext = Record<string, unknown>;

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  /** Enable debug mode: show DEBUG level and timestamps. From env DEBUG, RONIN_DEBUG or --debug by default. */
  debug?: boolean;
}

function isDebugEnabled(): boolean {
  return (
    process.env.DEBUG === "true" ||
    process.env.RONIN_DEBUG === "true" ||
    process.argv.includes("--debug")
  );
}

class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    const debug = options.debug !== undefined ? options.debug : isDebugEnabled();
    this.level = debug ? LogLevel.DEBUG : (options.level ?? LogLevel.INFO);
    this.prefix = options.prefix || "";
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** Enable or disable debug mode (shows DEBUG level and timestamps). */
  setDebug(debug: boolean): void {
    this.level = debug ? LogLevel.DEBUG : LogLevel.INFO;
  }

  isDebugMode(): boolean {
    return this.level >= LogLevel.DEBUG;
  }

  private format(level: string, message: string, context?: LogContext): string {
    const ts = new Date().toISOString();
    const ctxStr = context != null && Object.keys(context).length > 0 ? " " + JSON.stringify(context) : "";
    return `${ts} [${level}] ${message}${ctxStr}`.trim();
  }

  error(message: string, context?: LogContext): void;
  error(message: string, ...args: any[]): void;
  error(message: string, contextOrArg?: LogContext | any, ...args: any[]): void {
    if (this.level >= LogLevel.ERROR) {
      const ctx = contextOrArg != null && typeof contextOrArg === "object" && !Array.isArray(contextOrArg) ? contextOrArg as LogContext : undefined;
      const rest = ctx !== undefined ? args : (contextOrArg !== undefined ? [contextOrArg, ...args] : []);
      const out = ctx !== undefined ? this.format("ERROR", message, ctx) : `${this.prefix}[ERROR] ${message}`;
      if (rest.length > 0) console.error(out, ...rest);
      else console.error(out);
    }
  }

  warn(message: string, context?: LogContext): void;
  warn(message: string, ...args: any[]): void;
  warn(message: string, contextOrArg?: LogContext | any, ...args: any[]): void {
    if (this.level >= LogLevel.WARN) {
      const ctx = contextOrArg != null && typeof contextOrArg === "object" && !Array.isArray(contextOrArg) ? contextOrArg as LogContext : undefined;
      const rest = ctx !== undefined ? args : (contextOrArg !== undefined ? [contextOrArg, ...args] : []);
      const out = ctx !== undefined ? this.format("WARN", message, ctx) : `${this.prefix}[WARN] ${message}`;
      if (rest.length > 0) console.warn(out, ...rest);
      else console.warn(out);
    }
  }

  info(message: string, context?: LogContext): void;
  info(message: string, ...args: any[]): void;
  info(message: string, contextOrArg?: LogContext | any, ...args: any[]): void {
    if (this.level >= LogLevel.INFO) {
      const ctx = contextOrArg != null && typeof contextOrArg === "object" && !Array.isArray(contextOrArg) ? contextOrArg as LogContext : undefined;
      const rest = ctx !== undefined ? args : (contextOrArg !== undefined ? [contextOrArg, ...args] : []);
      const out = ctx !== undefined ? this.format("INFO", message, ctx) : `${this.prefix}[INFO] ${message}`;
      if (rest.length > 0) console.log(out, ...rest);
      else console.log(out);
    }
  }

  debug(message: string, context?: LogContext): void;
  debug(message: string, ...args: any[]): void;
  debug(message: string, contextOrArg?: LogContext | any, ...args: any[]): void {
    if (this.level >= LogLevel.DEBUG) {
      const ctx = contextOrArg != null && typeof contextOrArg === "object" && !Array.isArray(contextOrArg) ? contextOrArg as LogContext : undefined;
      const rest = ctx !== undefined ? args : (contextOrArg !== undefined ? [contextOrArg, ...args] : []);
      const out = ctx !== undefined ? this.format("DEBUG", message, ctx) : `${this.prefix}[DEBUG] ${message}`;
      if (rest.length > 0) console.log(out, ...rest);
      else console.log(out);
    }
  }

  // Convenience methods for formatted output
  log(message: string, ...args: any[]): void {
    this.info(message, ...args);
  }

  success(message: string, ...args: any[]): void {
    this.info(`✅ ${message}`, ...args);
  }

  warning(message: string, ...args: any[]): void {
    this.warn(`⚠️ ${message}`, ...args);
  }

  fatal(message: string, ...args: any[]): void {
    this.error(`❌ ${message}`, ...args);
  }
}

// Global logger instance
const globalLogger = new Logger();

/** Global logger with setDebug/isDebugMode for interactive and CLI. */
export const logger = globalLogger;

export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}

export function setLogLevel(level: LogLevel): void {
  globalLogger.setLevel(level);
}

export function setDebug(debug: boolean): void {
  globalLogger.setDebug(debug);
}

export function getLogLevel(): LogLevel {
  return globalLogger["level"] as LogLevel;
}

// Export convenience functions that use the global logger
export function error(message: string, context?: LogContext): void;
export function error(message: string, ...args: any[]): void;
export function error(message: string, contextOrArg?: LogContext | any, ...args: any[]): void {
  globalLogger.error(message, contextOrArg as any, ...args);
}

export function warn(message: string, context?: LogContext): void;
export function warn(message: string, ...args: any[]): void;
export function warn(message: string, contextOrArg?: LogContext | any, ...args: any[]): void {
  globalLogger.warn(message, contextOrArg as any, ...args);
}

export function info(message: string, context?: LogContext): void;
export function info(message: string, ...args: any[]): void;
export function info(message: string, contextOrArg?: LogContext | any, ...args: any[]): void {
  globalLogger.info(message, contextOrArg as any, ...args);
}

export function debug(message: string, context?: LogContext): void;
export function debug(message: string, ...args: any[]): void;
export function debug(message: string, contextOrArg?: LogContext | any, ...args: any[]): void {
  globalLogger.debug(message, contextOrArg as any, ...args);
}

export function log(message: string, ...args: any[]): void {
  globalLogger.log(message, ...args);
}

export function success(message: string, ...args: any[]): void {
  globalLogger.success(message, ...args);
}

export function warning(message: string, ...args: any[]): void {
  globalLogger.warning(message, ...args);
}

export function fatal(message: string, ...args: any[]): void {
  globalLogger.fatal(message, ...args);
}

export default globalLogger;