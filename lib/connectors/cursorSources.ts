import { withTenant } from "@/lib/rls"
import { DAY_MS } from "./facts"

export function cursorDay(value: string | string[] | undefined, now = new Date()): Date | null {
  const day = value ?? now.toISOString().slice(0, 10)
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith("0000")) return null
  const start = new Date(`${day}T00:00:00.000Z`)
  if (!Number.isFinite(start.getTime()) || start > now || start.toISOString().slice(0, 10) !== day) return null
  return start
}

type SourceTotals = {
  kind: "Automation" | "Cloud agent" | "Conversation" | "Unattributed"
  id: string | null
  tokens: bigint
  cached: bigint
  requests: number
  reported: number
}

export function cursorSourceUrl(kind: SourceTotals["kind"], id: string | null) {
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) return null
  const segment = kind === "Automation" ? "automations" : kind === "Cloud agent" ? "agents" : null
  return segment && `https://cursor.com/${segment}/${encodeURIComponent(id)}`
}

export async function cursorSources(walletId: string, start: Date) {
  const where = { walletId, provider: "cursor", bucketStart: { gte: start, lt: new Date(start.getTime() + DAY_MS) } }
  return withTenant(walletId, async (tx) => {
    // Older facts cannot establish product or distinguish missing token data.
    const legacy = await tx.usageFact.count({ where: { ...where, tokenReportedRequests: null } })
    const groups = await tx.usageFact.groupBy({
      by: ["automationRef", "sessionRef"],
      where: { ...where, tokenReportedRequests: { not: null } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, requests: true, tokenReportedRequests: true },
    })
    const sources = new Map<string, SourceTotals>()
    for (const { automationRef, sessionRef, _sum } of groups) {
      const cloudAgent = automationRef?.startsWith("cloud-agent:")
      const kind = automationRef ? (cloudAgent ? "Cloud agent" : "Automation") : sessionRef ? "Conversation" : "Unattributed"
      const id = automationRef?.replace(/^(cloud-agent|automation):/, "") ?? sessionRef
      const key = JSON.stringify([kind, id])
      const row = sources.get(key) ?? { kind, id, tokens: BigInt(0), cached: BigInt(0), requests: 0, reported: 0 }
      const read = _sum.cacheReadTokens ?? BigInt(0)
      row.tokens += (_sum.inputTokens ?? BigInt(0)) + (_sum.outputTokens ?? BigInt(0)) + (_sum.cacheWriteTokens ?? BigInt(0)) + read
      row.cached += read
      row.requests += _sum.requests ?? 0
      row.reported += _sum.tokenReportedRequests ?? 0
      sources.set(key, row)
    }
    const rows = [...sources.values()].sort((a, b) => {
      if (a.tokens !== b.tokens) return a.tokens > b.tokens ? -1 : 1
      return b.requests - a.requests || a.kind.localeCompare(b.kind) || (a.id ?? "").localeCompare(b.id ?? "")
    })
    return { rows, hasLegacy: legacy > 0 }
  })
}
