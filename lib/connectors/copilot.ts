// GitHub Copilot connector: pulls what GitHub billed an organization for
// Copilot each day, and splits it across people by each person's own AI
// credit consumption from the daily usage metrics report.
//
// Contract read from docs.github.com on 2026-11-25:
//   Billing (docs.github.com/en/rest/billing/usage)
//     GET /organizations/{org}/settings/billing/ai_credit/usage
//     GET /organizations/{org}/settings/billing/premium_request/usage
//     Query: year, month, day (one day when given), user, model, product.
//     No hour parameter. Fine-grained permission: "Administration" (read).
//     Body: usageItems[] with product, sku, model, unitType, pricePerUnit,
//     grossQuantity, grossAmount, discountQuantity, discountAmount,
//     netQuantity, netAmount (USD). The org response carries no user or date
//     per item: one call per day is what makes the day exact.
//     AI credits replaced premium requests on 2026-06-01; premium_request
//     still reports orgs on legacy annual plans.
//   Usage metrics (docs.github.com/en/rest/copilot/copilot-usage-metrics)
//     GET /orgs/{org}/copilot/metrics/reports/users-1-day?day=YYYY-MM-DD
//     Body: { download_links: [signed URLs], report_day }. 204 = no report.
//     Each link serves NDJSON, one record per user, with user_login and
//     ai_credits_used ("an overall per-user total ... a metrics signal for
//     analyzing consumption, not a billed total").
//     Fine-grained permission: "Organization Copilot metrics" (read), and
//     the org's Copilot usage metrics policy must be on.
//   Headers: Accept: application/vnd.github+json,
//            X-GitHub-Api-Version: 2026-03-10, Authorization: Bearer.
//
// Why split billed money by credits: GitHub's billing is exact per org, day
// and model but names nobody; the metrics report names people but is not a
// bill. Allocating each model's billed amount by credit share keeps every
// dollar reconciled to GitHub's bill, keeps each person's daily total
// proportional to what GitHub says they used, and labels the result
// "allocated" so nobody mistakes the per-person-per-model cell for an invoice
// line. (The billing endpoint can filter by user, which would be exact per
// person, at one call per person per day. Not used here; see the plan doc.)
//
// Usage metadata only. Nothing here reads code, prompts or completions.

import { z } from "zod"
import { ConnectorError, DAY_MS, type ConnectorCredential, type FactInput } from "./facts"
import { allocate, toNanos } from "./money"
import { createRateLimiter, defaultClock, type FetchDeps } from "./pace"

export const GITHUB_API = "https://api.github.com"
export const GITHUB_API_VERSION = "2026-03-10"
export const COPILOT_AI_CREDIT_PATH = "/organizations/{org}/settings/billing/ai_credit/usage"
export const COPILOT_PREMIUM_REQUEST_PATH = "/organizations/{org}/settings/billing/premium_request/usage"
export const COPILOT_USERS_REPORT_PATH = "/orgs/{org}/copilot/metrics/reports/users-1-day"

// GitHub organization logins: letters, digits and single hyphens, 39 at most.
export const GITHUB_ORG_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

// 30 days is about 90 API calls plus one or two downloads a day.
const MAX_CALLS = 400
// A report for a very large org is still far below this; anything above it is
// not a report Sanction should hold in memory.
const MAX_REPORT_BYTES = 50 * 1024 * 1024

const amount = z.union([z.number().finite(), z.string().regex(/^-?\d+(\.\d+)?$/).max(40)])

const usageItem = z.looseObject({
  product: z.string().max(200).nullish(),
  sku: z.string().max(200).nullish(),
  model: z.string().max(200).nullish(),
  netAmount: amount,
  discountAmount: amount.nullish(),
})
const billingPage = z.looseObject({ usageItems: z.array(usageItem).max(10_000) })

const reportLinks = z.looseObject({
  download_links: z.array(z.string().max(4000)).max(100),
  report_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
})

const userRecord = z.looseObject({
  user_login: z.string().min(1).max(100),
  // Absent on a day a person had no credit-metered use.
  ai_credits_used: z.number().finite().nonnegative().nullish(),
})

