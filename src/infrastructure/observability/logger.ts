// Minimal structured logger — one JSON object per line, no dependencies.
//
// JSON lines are the lingua franca of log aggregators (Datadog, Loki, CloudWatch
// Insights, Vercel), so each call emits a single parseable record with a level,
// timestamp, message, and arbitrary fields. A logger can carry bound context
// (e.g. a requestId) so every line from one request is correlatable.

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
  /** Return a new logger with extra fields merged into every line. */
  child: (fields: LogFields) => Logger;
};

type Sink = (line: string) => void;

export type LoggerOptions = {
  /** Bound fields included on every line (e.g. { requestId }). */
  base?: LogFields;
  /** Where to write. Defaults to console by level. Injectable for tests. */
  sink?: Sink;
  /** Clock, injectable for deterministic tests. */
  now?: () => Date;
};

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function defaultSink(level: LogLevel, line: string): void {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const base = options.base ?? {};
  const now = options.now ?? (() => new Date());

  function write(level: LogLevel, msg: string, fields?: LogFields): void {
    const record = {
      level,
      ts: now().toISOString(),
      msg,
      ...base,
      ...fields,
    };
    const line = JSON.stringify(record);
    if (options.sink) options.sink(line);
    else defaultSink(level, line);
  }

  const logger: Logger = {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
    child: (fields) =>
      createLogger({ ...options, base: { ...base, ...fields } }),
  };
  return logger;
}

export { LEVEL_RANK };

/** Short correlation id for a request. Uses crypto.randomUUID when available. */
export function newRequestId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}
