import { call } from "./lib"
import type { Keys, Persona } from "./lib"

/** A conservative fixture-use guard, not an authorization simulation.
 * Reporting uses UTC days. Passing does not prove available daily/monthly or
 * ancestor budget, policy conformance, or protection from concurrent writers.
 */
export async function checkPulseFixtures(
  persona: Persona,
  keys: Keys,
  now: () => Date = () => new Date(),
): Promise<string[]> {
  const day = now().toISOString().slice(0, 10)
  const problems: string[] = []
  const pools = new Map<string, { name: string; id: string }[]>()
  for (const name of new Set(persona.pulse.tokens.map((token) => token.seat))) {
    const seat = keys.seats[name]
    if (!seat || !keys.pools[seat.poolName]) {
      problems.push(`${name}: missing seat or pool keys`)
      continue
    }
    const seats = pools.get(seat.poolName) ?? []
    seats.push({ name, id: seat.agentId })
    pools.set(seat.poolName, seats)
  }
  for (const [poolName, seats] of pools) {
    const pool = keys.pools[poolName]
    const query = new URLSearchParams({ wallet_id: pool.walletId, from: day, to: day, group_by: "agent" })
    try {
      const { status, json } = await call<unknown>(`/reporting/summary?${query}`, {
        method: "GET", auth: { mgmt: pool.mgmtKey },
      })
      const report = json as {
        wallet_id?: unknown; scope?: unknown; from?: unknown; to?: unknown;
        truncated?: unknown; by_agent?: unknown;
      } | null
      if (status !== 200 || !report || report.wallet_id !== pool.walletId ||
          report.scope !== "wallet" || report.from !== day || report.to !== day ||
          report.truncated || !Array.isArray(report.by_agent)) {
        problems.push(`${poolName}: unavailable or incomplete fixture report (HTTP ${status})`)
        continue
      }
      for (const seat of seats) {
        const rows = report.by_agent.filter((row) => row && row.agent_id === seat.id)
        const cost = rows[0]?.token_cost_usd
        if (rows.length !== 1 || typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
          problems.push(`${seat.name}: missing or invalid token usage`)
        } else if (cost > 0) {
          problems.push(`${seat.name}: already logged $${cost.toFixed(2)} on ${day} UTC; fixture is not fresh`)
        }
      }
    } catch {
      // Do not print transport errors: they can contain request credentials.
      problems.push(`${poolName}: fixture report request failed`)
    }
  }
  if (now().toISOString().slice(0, 10) !== day) problems.push("UTC date changed during preflight; run again")
  return problems
}
