/**
 * Structured logging with redaction built in.
 *
 * Small on purpose: one JSON line per event, no transports, no child-logger
 * machinery. What matters is what never reaches it — capabilities, join codes,
 * hashes and raw coordinates are stripped here rather than left to the discipline
 * of every call site.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are never printed, whatever they contain. */
const REDACTED_KEYS = new Set([
  'authorization',
  'token',
  'contributorToken',
  'opsToken',
  'joinCode',
  'joinCodeHash',
  'tokenHash',
  'opsTokenHash',
  'cookie',
  'set-cookie',
  'lat',
  'lon',
  'latitude',
  'longitude',
]);

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(
  level: LogLevel,
  sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  function emit(entryLevel: LogLevel, message: string, fields?: Record<string, unknown>) {
    if (LEVEL_ORDER[entryLevel] < LEVEL_ORDER[level]) return;
    const payload = {
      ts: new Date().toISOString(),
      level: entryLevel,
      msg: message,
      ...(redact(fields ?? {}) as Record<string, unknown>),
    };
    sink(JSON.stringify(payload));
  }

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

/** Replace sensitive values, and keep the structure shallow and bounded. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value === null || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(key.toLowerCase())) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = redact(entry, depth + 1);
  }
  return out;
}
