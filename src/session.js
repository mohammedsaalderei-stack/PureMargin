/* Where the sign-in token is kept, and for how long.

   ── Two different right answers ──────────────────────────────────────────

   On the web the token lives in `sessionStorage`, and that is deliberate even
   though nothing said so before this file existed. These screens are used on
   a tablet propped against a pass, shared by whoever is on shift. Closing the
   browser signing you out is the correct behaviour for a device that is not
   anybody's.

   In the iOS app it is wrong twice over. There is no "closing the browser" —
   iOS terminates the app when it needs the memory, with no warning and no
   user intent involved — so `sessionStorage` means being signed out at
   random. And the device is a phone in somebody's pocket, where the app
   itself is the boundary and every other app on it stays signed in.

   So the platform picks, and both answers keep their reason.

   ── What is not moved ────────────────────────────────────────────────────

   `sufra_admin`, the operator panel's token, stays in `sessionStorage`
   everywhere. It carries a thirty-minute expiry on purpose and the operator
   panel is not what the phone app is for.

   `sufra_seen`, the splash flag, stays too: it is not a credential, and the
   native build has its own launch screen. */

import { isNativePlatform } from "./platform.js";

export const TOKEN_KEY = "sufra_token";
export const USER_KEY = "sufra_user";

/* Private browsing, a locked-down enterprise profile, or a WKWebView with
   site data disabled all make these throw rather than return null — on the
   *first* access, not on construction. A sign-in that throws instead of
   working is worse than one that does not survive a restart, so everything
   below degrades to memory and the app keeps going. */
const memory = new Map();

function backing(scope = globalThis) {
  const name = isNativePlatform(scope) ? "localStorage" : "sessionStorage";
  try {
    const store = scope[name];
    /* Touch it. Safari in private mode hands back a real object whose
       `setItem` throws, so merely finding it present proves nothing. */
    const probe = "__pm_probe";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function readSession(key, scope = globalThis) {
  const store = backing(scope);
  try {
    if (store) return store.getItem(key) || "";
  } catch { /* fall through to memory */ }
  return memory.get(key) || "";
}

export function writeSession(key, value, scope = globalThis) {
  const store = backing(scope);
  memory.set(key, String(value ?? ""));
  try {
    if (store) {
      store.setItem(key, String(value ?? ""));
      return true;
    }
  } catch { /* kept in memory */ }
  return false;
}

export function clearSession(scope = globalThis) {
  const store = backing(scope);
  for (const key of [TOKEN_KEY, USER_KEY]) {
    memory.delete(key);
    try {
      /* Both stores, not the one this platform prefers. A build that has run
         as both — a developer's browser, or a web session migrated into the
         app — can have left a token in the other one, and signing out has to
         mean signing out. */
      store?.removeItem(key);
      scope.localStorage?.removeItem(key);
      scope.sessionStorage?.removeItem(key);
    } catch { /* nothing to clear */ }
  }
}

/* Test seam: the memory fallback is module state, so a test that fills it
   would otherwise leak into the next one. */
export function __resetSession() {
  memory.clear();
}
