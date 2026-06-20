/**
 * Structured request logger for Sanction API routes.
 * Writes JSON lines to stdout — picked up by Vercel's log drain / any
 * log aggregator. Keeps the format consistent so queries work across routes.
 */

type Level = "info" | "warn" | "error"

interface LogEntry {
  level: Level
  route: string
  msg: string
  [key: string]: unknown
}

export function logger(route: string) {
  function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
    const entry: LogEntry = { level, route, msg, ts: new Date().toISOString(), ...fields }
    // In production Vercel captures stdout; console.error goes to stderr (error logs).
    if (level === "error") {
      console.error(JSON.stringify(entry))
    } else {
      console.log(JSON.stringify(entry))
    }
  }

  return {
    info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
    warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
    error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
  }
}
