// Sanction dashboard service worker.
//
// Scope, deliberately narrow: cache-first ONLY for immutable, content-hashed
// build assets (JS/CSS chunks, icons, fonts). Their URLs change every build,
// so a cached copy is never stale and a new build always fetches fresh hashes.
//
// Everything else — HTML navigations, RSC payloads, API calls — is left to the
// browser (network). We do NOT cache authenticated dashboard HTML.
//
// Why (incident, 2026-07-09): the previous version network-first-cached
// dashboard HTML and, on a slow/flaky network, served a STALE page from an
// earlier deploy. That HTML referenced old hashed JS chunks the new deploy no
// longer serves → the chunks 404 → React never hydrates → every link and button
// on the page is dead. It read as "the dashboard is frozen," most visibly on
// mobile (flaky radio triggers the cache fallback far more than desktop wifi).
// Caching an app that is authenticated + always-dynamic buys ~nothing offline
// and risks exactly this. So: assets only, navigations always hit the network.
//
// Bump VERSION on any change here to purge every prior cache on activate.
const VERSION = "v2"
const STATIC_CACHE = `sanction-static-${VERSION}`

self.addEventListener("install", () => {
  // Take over immediately so a fix like this reaches users on the next load,
  // not after every tab is closed.
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  // Delete every cache that isn't this version — including the old page cache
  // that held the stale, dead-chunk HTML.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/icon.svg" ||
    url.pathname.endsWith(".woff2")
  )
}

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Only immutable, hashed assets are cached. Navigations, RSC, and API
  // requests are intentionally NOT intercepted — the browser fetches them fresh,
  // so the page and its chunk references always match the live deploy.
  if (!isImmutableAsset(url)) return

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) cache.put(req, res.clone())
      return res
    }),
  )
})
