// Prototype command line. Reads local files and prints; it has no network
// code at all, so running it cannot send anything anywhere.
//
//   sanction-collector scan    [--tools claude_code,codex] [--since 2026-11-01]
//   sanction-collector preview [--tools ...] [--since ...]   the exact batch body
//   sanction-collector keygen  [--out <file>]                a device key pair

import { writeFileSync } from "node:fs"
import { buildBatch, encodeBatch, generateDeviceKey } from "./batch"
import { COLLECTOR_TOOLS, type CollectorTool } from "./record"
import { scan } from "./scan"

type Out = { log: (line: string) => void; error: (line: string) => void }

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function toolsOf(argv: string[]): CollectorTool[] {
  const raw = flag(argv, "--tools")
  if (!raw) return [...COLLECTOR_TOOLS]
  const picked = raw.split(",").map((t) => t.trim())
  const unknown = picked.filter((t) => !(COLLECTOR_TOOLS as readonly string[]).includes(t))
  if (unknown.length) throw new Error(`unknown tool: ${unknown.join(", ")} (known: ${COLLECTOR_TOOLS.join(", ")})`)
  return picked as CollectorTool[]
}

function sinceOf(argv: string[]): Date | null {
  const raw = flag(argv, "--since")
  if (!raw) return null
  const d = new Date(raw)
  if (!Number.isFinite(d.getTime())) throw new Error(`--since is not a date: ${raw}`)
  return d
}

export function main(argv: string[], out: Out = console): number {
  const [command, ...rest] = argv
  try {
    if (command === "scan" || command === "preview") {
      const result = scan({ tools: toolsOf(rest), since: sinceOf(rest) })
      if (command === "preview") {
        // The encoded body, re-indented for reading: the same content, field for field.
        out.log(JSON.stringify(JSON.parse(encodeBatch(buildBatch({ deviceId: "unpaired", ...result }))), null, 2))
        return 0
      }
      const byDay = new Map<string, { requests: number; tokens: number }>()
      for (const f of result.facts) {
        const key = `${f.hourStart.slice(0, 10)}  ${f.tool.padEnd(11)}  ${f.model}`
        const row = byDay.get(key) ?? { requests: 0, tokens: 0 }
        row.requests += f.requests
        row.tokens += f.inputTokens + f.outputTokens + f.cacheReadTokens + f.cacheWriteTokens
        byDay.set(key, row)
      }
      for (const [key, row] of [...byDay].sort()) out.log(`${key}  ${row.requests} requests  ${row.tokens} tokens`)
      for (const w of result.planWindows.slice(-4)) {
        out.log(`${w.tool} plan ${w.limitId}/${w.window}: ${w.lastPercent}% of ${w.windowMinutes} min window`)
      }
      for (const h of result.health) {
        out.log(`${h.parser}: ${h.files} files, ${h.records} requests, ${h.usageLinesWithoutUsage} unreadable usage lines, ${h.unknownLineTypes} unknown lines, ${h.skippedFiles} skipped files`)
      }
      return 0
    }
    if (command === "keygen") {
      const key = generateDeviceKey()
      const path = flag(rest, "--out")
      if (path) writeFileSync(path, key.privateKeyPem, { mode: 0o600, flag: "wx" })
      out.log(`public key: ${key.publicKey}`)
      if (!path) out.log("private key not saved (pass --out <file>)")
      return 0
    }
    out.error("usage: sanction-collector scan|preview|keygen [--tools claude_code,codex] [--since <date>] [--out <file>]")
    return 2
  } catch (e) {
    out.error((e as Error).message)
    return 1
  }
}
