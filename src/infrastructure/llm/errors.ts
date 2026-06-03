// Typed errors for the LLM transport layer.
//
// The caller throws these so the retry decorator (and the route) can make
// decisions on structured fields — HTTP status, a server-suggested Retry-After
// delay — instead of pattern-matching on message strings.

export class LlmHttpError extends Error {
  readonly status: number;
  /** Server-suggested wait before retrying, in ms (parsed from Retry-After). */
  readonly retryAfterMs?: number;
  /** Truncated response body, for logs. Never surfaced to the browser. */
  readonly body?: string;

  constructor(status: number, body?: string, retryAfterMs?: number) {
    // Keep the legacy "failed (<status>)" phrasing so existing assertions and
    // log greps keep working.
    super(`LLM request failed (${status}): ${(body ?? "").slice(0, 500)}`);
    this.name = "LlmHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.body = body;
  }
}

export class LlmTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`LLM request timed out after ${timeoutMs}ms`);
    this.name = "LlmTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Parse an HTTP `Retry-After` header into milliseconds. Accepts either a number
 * of seconds (`"30"`) or an HTTP date (`"Wed, 21 Oct 2026 07:28:00 GMT"`).
 * Returns undefined for missing/garbage input or a date in the past.
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  // Numeric form: delta-seconds.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // HTTP-date form.
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  const delta = dateMs - now;
  return delta > 0 ? delta : 0;
}
