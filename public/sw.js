/* PureMargin's service worker: the app's own files, kept for offline use.

   Only the shell — the page, its scripts and styles, the icons and fonts.
   The business's data is not handled here: the page keeps that itself
   (`src/offline.js`), per signed-in user, and wipes it on sign-out. Requests
   to /api/ pass straight through.

   The page is always asked for from the network first, so a new version is
   picked up the moment there is a connection; the saved copy is only what is
   shown when there is none. Scripts and styles carry a hash of their contents
   in their names, so a saved one can never be stale. */

const CACHE = "pm-shell-v1";
const STATIC = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

/* Bring what is kept in line with the build that is live: add every file it
   lists, including the screens that load on demand, and drop the scripts of
   builds that are gone. */
async function refresh() {
  const cache = await caches.open(CACHE);
  const wanted = new Set(STATIC);
  try {
    const res = await fetch("/asset-manifest.json", { cache: "no-store" });
    if (res.ok) {
      for (const entry of Object.values(await res.json())) {
        if (entry.file) wanted.add(`/${entry.file}`);
        for (const f of [...(entry.css || []), ...(entry.assets || [])]) wanted.add(`/${f}`);
      }
    }
  } catch { /* no connection: keep what is there */ return; }
  const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
  await Promise.all([...wanted].filter((u) => !have.has(u)).map((u) => cache.add(u).catch(() => {})));
  for (const path of have) {
    if (path.startsWith("/assets/") && !wanted.has(path)) await cache.delete(path);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(refresh().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  /* The business's data: never from here. */
  if (sameOrigin && url.pathname.startsWith("/api/")) return;

  /* The page itself: the network when there is one, the saved copy when not. */
  if (request.mode === "navigate" && sameOrigin) {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          await cache.put("/", res.clone());
          event.waitUntil(refresh());
        }
        return res;
      } catch {
        return (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  /* Hashed scripts and styles, and fonts: the saved copy is the file. */
  if ((sameOrigin && url.pathname.startsWith("/assets/")) || FONT_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const hit = await caches.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok || res.type === "opaque") (await caches.open(CACHE)).put(request, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  /* Icons and the manifest: the saved copy now, a fresh one for next time. */
  if (sameOrigin && STATIC.includes(url.pathname)) {
    event.respondWith((async () => {
      const hit = await caches.match(request);
      const fresh = fetch(request).then(async (res) => {
        if (res.ok) await (await caches.open(CACHE)).put(request, res.clone());
        return res;
      });
      if (hit) { event.waitUntil(fresh.catch(() => {})); return hit; }
      return fresh;
    })());
  }
});
