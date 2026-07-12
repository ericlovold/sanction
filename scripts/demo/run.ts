#!/usr/bin/env npx tsx
// Demo-company driver (docs/plans/demo-companies.md, PR1+PR2).
//
//   npx tsx scripts/demo/run.ts seed    <persona>            # build the org (idempotent)
//   npx tsx scripts/demo/run.ts history <persona> --days 30  # backdated month of real traffic (needs DATABASE_URL)
//   npx tsx scripts/demo/run.ts pulse   <persona> [--watch]  # today; leaves the stage set
//   npx tsx scripts/demo/run.ts status  <persona>
//
// Environment:
//   SANCTION_API_URL   target API (default http://localhost:3000/api/v1)
//   DEMO_HQ_EMAIL      owner email for the Demo HQ root wallet (required on first seed)
//   DEMO_HQ_WALLET_ID / DEMO_HQ_MGMT   adopt an existing HQ instead of creating one
//   DATABASE_URL       history mode only — direct DB access for the backdate pass
//
// Everything flows through the public REST API — the same path a customer's
// agents take — so every dashboard surface is populated with honest data.
// History mode is the one exception: it drives each day via the API, then
// shifts timestamps with a direct-DB pass (see backdate.ts for the rationale
// and the counter-coherence rules). Keys land in scripts/demo/.keys.<persona>.json
// (gitignored). Run order: seed → history → pulse.

import { API_URL, call, fail, loadKeys, saveKeys, loadHq, saveHq } from "./lib"
import type { Persona, Keys, HqKeys, SpendSpec, TokenLogSpec, OutcomeSpec } from "./lib"
import { meridian } from "./personas/meridian"
import { coastline } from "./personas/coastline"
import { harborwren } from "./personas/harborwren"

const PERSONAS: Record<string, Persona> = { meridian, coastline, harborwren }

// ownerEmail is unique per wallet, so every wallet in the demo tree gets a
// deterministic plus-address off the HQ email: demo@x.com + "meridian-eng"
// → demo+meridian-eng@x.com. Deterministic so re-seeding stays idempotent.
function demoEmail(slug: string): string {
  const base = process.env.DEMO_HQ_EMAIL ?? ""
  const [local, domain] = base.split("@")
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
  return `${local}+${clean}@${domain}`
}

// ── seed ────────────────────────────────────────────────────────────────────

async function createWallet(
  name: string,
  email: string,
  parent?: { walletId: string; mgmtKey: string },
): Promise<{ walletId: string; mgmtKey: string }> {
  const body: Record<string, unknown> = { name, owner_email: email }
  if (parent) body.parent_id = parent.walletId
  const { status, json } = await call<{ id: string; management_key: string; error?: string }>("/wallets", {
    auth: parent ? { mgmt: parent.mgmtKey } : undefined,
    body,
  })
  if (status !== 201 && status !== 200) fail(`create wallet "${name}" → ${status} ${JSON.stringify(json)}`)
  console.log(`  + wallet ${name} (${json.id})`)
  return { walletId: json.id, mgmtKey: json.management_key }
}

async function ensureHq(): Promise<HqKeys> {
  const existing = loadHq()
  if (existing) return existing
  const adopted =
    process.env.DEMO_HQ_WALLET_ID && process.env.DEMO_HQ_MGMT
      ? { walletId: process.env.DEMO_HQ_WALLET_ID, mgmtKey: process.env.DEMO_HQ_MGMT }
      : await createWallet("Demo — Sanction HQ", process.env.DEMO_HQ_EMAIL!)
  saveHq(adopted)
  return adopted
}

