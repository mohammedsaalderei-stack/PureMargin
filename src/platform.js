/* Where "/api/metrics" is, when the app is not being served by the API.

   ── The problem this solves ──────────────────────────────────────────────

   On the web the app and the API share an origin, so `fetch("/api/metrics")`
   is unambiguous and every one of the eighty-eight call sites in `src/` is
   written that way.

   Inside the iOS app they do not share an origin. The web assets are served
   from the app bundle — `capacitor://localhost` — and the API is still on
   `https://puremargin.ae`. A relative path then resolves against the bundle,
   looks for an API on the phone, and finds nothing. Every screen fails at
   once, and only on a device.

   ── Why this is one adapter and not eighty-eight edits ───────────────────

   The obvious fix is to rewrite each call site to an absolute URL. It was
   considered and rejected, because two of those call sites look like this:

       const url = isFixed ? "/api/fixedcosts" : "/api/varcosts";
       const res = await fetch(url, { … });

   A find-and-replace over string literals does not see those. The Costs
   screen would have kept working in every browser and on every test, and
   broken on the phone — the most expensive shape of bug there is, found by a
   user rather than by us. The same trap waits for every call site written
   after this one.

   So the rule is at the boundary instead, where it cannot be partially
   applied: **the app speaks relative paths; the platform decides where they
   point.** On the web nothing is installed and nothing changes.

   ── Only `/api` ──────────────────────────────────────────────────────────

   Static assets must keep resolving against the bundle: an icon or a chunk
   should be read from the phone, not fetched over the network on a kitchen's
   connection. So this rewrites API paths and leaves everything else alone. */

/* Matches `/api`, `/api/…` and `/api?…`, and deliberately not `/apiary` or a
   protocol-relative `//host/api`, which is already absolute and belongs to
   somebody else. */
const API_PATH = /^\/api(\/|\?|$)/;

export function resolveApiUrl(input, origin) {
  if (!origin || typeof input !== "string") return input;
  if (!API_PATH.test(input)) return input;
  return origin.replace(/\/+$/, "") + input;
}

/* True inside the native shell. `Capacitor.isNativePlatform()` is the
   supported question — the global exists in the web build too once the
   runtime is bundled, so testing for the global alone would be wrong. */
export function isNativePlatform(scope = globalThis) {
  try {
    return Boolean(scope.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/* The origin the native build talks to, fixed at build time.

   Read from the environment so a TestFlight build can be pointed at a staging
   API without editing source, and defaulted so forgetting to set it produces
   a working app rather than a silent one. */
export const API_ORIGIN =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_ORIGIN)
  || "https://puremargin.ae";

/* Wrap `fetch` so relative API paths reach the API.

   Returns whether it did anything, so the caller can say so in a log rather
   than assume. Idempotent: installing twice would nest the wrappers and
   prepend the origin to an already-absolute URL on the second pass, which is
   the kind of fault that only appears after a hot reload. */
export function installApiOrigin(origin, scope = globalThis) {
  if (!origin) return false;
  if (scope.__pureMarginApiOrigin) return false;
  const original = scope.fetch;
  if (typeof original !== "function") return false;

  /* `.call(scope, …)` rather than `original(…)`: a browser's `fetch` throws
     "Illegal invocation" when it is called detached from its global. */
  scope.fetch = (input, init) => original.call(scope, resolveApiUrl(input, origin), init);
  scope.__pureMarginApiOrigin = origin;
  return true;
}

/* Called once, before anything renders.

   On the web this does nothing at all and the app behaves exactly as it
   always has — which is the point: there is one code path, and the native
   build is the one that adds to it. */
export function initPlatform(scope = globalThis) {
  if (!isNativePlatform(scope)) return { native: false, origin: null };
  const installed = installApiOrigin(API_ORIGIN, scope);
  return { native: true, origin: API_ORIGIN, installed };
}
