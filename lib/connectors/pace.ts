// Pacing shared by every connector: a token bucket that keeps one pull inside
// the provider's rate limit, and the injectable clock tests drive it with.

export type FetchDeps = {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  take?: () => Promise<void>
}

/**
 * Cursor documents 60 requests a minute on its usage endpoint; the other
 * connectors reuse the same conservative pace. The bucket starts with 30 and
 * refills one every two seconds, so the first minute is 60 at most and a
 * sustained pull settles at 30 a minute. A 30-day backfill goes through at
 * full speed.
 */
export function createRateLimiter(
  { capacity = 30, refillMs = 2000 }: { capacity?: number; refillMs?: number } = {},
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = defaultClock,
) {
  let tokens = capacity
  let last = clock.now()
  return async function take(): Promise<void> {
    const now = clock.now()
    const refilled = Math.floor((now - last) / refillMs)
    if (refilled > 0) {
      tokens = Math.min(capacity, tokens + refilled)
      last += refilled * refillMs
    }
    if (tokens === 0) {
      await clock.sleep(last + refillMs - now)
      last += refillMs
      tokens = 1
    }
    tokens--
  }
}

export const defaultClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}
