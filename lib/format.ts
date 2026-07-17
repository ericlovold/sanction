// The one money/count formatter for operator-facing numbers. Before this,
// nine dashboard files hand-rolled toFixed with five different rounding
// rules ($61.9000 on Overview, $61.90 on Spend, $0.0000 on zero rows,
// "24091000 tokens" unseparated on Audit).
//
// Locale is pinned to en-US: server components render these strings during
// SSR, and a viewer-locale format would hydration-mismatch on the client.

// Dollars: two decimals with thousands separators ($1,053.00). Sub-cent
// amounts keep four decimals so a tiny-but-real token cost never renders as
// $0.00 — a true zero stays $0.00.
export function fmtUsd(n: number): string {
  const abs = Math.abs(n)
  const decimals = abs > 0 && abs < 0.01 ? 4 : 2
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

// Counts (tokens, calls, rows): thousands separators, no decimals.
export function fmtCount(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}
