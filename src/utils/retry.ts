/**
 * Retry utility with exponential backoff.
 *
 * Only retries on transient errors (network failures, 503, timeouts, aborted).
 * Hard failures like 404 (model not found) are never retried.
 */

export interface RetryOptions {
  /** Maximum number of attempts (default 3) */
  maxRetries?: number;
  /** Base delay in ms before first retry (default 1000) */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default 10000) */
  maxDelayMs?: number;
  /** Optional label for log messages */
  label?: string;
}

const NON_RETRYABLE_PATTERNS = [
  "not found",
  "404",
  "api key",
  "unauthorized",
  "401",
  "403",
  "forbidden",
  "invalid",
];

function isRetryable(error: unknown): boolean {
  const msg = ((error as Error).message || String(error)).toLowerCase();
  if (NON_RETRYABLE_PATTERNS.some((p) => msg.includes(p))) return false;
  return true;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 10_000;
  const label = options.label ?? "operation";

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !isRetryable(error)) {
        throw error;
      }

      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      console.warn(
        `[Retry] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms: ${(error as Error).message}`,
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
