import { createConnection, createServer, type Socket } from "node:net"

export type QueryMetrics = { queries: number; byVerb: Record<string, number> }

/** A loopback-only PostgreSQL wire proxy. Delays network delivery, never Prisma
 * transactions or SQL execution. No database URLs, SQL values, or credentials
 * are logged. Query/Execute frames supply actual query counts for diagnostics. */
export async function gatewayLatencyProxy(connectionString: string) {
  const target = new URL(connectionString)
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
    throw new Error("Gateway latency tests require a disposable loopback PostgreSQL database")
  }
  if (["host", "hostaddr", "port"].some((key) => target.searchParams.has(key))) {
    throw new Error("Gateway latency tests forbid connection query host overrides")
  }
  let oneWayMs = 0
  let metrics: QueryMetrics = { queries: 0, byVerb: {} }
  const sockets = new Set<Socket>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const count = (verb: string) => {
    metrics.queries++
    metrics.byVerb[verb] = (metrics.byVerb[verb] ?? 0) + 1
  }
  const schedule = (action: () => void) => {
    if (!oneWayMs) { action(); return }
    const timer = setTimeout(() => { timers.delete(timer); action() }, oneWayMs)
    timers.add(timer)
  }
  const server = createServer((downstream) => {
    const upstream = createConnection({ host: target.hostname.replace(/^\[|\]$/g, ""), port: Number(target.port || 5432) })
    for (const socket of [downstream, upstream]) {
      sockets.add(socket)
      socket.setNoDelay(true)
      socket.on("close", () => sockets.delete(socket))
      socket.on("error", () => { downstream.destroy(); upstream.destroy() })
    }
    let pending: Buffer = Buffer.alloc(0)
    let startup = true
    const statements = new Map<string, string>()
    const portals = new Map<string, string>()
    const stringAt = (body: Buffer, offset: number) => {
      const end = body.indexOf(0, offset)
      return { value: body.toString("utf8", offset, end < 0 ? body.length : end), next: end + 1 }
    }
    const verb = (sql: string) => sql.trimStart().match(/^(\w+)/)?.[1]?.toUpperCase() ?? "OTHER"
    const inspect = (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])
      while (pending.length >= (startup ? 4 : 5)) {
        const length = pending.readInt32BE(startup ? 0 : 1)
        const frameLength = length + (startup ? 0 : 1)
        if (length < 4 || frameLength > 16 * 1024 * 1024) throw new Error("Invalid local PostgreSQL frame")
        if (pending.length < frameLength) return
        if (startup) {
          const protocol = pending.readInt32BE(4)
          startup = protocol !== 196608 // SSLRequest, if any, precedes StartupMessage.
        } else {
          const kind = String.fromCharCode(pending[0])
          const body = pending.subarray(5, frameLength)
          if (kind === "Q") count(verb(stringAt(body, 0).value))
          if (kind === "P") {
            const name = stringAt(body, 0)
            statements.set(name.value, verb(stringAt(body, name.next).value))
          }
          if (kind === "B") {
            const portal = stringAt(body, 0)
            portals.set(portal.value, statements.get(stringAt(body, portal.next).value) ?? "OTHER")
          }
          if (kind === "E") count(portals.get(stringAt(body, 0).value) ?? "OTHER")
        }
        pending = pending.subarray(frameLength)
      }
    }
    downstream.on("data", (chunk: Buffer) => {
      try { inspect(chunk) } catch { downstream.destroy(); upstream.destroy(); return }
      schedule(() => { if (!upstream.destroyed) upstream.write(chunk) })
    })
    upstream.on("data", (chunk: Buffer) => schedule(() => { if (!downstream.destroyed) downstream.write(chunk) }))
    downstream.on("end", () => schedule(() => upstream.end()))
    upstream.on("end", () => schedule(() => downstream.end()))
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing local proxy port")
  const proxied = new URL(target)
  proxied.hostname = "127.0.0.1"
  proxied.port = String(address.port)
  proxied.searchParams.set("sslmode", "disable") // Loopback disposable server only.
  return {
    connectionString: proxied.toString(),
    setRoundTripMs(ms: number) {
      if (!Number.isInteger(ms) || ms < 0 || ms > 200) throw new Error("Latency must be bounded to 0–200 ms RTT")
      if (oneWayMs !== ms / 2 && timers.size) throw new Error("Cannot change latency while network deliveries are pending")
      oneWayMs = ms / 2
    },
    resetMetrics() { metrics = { queries: 0, byVerb: {} } },
    metrics: (): QueryMetrics => ({ queries: metrics.queries, byVerb: { ...metrics.byVerb } }),
    async close() {
      for (const timer of timers) clearTimeout(timer)
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    },
  }
}
