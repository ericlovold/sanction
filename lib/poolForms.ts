const MAX_CAP_USD = 1_000_000

export function parsePoolCapDollars(value: FormDataEntryValue | null): { ok: true; cents: number | null } | { ok: false; error: string } {
  const raw = String(value ?? "").trim()
  if (raw === "") return { ok: true, cents: null }

  const dollars = Number(raw)
  if (!Number.isFinite(dollars) || dollars < 0) {
    return { ok: false, error: "Enter a non-negative cap." }
  }
  if (dollars > MAX_CAP_USD) {
    return { ok: false, error: "Cap is too large." }
  }

  return { ok: true, cents: Math.round(dollars * 100) }
}

export function parsePoolName(value: FormDataEntryValue | null): { ok: true; name: string } | { ok: false; error: string } {
  const name = String(value ?? "").trim()
  if (name.length < 1) return { ok: false, error: "Enter a pool name." }
  if (name.length > 80) return { ok: false, error: "Pool name must be 80 characters or less." }
  return { ok: true, name }
}

export function parseOwnerEmail(value: FormDataEntryValue | null): { ok: true; email: string } | { ok: false; error: string } {
  const email = String(value ?? "").trim().toLowerCase()
  if (!email) return { ok: false, error: "Enter an owner email." }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid owner email." }
  }
  return { ok: true, email }
}