export type CopilotUsageItem = z.infer<typeof usageItem>
export type CopilotUserRecord = z.infer<typeof userRecord>

function parse<T extends z.ZodType>(schema: T, body: unknown, what: string): z.infer<T> {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    // Field paths only: values here include people's GitHub logins.
    const where = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].slice(0, 5).join(", ")
    throw new ConnectorError("unexpected_response", `GitHub returned ${what} in a shape Sanction does not recognize (${where}).`)
  }
  return parsed.data
}

/**
 * One report file. GitHub documents NDJSON (one record per line); its example
 * shows a JSON array. Both are accepted, and a line that is itself an array is
 * flattened, so the same records come out either way.
 */
export function parseCopilotUserReport(text: string): CopilotUserRecord[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const values: unknown[] = []
  const add = (v: unknown) => (Array.isArray(v) ? values.push(...v) : values.push(v))
  try {
    add(JSON.parse(trimmed))
  } catch {
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        add(JSON.parse(line))
      } catch {
        throw new ConnectorError("unexpected_response", "GitHub's usage report was not valid JSON lines.")
      }
    }
  }
  return values.map((v) => parse(userRecord, v, "a usage report record"))
}

function orgPath(template: string, org: string): string {
  return template.replace("{org}", encodeURIComponent(org))
}

function utcParts(dayMs: number) {
  const d = new Date(dayMs)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), iso: d.toISOString().slice(0, 10) }
}

export function utcDayStart(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS
}

type Resolved = Required<FetchDeps>
type Get = { status: number; body: unknown }

const PERMISSIONS = 'read access to "Administration" and "Organization Copilot metrics"'

/**
 * One authenticated GitHub API GET. 200 returns the body; 204 and (where the
 * caller allows it) 404 return the status with no body. Everything else ends
 * in a ConnectorError the connect screen can act on.
 */