async function seed(persona: Persona) {
  const keys = loadKeys(persona.key)
  if (!process.env.DEMO_HQ_EMAIL) fail("DEMO_HQ_EMAIL is required")
  const hq = await ensureHq()
  // Ancestor policies fold into every descendant's decision (deny-overrides up
  // the tree), and a fresh wallet's defaults are tight ($50/day, $50/txn). HQ
  // is the umbrella, not the governor — open its guardrails so each company's
  // own policy is what the demo shows.
  const hp = await call("/wallets/policy", {
    method: "PATCH",
    auth: { mgmt: hq.mgmtKey },
    body: {
      wallet_id: hq.walletId,
      daily_spend_budget_usd: 10000,
      daily_token_budget_usd: 1000,
      per_transaction_max_usd: 5000,
      auto_approve_under_usd: 2500,
      escalate_over_usd: 2500,
      allowed_categories: ["software", "services", "research", "infrastructure", "marketing", "legal"],
    },
  })
  if (hp.status !== 200) fail(`HQ policy → ${hp.status} ${JSON.stringify(hp.json)}`)
  if (!keys.company) {
    keys.company = await createWallet(persona.company, demoEmail(persona.key), hq)
    saveKeys(persona.key, keys)
  }
  const company = keys.company

  const cp = await call("/wallets/policy", {
    method: "PATCH",
    auth: { mgmt: company.mgmtKey },
    body: { wallet_id: company.walletId, ...persona.companyPolicy },
  })
  if (cp.status !== 200) fail(`company policy → ${cp.status} ${JSON.stringify(cp.json)}`)
  console.log(`  ✓ company policy set`)

  for (const pool of persona.pools) {
    if (!keys.pools[pool.name]) {
      const { status, json } = await call<{ id: string; management_key: string }>("/wallets", {
        auth: { mgmt: company.mgmtKey },
        body: { name: pool.name, owner_email: demoEmail(`${persona.key}-${pool.name.split("/").pop()}`), parent_id: company.walletId },
      })
      if (status !== 201 && status !== 200) fail(`create pool "${pool.name}" → ${status} ${JSON.stringify(json)}`)
      keys.pools[pool.name] = { walletId: json.id, mgmtKey: json.management_key }
      saveKeys(persona.key, keys)
      console.log(`  + pool ${pool.name}`)
    }
    const pk = keys.pools[pool.name]
    const pp = await call("/wallets/policy", {
      method: "PATCH",
      auth: { mgmt: pk.mgmtKey },
      body: { wallet_id: pk.walletId, ...pool.policy },
    })
    if (pp.status !== 200) fail(`pool policy "${pool.name}" → ${pp.status} ${JSON.stringify(pp.json)}`)

    for (const seat of pool.seats) {
      if (!keys.seats[seat.name]) {
        const body: Record<string, unknown> = { wallet_id: pk.walletId, name: seat.name, holder: seat.holder }
        if (seat.expiresAt) {
          body.expires_at =
            seat.expiresAt === "past" ? new Date(Date.now() - 24 * 3600 * 1000).toISOString() : seat.expiresAt
        }
        const { status, json } = await call<{ id: string; api_key: string }>("/agents", { auth: { mgmt: pk.mgmtKey }, body })
        if (status !== 201 && status !== 200) fail(`create seat "${seat.name}" → ${status} ${JSON.stringify(json)}`)
        keys.seats[seat.name] = { agentId: json.id, apiKey: json.api_key, poolName: pool.name }
        saveKeys(persona.key, keys)
        console.log(`  + seat ${seat.name} (${seat.holder})${seat.expiresAt === "past" ? " — already expired" : ""}`)
      }
      if (seat.overrides) {
        const s = keys.seats[seat.name]
        const po = await call("/agents", {
          method: "PATCH",
          auth: { mgmt: pk.mgmtKey },
          body: { wallet_id: pk.walletId, agent_id: s.agentId, ...seat.overrides },
        })
        if (po.status !== 200) fail(`seat overrides "${seat.name}" → ${po.status} ${JSON.stringify(po.json)}`)
      }
    }

    for (const v of pool.vault ?? []) {
      const vr = await call("/credentials/vault", {
        auth: { mgmt: pk.mgmtKey },
        body: { wallet_id: pk.walletId, ...v },
      })
      // 409/400 on re-seed (label exists) is fine — idempotent enough.
      if (vr.status !== 201 && vr.status !== 200 && vr.status !== 409 && vr.status !== 400)
        fail(`vault "${v.label}" → ${vr.status} ${JSON.stringify(vr.json)}`)
    }
  }

  console.log(`\nSeeded ${persona.company}.`)
  console.log(`  demo login (the client's view):  /login → paste ${company.mgmtKey.slice(0, 8)}… (full key in .keys.${persona.key}.json)`)
  console.log(`  admin view (your side):          HQ wallet ${hq.walletId}`)
}

