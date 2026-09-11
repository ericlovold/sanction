import { NextRequest, NextResponse } from "next/server"
import { authenticateAgent } from "@/lib/auth"
import { db } from "@/lib/db"
import { normalizeUsage, usageSources, type UsageSource } from "@/lib/usageObservation"

const MAX_BYTES = 1_048_576
const headers = { "cache-control": "no-store" }
export async function POST(req: NextRequest, context: { params: Promise<{ source: string }> }) {
  const { agent, error } = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error }, { status: 401, headers })
  const { source } = await context.params
  if (!usageSources.includes(source as UsageSource)) return NextResponse.json({ error: "Unknown source" }, { status: 404, headers })
  if (req.headers.get("content-type")?.split(";")[0] !== "application/json" || req.headers.has("content-encoding")) {
    return NextResponse.json({ error: "Use uncompressed OTLP HTTP JSON logs" }, { status: 415, headers })
  }
  // Bound the streamed body as well as Content-Length; exporters need not send it.
  const reader = req.body?.getReader()
  if (!reader) return NextResponse.json({ error: "Missing body" }, { status: 400, headers })
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      return NextResponse.json({ error: "Batch exceeds 1 MiB" }, { status: 413, headers })
    }
    chunks.push(value)
  }
  let normalized
  try { normalized = normalizeUsage(source as UsageSource, JSON.parse(Buffer.concat(chunks).toString("utf8"))) }
  catch { return NextResponse.json({ error: "Invalid OTLP JSON logs or usage values" }, { status: 400, headers }) }
  // Observation is not an execution request: a frozen/over-budget wallet still
  // needs evidence of past activity. Revoked/expired credentials remain rejected.
  await db.usageObservation.createMany({
    data: normalized.events.map(event => ({ ...event, agentId: agent.id })), skipDuplicates: true,
  })
  // OTLP ExportLogsServiceResponse. Unsupported events are intentionally ignored.
  return NextResponse.json({}, { headers })
}