async function githubGet(token: string, org: string, url: string, deps: Resolved, opts: { notFound: "none" | "org" }): Promise<Get> {
  for (let attempt = 0; ; attempt++) {
    await deps.take()
    let res: Response
    try {
      res = await deps.fetch(url, {
        headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": GITHUB_API_VERSION, Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new ConnectorError("provider_unavailable", "Could not reach GitHub. Sanction will try again on the next hourly pull.")
    }
    if (res.status === 204) return { status: 204, body: null }
    if (res.ok) {
      try {
        return { status: res.status, body: await res.json() }
      } catch {
        throw new ConnectorError("unexpected_response", "GitHub returned a response that was not JSON.")
      }
    }
    // GitHub signals a rate limit as 429, or as 403 with no requests left.
    const limited = res.status === 429 || (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")))
    if (limited) {
      if (attempt >= 1) throw new ConnectorError("rate_limited", "GitHub is rate limiting this token. Sanction will try again on the next hourly pull.")
      const retryAfter = Number(res.headers.get("retry-after"))
      const resetAt = Number(res.headers.get("x-ratelimit-reset")) * 1000
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Number.isFinite(resetAt) && resetAt > Date.now() ? resetAt - Date.now() : 60_000
      await deps.sleep(Math.min(waitMs, 90_000))
      continue
    }
    if (res.status === 401) {
      throw new ConnectorError("bad_key", "GitHub rejected this token. It must be a fine-grained token for the organization, copied in full, not expired or revoked.")
    }
    if (res.status === 403) {
      throw new ConnectorError(
        "plan_unsupported",
        `GitHub accepted the token but refused the Copilot report. The token needs ${PERMISSIONS} for ${org}, an organization owner must approve it, and the Copilot usage metrics policy must be on.`,
      )
    }
    if (res.status === 404) {
      if (opts.notFound === "none") return { status: 404, body: null }
      throw new ConnectorError("bad_key", `GitHub found no organization named ${org} that this token can read. Check the name and that the token was created for that organization.`)
    }
    throw new ConnectorError("provider_unavailable", `GitHub returned an error (HTTP ${res.status}). Sanction will try again on the next hourly pull.`)
  }
}

/**
 * Fetch one signed report file. The link is pre-signed by GitHub, so the
 * GitHub token is NEVER sent with it: the file may be served from storage
 * that is not GitHub's API, and the token must not leave api.github.com.
 */
async function downloadReport(link: string, deps: Resolved): Promise<string> {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    throw new ConnectorError("unexpected_response", "GitHub returned a report link that is not a URL.")
  }
  if (url.protocol !== "https:") throw new ConnectorError("unexpected_response", "GitHub returned a report link that is not https.")
  await deps.take()
  let res: Response
  try {
    res = await deps.fetch(url.toString(), { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(60_000) })
  } catch {
    throw new ConnectorError("provider_unavailable", "Could not download GitHub's usage report. Sanction will try again on the next hourly pull.")
  }
  if (!res.ok) {
    throw new ConnectorError("provider_unavailable", `GitHub's usage report download failed (HTTP ${res.status}). Sanction will try again on the next hourly pull.`)
  }
  const declared = Number(res.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_REPORT_BYTES) {
    throw new ConnectorError("unexpected_response", "GitHub's usage report is larger than Sanction reads in one pull. Contact Sanction support.")
  }
  const text = await res.text()
  if (text.length > MAX_REPORT_BYTES) {
    throw new ConnectorError("unexpected_response", "GitHub's usage report is larger than Sanction reads in one pull. Contact Sanction support.")
  }
  return text
}

export type CopilotDay = {
  dayMs: number
  items: CopilotUsageItem[]
  // null when GitHub has no report for the day yet (204 or 404).
  users: CopilotUserRecord[] | null
}

export type CopilotPull = { days: CopilotDay[]; httpCalls: number }

function resolve(deps: FetchDeps): Resolved {
  return {
    fetch: deps.fetch ?? fetch,
    sleep: deps.sleep ?? defaultClock.sleep,
    // GitHub allows thousands of calls an hour per token; this keeps a
    // 30-day backfill inside the hourly cron's time budget.
    take: deps.take ?? createRateLimiter({ capacity: 60, refillMs: 500 }),
  }
}

function requireOrg(credential: ConnectorCredential): string {
  const org = credential.accountRef?.trim()
  if (!org || !GITHUB_ORG_LOGIN.test(org)) {
    throw new ConnectorError("missing_credential", "This Copilot connection has no GitHub organization. Reconnect it and enter the organization name.")
  }
  return org
}

async function billingItems(token: string, org: string, template: string, dayMs: number, deps: Resolved, notFound: "none" | "org") {
  const { year, month, day } = utcParts(dayMs)
  const query = new URLSearchParams({ year: String(year), month: String(month), day: String(day) })
  const got = await githubGet(token, org, `${GITHUB_API}${orgPath(template, org)}?${query}`, deps, { notFound })
  if (got.body === null) return []
  return parse(billingPage, got.body, "billing usage").usageItems
}

/**
 * Every UTC day that overlaps [startMs, endMs): GitHub's billed items for
 * the day, and its per-person usage report when one exists.
 */
export async function fetchCopilotDays(
  credential: ConnectorCredential,
  window: { startMs: number; endMs: number },
  deps: FetchDeps = {},
): Promise<CopilotPull> {
  const org = requireOrg(credential)
  const resolved = resolve(deps)
  const out: CopilotPull = { days: [], httpCalls: 0 }
  const count = (n = 1) => {
    out.httpCalls += n
    if (out.httpCalls > MAX_CALLS) throw new ConnectorError("unexpected_response", "GitHub returned more usage than one pull can read. Contact Sanction support.")
  }
  for (let dayMs = utcDayStart(window.startMs); dayMs < window.endMs; dayMs += DAY_MS) {
    count(2)
    const items = [
      ...(await billingItems(credential.secret, org, COPILOT_AI_CREDIT_PATH, dayMs, resolved, "org")),
      // Legacy plans only. A 404 here means "no legacy billing", not a bad org:
      // the AI credit call above already proved the org is readable.
      ...(await billingItems(credential.secret, org, COPILOT_PREMIUM_REQUEST_PATH, dayMs, resolved, "none")),
    ]
    count()
    const { iso } = utcParts(dayMs)
    const meta = await githubGet(credential.secret, org, `${GITHUB_API}${orgPath(COPILOT_USERS_REPORT_PATH, org)}?day=${iso}`, resolved, { notFound: "none" })
    let users: CopilotUserRecord[] | null = null
    if (meta.body !== null) {
      const links = parse(reportLinks, meta.body, "a usage report link")
      if (links.report_day && links.report_day !== iso) {
        throw new ConnectorError("unexpected_response", "GitHub returned a usage report for a different day than the one asked for.")
      }
      users = []
      for (const link of links.download_links) {
        count()
        users.push(...parseCopilotUserReport(await downloadReport(link, resolved)))
      }
    }
    out.days.push({ dayMs, items, users })
  }
  return out
}

/** Cheapest calls that prove both permissions: today's bill and yesterday's report. */
export async function probeCopilot(credential: ConnectorCredential, now: Date, deps: FetchDeps = {}): Promise<void> {
  const org = requireOrg(credential)
  const resolved = resolve(deps)
  const today = utcDayStart(now.getTime())
  await billingItems(credential.secret, org, COPILOT_AI_CREDIT_PATH, today, resolved, "org")
  const { iso } = utcParts(today - DAY_MS)
  await githubGet(credential.secret, org, `${GITHUB_API}${orgPath(COPILOT_USERS_REPORT_PATH, org)}?day=${iso}`, resolved, { notFound: "none" })
}

const ZERO = BigInt(0)

function fact(dayMs: number, model: string, rawIdentity: string, identityType: FactInput["identityType"], costNanos: bigint, costBasis: FactInput["costBasis"]): FactInput {
  return {
    provider: "copilot",
    // Copilot spans the IDE, chat, the CLI and the cloud agent; GitHub's bill
    // does not say which, so every row is the editor-side tool.
    surface: "ide",
    rawIdentity,
    identityType,
    model,
    sessionRef: null,
    automationRef: null,
    headless: false,
    bucketStart: new Date(dayMs),
    bucketEnd: new Date(dayMs + DAY_MS),
    inputTokens: ZERO,
    outputTokens: ZERO,
    cacheReadTokens: ZERO,
    cacheWriteTokens: ZERO,
    requests: 0,
    costNanos,
    costBasis,
  }
}

/**
 * Per day and model: what GitHub billed (net) and what the plan covered
 * (discount), split across people by AI credit share. A day with no report,
 * or no one with credits, keeps its money as one unattributed row, so the
 * day's total always matches GitHub's bill.
 */
export function normalizeCopilotDays(days: CopilotDay[]): FactInput[] {
  const facts: FactInput[] = []
  for (const day of days) {
    const byModel = new Map<string, { net: bigint; included: bigint }>()
    for (const item of day.items) {
      const model = item.model?.trim() || "(no model)"
      const sum = byModel.get(model) ?? { net: ZERO, included: ZERO }
      sum.net += toNanos(item.netAmount, "usd")
      if (item.discountAmount != null) sum.included += toNanos(item.discountAmount, "usd")
      byModel.set(model, sum)
    }

    // Logins are case-insensitive on GitHub; one person, one key.
    const credits = new Map<string, bigint>()
    for (const record of day.users ?? []) {
      const login = record.user_login.trim().toLowerCase()
      const used = record.ai_credits_used == null ? ZERO : toNanos(record.ai_credits_used, "usd")
      if (used > ZERO) credits.set(login, (credits.get(login) ?? ZERO) + used)
    }
    const people = [...credits.keys()].sort()
    const weights = people.map((login) => credits.get(login)!)

    for (const [model, sum] of [...byModel.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (const [total, basis] of [[sum.net, "allocated"], [sum.included, "included"]] as const) {
        if (total === ZERO) continue
        // A refund or correction (negative) is never split: it stays whole.
        if (people.length === 0 || total < ZERO) {
          facts.push(fact(day.dayMs, model, "unattributed", "unattributed", total, basis === "allocated" ? "billed" : "included"))
          continue
        }
        allocate(total, weights).forEach((part, i) => {
          if (part !== ZERO) facts.push(fact(day.dayMs, model, `github:${people[i]}`, "user", part, basis))
        })
      }
    }
  }
  return facts
}