// ── shared runners (pulse + history speak the same specs) ───────────────────

type AuthorizeResponse = {
  authorized?: boolean
  status?: string
  code?: string
  request_id?: string
  grant_id?: string
  error?: string
}

type Checker = { check: (label: string, expected: string, actual: string | undefined) => void; mismatches: () => number }

function makeChecker(): Checker {
  let n = 0
  return {
    check: (label, expected, actual) => {
      const ok = expected === actual
      if (!ok) n++
      console.log(`  ${ok ? "✓" : "✗"} ${label} → ${actual}${ok ? "" : ` (expected ${expected})`}`)
    },
    mismatches: () => n,
  }
}

function spendBody(s: SpendSpec, grantId?: string) {
  return {
    action: s.action,
    amount_usd: s.amount_usd,
    merchant: s.merchant,
    category: s.category,
    description: s.description,
    tags: s.tags,
    grant_id: grantId,
  }
}

async function runTokens(keys: Keys, specs: TokenLogSpec[], c: Checker) {
  for (const t of specs) {
    const seat = keys.seats[t.seat] ?? fail(`unknown seat ${t.seat}`)
    const { status } = await call("/tokens", {
      auth: { agent: seat.apiKey },
      body: { model: t.model, tokens_in: t.tokens_in, tokens_out: t.tokens_out, cost_usd: t.cost_usd, task: t.task },
    })
    c.check(`${t.seat} $${t.cost_usd} ${t.task}`, t.expectDenied ? "402" : "200", String(status))
  }
}

async function runSpends(keys: Keys, specs: SpendSpec[], c: Checker, opts: { stagePending: boolean }) {
  for (const s of specs) {
    const seat = keys.seats[s.seat] ?? fail(`unknown seat ${s.seat}`)
    const { json } = await call<AuthorizeResponse>("/authorize", { auth: { agent: seat.apiKey }, body: spendBody(s) })
    c.check(`${s.seat} ${s.merchant} $${s.amount_usd}`, s.expect, json.status)
    if (json.status === "escalated" && json.request_id) {
      if (s.then === "approve-and-redeem") {
        const pool = keys.pools[seat.poolName]
        const ap = await call<{ grant_id?: string }>("/approvals", {
          auth: { mgmt: pool.mgmtKey },
          body: { wallet_id: pool.walletId, request_id: json.request_id, decision: "approve", note: "Demo: approved by owner" },
        })
        if (!ap.json.grant_id) fail(`approve ${s.merchant} returned no grant: ${JSON.stringify(ap.json)}`)
        const redo = await call<AuthorizeResponse>("/authorize", {
          auth: { agent: seat.apiKey },
          body: spendBody(s, ap.json.grant_id),
        })
        c.check(`  ↳ approved by owner, grant redeemed`, "approved", redo.json.status)
      } else if (opts.stagePending) {
        keys.pending.push({ requestId: json.request_id, seat: s.seat, kind: "spend", retry: spendBody(s) })
        console.log(`    ↳ left pending for the live demo (${json.request_id})`)
      }
    }
  }
}

async function runOutcomes(keys: Keys, specs: OutcomeSpec[], c: Checker, occurredAt?: string) {
  for (const o of specs) {
    const seat = keys.seats[o.seat] ?? fail(`unknown seat ${o.seat}`)
    const { status, json } = await call<{ error?: string }>("/outcomes", {
      auth: { agent: seat.apiKey },
      body: { kind: o.kind, value_usd: o.value_usd, play: o.play, dedupe_key: o.dedupe_key, occurred_at: o.occurred_at ?? occurredAt },
    })
    c.check(`${o.seat} outcome ${o.kind} (${o.dedupe_key})`, "ok", json.error ? `${status} ${json.error}` : "ok")
  }
}

// ── pulse ───────────────────────────────────────────────────────────────────

