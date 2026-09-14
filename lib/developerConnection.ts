import { db } from "./db"
import type { UsageSource } from "./usageObservation"

export async function developerConnection(walletId: string, agentId: string, source: UsageSource, now = new Date()) {
  const agents = await db.agent.findMany({
    where: { walletId, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
  })
  const selected = agents.find(agent => agent.id === agentId) ?? null
  // Never let a query-string id read another wallet's activity, or treat an
  // inactive seat's historical delivery as a working connection.
  const latest = selected ? await db.usageObservation.findFirst({
    where: { agentId: selected.id, source, agent: { walletId } },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { receivedAt: true, occurredAt: true },
  }) : null
  return { agents, selected, latest, recent: Boolean(latest && now.getTime() - latest.receivedAt.getTime() <= 15 * 60_000) }
}

export function developerConfig(source: UsageSource) {
  const endpoint = `https://getsanction.com/api/v1/usage/otlp/${source}`
  return source === "codex" ? `[otel]
log_user_prompt = false
exporter = { otlp-http = { endpoint = "${endpoint}", protocol = "json", headers = { "x-api-key" = "YOUR_SEAT_KEY" } } }` : `export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_LOGS_EXPORTER=otlp
export OTEL_METRICS_EXPORTER=none
export OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=${endpoint}
export OTEL_EXPORTER_OTLP_LOGS_HEADERS="x-api-key=$SANCTION_AGENT_KEY"
export OTEL_LOG_USER_PROMPTS=0
export OTEL_LOG_ASSISTANT_RESPONSES=0
export OTEL_LOG_TOOL_DETAILS=0
claude`
}
