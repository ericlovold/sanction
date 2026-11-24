// Both sources report event counts, but personal exports contain billing items
// while team syncs contain requests. Keep that distinction at presentation.
export const CURSOR_DAILY_TOKENS = BigInt(100_000_000)
export const CURSOR_DAILY_EVENTS = BigInt(5_000)

export function highCursorVolume(tokens: bigint | null, events: bigint): boolean {
  return (tokens !== null && tokens >= CURSOR_DAILY_TOKENS) || events >= CURSOR_DAILY_EVENTS
}

export type CursorVolumeEvidence = {
  reportedTokens: string
  cachedTokens: string
  requests: string
  requestsWithTokens: string
  tokenThreshold: string
  requestThreshold: string
}

export function describeCursorVolume(v: CursorVolumeEvidence): string {
  const count = (n: string) => BigInt(n).toLocaleString("en-US")
  const tokens = v.requestsWithTokens === "0" ? "Token counts unavailable"
    : `${count(v.reportedTokens)} reported tokens (${count(v.cachedTokens)} cache reads)`
  return `${tokens}, ${count(v.requests)} requests. ${count(v.requestsWithTokens)} requests reported tokens. Daily alert at ${count(v.tokenThreshold)} tokens or ${count(v.requestThreshold)} requests.`
}