async function pulse(persona: Persona, watch: boolean) {
  const keys = loadKeys(persona.key)
  if (!keys.company) fail(`no keys for "${persona.key}" — run seed first`)
  const c = makeChecker()
  keys.pending = [] // reset staging; re-pulse restages

  for (const f of persona.pulse.freezePools ?? []) {
    const pool = keys.pools[f.pool] ?? fail(`unknown pool ${f.pool}`)
    const { status, json } = await call<{ frozen?: boolean }>("/wallets/freeze", {
      auth: { mgmt: pool.mgmtKey },
      body: { wallet_id: pool.walletId, reason: f.reason },
    })
    c.check(`freeze ${f.pool.split("/").pop()}`, "frozen", status === 200 && json.frozen ? "frozen" : `${status}`)
  }

  for (const seatName of persona.pulse.expiredSeats ?? []) {
    const seat = keys.seats[seatName] ?? fail(`unknown seat ${seatName}`)
    const { status } = await call("/authorize", {
      auth: { agent: seat.apiKey },
      body: { action: "purchase", amount_usd: 5, merchant: "Anywhere", category: "software" },
    })
    c.check(`${seatName} (expired contractor) fails closed`, "401", String(status))
  }

  console.log("tokens:")
  await runTokens(keys, persona.pulse.tokens, c)
  console.log("spends:")
  await runSpends(keys, persona.pulse.spends, c, { stagePending: true })
  if (persona.pulse.outcomes?.length) {
    console.log("outcomes:")
    await runOutcomes(keys, persona.pulse.outcomes, c)
  }

  console.log("tools:")
  for (const t of persona.pulse.tools) {
    const seat = keys.seats[t.seat] ?? fail(`unknown seat ${t.seat}`)
    const body = { tool: t.tool, server: t.server }
    const { json } = await call<AuthorizeResponse>("/authorize/tool", { auth: { agent: seat.apiKey }, body })
    c.check(`${t.seat} ${t.tool}`, t.expect, json.status)
    if (json.status === "escalated" && json.request_id && t.then === "leave-pending") {
      keys.pending.push({ requestId: json.request_id, seat: t.seat, kind: "tool", retry: body })
      console.log(`    ↳ left pending for the live demo (${json.request_id})`)
    }
  }

  if (persona.pulse.injections.length) console.log("credential injections:")
  for (const inj of persona.pulse.injections) {
    const seat = keys.seats[inj.seat] ?? fail(`unknown seat ${inj.seat}`)
    const ex = await call<{ jwt?: string; error?: string }>("/exec", {
      auth: { agent: seat.apiKey },
      body: { scope: [inj.label], budget_usd: inj.budget_usd, ttl_seconds: 300 },
    })
    if (!ex.json.jwt) fail(`exec for ${inj.seat} → ${JSON.stringify(ex.json)}`)
    const injected = await call<{ value?: string }>("/credentials/inject", {
      auth: { bearer: ex.json.jwt },
      body: { credential_label: inj.label },
    })
    c.check(`${inj.seat} inject ${inj.label}`, "ok", injected.json.value ? "ok" : "missing")
  }

  saveKeys(persona.key, keys)
  console.log(
    `\nPulse complete — ${keys.pending.length} escalation(s) left pending on stage.` +
      (c.mismatches() ? ` ${c.mismatches()} EXPECTATION MISMATCH(ES).` : ""),
  )
  if (c.mismatches()) process.exit(1)
  if (watch) await watchPending(persona)
}

// ── history ─────────────────────────────────────────────────────────────────

