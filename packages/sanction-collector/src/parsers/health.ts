// What a parser saw, in counts only. Sent with every batch so the server can
// tell "this person stopped using the tool" from "the tool changed its log
// format and our parser went blind", without any content leaving the device.

export type ParserHealth = {
  parser: string
  files: number
  lines: number
  records: number
  // Lines that were not JSON. A truncated last line during a live write is normal.
  malformedLines: number
  // Line types this parser version does not know. A jump here is format drift.
  unknownLineTypes: number
  // Lines of a usage-bearing type with no usable usage. The clearest drift signal.
  usageLinesWithoutUsage: number
  // Files present but not readable by this version (e.g. a new compressed format).
  skippedFiles: number
  toolVersions: string[]
}

export function emptyHealth(parser: string): ParserHealth {
  return {
    parser, files: 0, lines: 0, records: 0, malformedLines: 0,
    unknownLineTypes: 0, usageLinesWithoutUsage: 0, skippedFiles: 0, toolVersions: [],
  }
}

export function noteVersion(health: ParserHealth, version: string | null): void {
  if (version && !health.toolVersions.includes(version) && health.toolVersions.length < 20) {
    health.toolVersions.push(version)
  }
}

export function parseLine(line: string, health: ParserHealth): Record<string, unknown> | null {
  if (line.trim() === "") return null
  health.lines++
  try {
    const value: unknown = JSON.parse(line)
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // fall through
  }
  health.malformedLines++
  return null
}

export function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}
