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

// ANSI escape helpers — no external dependency
const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
  white:  "\x1b[97m",
};

const LEVEL_STYLE: Record<string, string> = {
  ERROR: `${c.bold}${c.red}✖ ERROR${c.reset}`,
  WARN:  `${c.yellow}⚠ WARN ${c.reset}`,
  INFO:  `${c.cyan}✦ INFO ${c.reset}`,
  DEBUG: `${c.gray}· DEBUG${c.reset}`,
};

class Logger {
  private level: LogLevel;
  private prefix: string;
  private logStream: ReturnType<typeof Bun.file> | null = null;
  private logWriter: { write: (s: string) => void } | null = null;

  constructor(options: LoggerOptions = {}) {
    const debug = options.debug !== undefined ? options.debug : isDebugEnabled();
    this.level = debug ? LogLevel.DEBUG : (options.level ?? LogLevel.INFO);
    this.prefix = options.prefix || "";
  }

  /**
   * Tee all future log lines to a file (ANSI codes stripped).
   * Safe to call multiple times — only the last path takes effect.
   */
  setLogFile(path: string): void {
    try {
      const file = Bun.file(path);
      const writer = file.writer({ highWaterMark: 512 });
      this.logWriter = {
        write: (line: string) => {
          // Strip ANSI codes for clean plain-text file output
          const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
          writer.write(plain + "\n");
          writer.flush();
        },
      };
    } catch {
      // If file write fails, silently ignore — console output is unaffected
    }
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
    const ctxStr = context != null && Object.keys(context).length > 0
      ? ` ${c.dim}${JSON.stringify(context)}${c.reset}`
      : "";
    const levelTag = LEVEL_STYLE[level] ?? `[${level}]`;
    const dimTs = `${c.dim}${ts}${c.reset}`;
    const boldMsg = `${c.bold}${message}${c.reset}`;
    return `${dimTs} ${levelTag} ${boldMsg}${ctxStr}`;
  }

  private tee(line: string): void {
    this.logWriter?.write(line);
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
      this.tee(ctx !== undefined ? out : `${this.prefix}[ERROR] ${message}${rest.length ? " " + rest.map(String).join(" ") : ""}`);
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
      this.tee(ctx !== undefined ? out : `${this.prefix}[WARN] ${message}${rest.length ? " " + rest.map(String).join(" ") : ""}`);
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
      this.tee(ctx !== undefined ? out : `${this.prefix}[INFO] ${message}${rest.length ? " " + rest.map(String).join(" ") : ""}`);
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
      this.tee(ctx !== undefined ? out : `${this.prefix}[DEBUG] ${message}${rest.length ? " " + rest.map(String).join(" ") : ""}`);
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