async function history(persona: Persona, days: number) {
  if (!persona.history) fail(`persona "${persona.key}" has no history generator`)
  const keys = loadKeys(persona.key)
  if (!keys.company) fail(`no keys for "${persona.key}" — run seed first`)
  const { backdateWindow } = await import("./backdate")
  const agentIds = Object.values(keys.seats).map((s) => s.agentId)
  const walletIds = [keys.company.walletId, ...Object.values(keys.pools).map((p) => p.walletId)]

  console.log(`Generating ${days - 1} backdated days for ${persona.company} (oldest first)…`)
  for (let day = days - 1; day >= 1; day--) {
    const plan = persona.history(day)
    const nothing = !plan.tokens.length && !plan.spends.length && !(plan.outcomes?.length ?? 0)
    if (nothing) continue
    const batchStart = new Date(Date.now() - 2000)
    const occurredAt = new Date(Date.now() - day * 24 * 3600 * 1000).toISOString()
    const c = makeChecker()
    await runTokens(keys, plan.tokens, c)
    await runSpends(keys, plan.spends, c, { stagePending: false })
    if (plan.outcomes?.length) await runOutcomes(keys, plan.outcomes, c, occurredAt)
    if (c.mismatches()) fail(`day -${day}: ${c.mismatches()} expectation mismatch(es) — stopping before backdate`)
    const shifted = await backdateWindow({ since: batchStart, days: day, agentIds, walletIds })
    console.log(`  day -${day}: ${shifted.authRows} decisions + ${shifted.tokenRows} token logs shifted`)
  }
  console.log(`History complete. Run pulse for today's staged state.`)
}

// Poll the staged escalations; when the owner approves one in the dashboard,
// redeem the grant and complete the original request — the live A→B moment.
async function watchPending(persona: Persona) {
  const keys = loadKeys(persona.key)
  console.log(`\nWatching ${keys.pending.length} pending request(s) — approve in the dashboard and watch them complete. Ctrl-C to stop.`)
  while (keys.pending.length > 0) {
    await new Promise((r) => setTimeout(r, 5000))
    for (const p of [...keys.pending]) {
      const seat = keys.seats[p.seat]
      const { json } = await call<AuthorizeResponse>(`/authorize/${encodeURIComponent(p.requestId)}`, {
        auth: { agent: seat.apiKey },
      })
      if (json.status === "approved" && json.grant_id) {
        const path = p.kind === "spend" ? "/authorize" : "/authorize/tool"
        const redo = await call<AuthorizeResponse>(path, {
          auth: { agent: seat.apiKey },
          body: { ...p.retry, grant_id: json.grant_id },
        })
        console.log(`  ✓ ${p.seat} ${p.requestId} approved → redeemed → ${redo.json.status}`)
        keys.pending = keys.pending.filter((x) => x.requestId !== p.requestId)
        saveKeys(persona.key, keys)
      } else if (json.status === "denied") {
        console.log(`  ✗ ${p.seat} ${p.requestId} denied by owner — agent stands down`)
        keys.pending = keys.pending.filter((x) => x.requestId !== p.requestId)
        saveKeys(persona.key, keys)
      }
    }
  }
  console.log("All staged escalations resolved.")
}

// ── status ──────────────────────────────────────────────────────────────────

async function status(persona: Persona) {
  const keys = loadKeys(persona.key)
  if (!keys.company) fail(`no keys for "${persona.key}" — run seed first`)
  const stats = await call<Record<string, unknown>>(`/wallets/stats?wallet_id=${keys.company.walletId}`, {
    auth: { mgmt: keys.company.mgmtKey },
  })
  console.log(`${persona.company} (${API_URL})`)
  console.log(JSON.stringify(stats.json, null, 2))
  for (const [name, pool] of Object.entries(keys.pools)) {
    const pending = await call<{ pending?: unknown[] }>(`/approvals?wallet_id=${pool.walletId}`, {
      auth: { mgmt: pool.mgmtKey },
    })
    console.log(`  ${name}: ${pending.json.pending?.length ?? 0} pending approval(s)`)
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const [cmd, personaKey, ...flags] = process.argv.slice(2)
const persona = PERSONAS[personaKey ?? ""]
if (!cmd || !persona) fail(`usage: run.ts <seed|history|pulse|status> <${Object.keys(PERSONAS).join("|")}> [--days N] [--watch]`)

if (cmd === "seed") await seed(persona)
else if (cmd === "history") {
  const di = flags.indexOf("--days")
  const days = di >= 0 ? Number(flags[di + 1]) : 30
  if (!Number.isInteger(days) || days < 2 || days > 90) fail("--days must be an integer between 2 and 90")
  await history(persona, days)
} else if (cmd === "pulse") await pulse(persona, flags.includes("--watch"))
else if (cmd === "status") await status(persona)
else fail(`unknown command "${cmd}"`)
