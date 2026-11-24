// Money for provider usage data: integer nano-dollars (1e-9 USD) in a bigint,
// end to end. No float arithmetic anywhere in this file.
//
// Why nanos and not micros: providers report finer than a micro-dollar.
// Cursor's `chargedCents` is a fractional-cent number (21.36232 cents is
// 213,623.2 micro-dollars) and Anthropic's cost API returns cents to six
// decimals (1e-8 USD). Micro-dollars would round every row, and a sum of
// rounded rows stops reconciling to the provider's own total. Nanos hold both
// exactly, and a signed 64-bit column still reaches about $9.2 billion.
//
// Provider JSON numbers arrive as doubles. They are never multiplied: the
// number is rendered back to its shortest decimal string (which round-trips
// the value the provider wrote, for anything up to 15 significant digits) and
// that string is parsed digit by digit.

export type MoneyUnit = "usd" | "cents"

// Decimal places between one unit and one nano-dollar.
const NANO_EXPONENT: Record<MoneyUnit, number> = { usd: 9, cents: 7 }

const DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/

// Largest amount accepted: far above any real bill, far below int64 overflow.
const MAX_NANOS = BigInt("1000000000000000000") // $1 billion

/**
 * Convert a provider money value to nano-dollars. Accepts a decimal string or
 * a finite JSON number. Digits finer than a nano-dollar are rounded half away
 * from zero. Throws on anything that is not a plain decimal: a malformed
 * amount must fail the pull, never be stored as zero.
 */
export function toNanos(value: string | number, unit: MoneyUnit): bigint {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Money value is not finite")
  const text = typeof value === "number" ? String(value) : value.trim()
  const match = DECIMAL.exec(text)
  if (!match) throw new Error("Money value is not a decimal number")
  const [, sign, whole, fraction = "", exponent = "0"] = match
  if (exponent.length > 4) throw new Error("Money value exponent out of range")

  const digits = BigInt(whole + fraction)
  // value = digits x 10^shift nano-dollars
  const shift = Number(exponent) - fraction.length + NANO_EXPONENT[unit]
  let nanos: bigint
  if (shift >= 0) {
    if (shift > 40) throw new Error("Money value out of range")
    nanos = digits * BigInt(10) ** BigInt(shift)
  } else {
    if (-shift > whole.length + fraction.length) return BigInt(0)
    const divisor = BigInt(10) ** BigInt(-shift)
    const quotient = digits / divisor
    const remainder = digits % divisor
    nanos = remainder * BigInt(2) >= divisor ? quotient + BigInt(1) : quotient
  }
  if (nanos > MAX_NANOS) throw new Error("Money value out of range")
  return sign === "-" ? -nanos : nanos
}

/** Exact decimal rendering of nano-dollars in a unit, trailing zeros trimmed. */
export function nanosToDecimal(nanos: bigint, unit: MoneyUnit): string {
  const places = NANO_EXPONENT[unit]
  const negative = nanos < BigInt(0)
  const digits = (negative ? -nanos : nanos).toString().padStart(places + 1, "0")
  const whole = digits.slice(0, -places)
  const fraction = digits.slice(-places).replace(/0+$/, "")
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`
}

/**
 * Dollars as a JS number, for DISPLAY and charts only (bar heights, fmtUsd).
 * Never feed the result back into arithmetic that is stored or compared.
 */
export function nanosToUsd(nanos: bigint): number {
  return Number(nanos) / 1e9
}

/** Whole dollars to nanos, for thresholds written in code as dollars. */
export function usd(dollars: number): bigint {
  if (!Number.isInteger(dollars)) throw new Error("usd() takes whole dollars; use toNanos for decimals")
  return BigInt(dollars) * BigInt(1_000_000_000)
}

export function sumNanos(values: Iterable<bigint>): bigint {
  let total = BigInt(0)
  for (const v of values) total += v
  return total
}
