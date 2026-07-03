// Sanction dashboard service worker — makes the installed PWA feel installed.
//
// Strategy, by request type (GET only; actions/POST never touch the SW):
//   /_next/static/*, /icons/*, fonts  → cache-first (immutable, hashed)
//   dashboard navigations             → network-first with cache fallback,
//                                       so a cold/offline launch still paints
//                                       the last-known page instead of a
//                                       browser error. Approvals stays
//                                       network-first too: decisions must
//                                       never render from stale cache first.
// Bump VERSION to invalidate everything on deploy.
const VERSION = "v1"
const STATIC_CACHE = `sanction-static-${VERSION}`
const PAGE_CACHE = `sanction-pages-${VERSION}`

self.addEventListener("install", (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(PAGE_CACHE).then((c) => c.addAll(["/dashboard/approvals"]).catch(() => {})))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))).then(() => self.clients.claim()),
    ),
  )
})

function isStaticAsset(url) {
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

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      }),
    )
    return
  }

  // Dashboard page navigations: network-first, cached copy as the offline/
  // slow-network fallback. Never cache non-dashboard routes (marketing pages
  // change per deploy and auth routes must stay live).
  if (req.mode === "navigate" && url.pathname.startsWith("/dashboard")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(PAGE_CACHE).then((c) => c.put(req, res.clone())).catch(() => {})
          return res
        })
        .catch(async () => {
          const cached = await caches.match(req)
          return cached ?? caches.match("/dashboard/approvals")
        }),
    )
  }
})
