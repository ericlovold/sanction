// First-touch acquisition attribution. The proxy/middleware captures the
// channel (utm params, ?src=, or an external referrer) into a cookie on the
// visitor's first request; signup (app/start/actions.ts) reads the cookie and
// stamps the values onto the Wallet row. Analytics-grade by design: values are
// clamped and sanitized, capture is first-touch-wins, and nothing downstream
// may treat these fields as authoritative.

export const ACQ_COOKIE = "sanction_acq"
export const ACQ_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export type Acquisition = {
  source?: string
  medium?: string
  campaign?: string
  referrer?: string
  landing?: string
}

// Attacker-controlled input headed for the DB: printable, bounded, no exotica.
function clean(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const v = value.replace(/[^\x20-\x7E]/g, "").trim().slice(0, 100)
  return v || undefined
}

/** Derive first-touch attribution from a request URL + Referer header.
 *  Returns null when there's nothing attributable (no utm/src, same-site or
 *  absent referrer) — the cookie should not be set in that case. */
export function acquisitionFromRequest(url: URL, referer: string | null): Acquisition | null {
  const p = url.searchParams
  const source = clean(p.get("utm_source") ?? p.get("src") ?? p.get("ref"))
  const medium = clean(p.get("utm_medium"))
  const campaign = clean(p.get("utm_campaign"))

  let referrer: string | undefined
  if (referer) {
    try {
      const host = new URL(referer).host
      if (host && host !== url.host) referrer = clean(host)
    } catch {
      // unparseable Referer header — ignore
    }
  }

  if (!source && !medium && !campaign && !referrer) return null
  return { source, medium, campaign, referrer, landing: clean(url.pathname) }
}

/** Parse the acquisition cookie defensively: junk JSON, wrong shapes, and
 *  oversized values all degrade to null / dropped fields, never a throw. */
export function parseAcquisitionCookie(raw: string | undefined): Acquisition | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const rec = parsed as Record<string, unknown>
  const pick = (k: string) => clean(typeof rec[k] === "string" ? (rec[k] as string) : undefined)
  const acq: Acquisition = {
    source: pick("source"),
    medium: pick("medium"),
    campaign: pick("campaign"),
    referrer: pick("referrer"),
    landing: pick("landing"),
  }
  return acq.source || acq.medium || acq.campaign || acq.referrer ? acq : null
}
