/* The API origin adapter.

   This is the single thing standing between the iOS build and every screen
   failing at once, and its failure mode is invisible on the web: the whole
   point of the adapter is that nothing happens in a browser. So the tests are
   about what it does when it is switched on, and — just as much — about what
   it refuses to touch.

   An over-eager rewrite is as bad as a missing one. Sending `/assets/x.js` to
   the network turns a file already on the phone into a request over a
   kitchen's connection; sending a `data:` or `blob:` URL anywhere would break
   the photographs outright. */

import assert from "node:assert/strict";
import { resolveApiUrl, installApiOrigin, isNativePlatform, API_ORIGIN } from "./platform.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const ORIGIN = "https://puremargin.ae";

test("a relative API path gets the origin", () => {
  assert.equal(resolveApiUrl("/api/metrics", ORIGIN), "https://puremargin.ae/api/metrics");
  assert.equal(resolveApiUrl("/api", ORIGIN), "https://puremargin.ae/api");
});

test("a query string survives intact", () => {
  assert.equal(
    resolveApiUrl("/api/stock?what=invoice&branch=b1", ORIGIN),
    "https://puremargin.ae/api/stock?what=invoice&branch=b1",
  );
});

test("with no origin, nothing is touched — which is the web build", () => {
  assert.equal(resolveApiUrl("/api/metrics", ""), "/api/metrics");
  assert.equal(resolveApiUrl("/api/metrics", null), "/api/metrics");
  assert.equal(resolveApiUrl("/api/metrics", undefined), "/api/metrics");
});

test("a trailing slash on the origin does not double up", () => {
  assert.equal(resolveApiUrl("/api/metrics", "https://puremargin.ae/"), "https://puremargin.ae/api/metrics");
  assert.equal(resolveApiUrl("/api/metrics", "https://puremargin.ae///"), "https://puremargin.ae/api/metrics");
});

test("static assets are left in the bundle", () => {
  /* Already on the phone. Rewriting these would fetch a file over the network
     that is sitting in local storage, on exactly the connections this app is
     used on. */
  for (const path of ["/assets/index-abc123.js", "/favicon.ico", "/icons/192.png", "/"]) {
    assert.equal(resolveApiUrl(path, ORIGIN), path, path);
  }
});

test("an already-absolute URL is never prefixed", () => {
  for (const url of [
    "https://api.loyverse.com/v1.0/receipts",
    "http://localhost:3001/api/metrics",
    "capacitor://localhost/api/metrics",
    "data:image/jpeg;base64,AAAA",
    "blob:https://puremargin.ae/0d5f",
  ]) assert.equal(resolveApiUrl(url, ORIGIN), url, url);
});

test("a protocol-relative URL is somebody else's host, not our API", () => {
  /* `//evil.example/api/metrics` begins with a slash and is absolute. Treating
     it as a path would produce `https://puremargin.ae//evil.example/api/…`,
     and treating it as ours would send a token off-site. Untouched. */
  assert.equal(resolveApiUrl("//evil.example/api/metrics", ORIGIN), "//evil.example/api/metrics");
});

test("a path that merely starts with the letters api is not an API path", () => {
  for (const path of ["/apiary/x", "/api-docs", "/apifoo"]) {
    assert.equal(resolveApiUrl(path, ORIGIN), path, path);
  }
});

test("a non-string request is passed through untouched", () => {
  /* `fetch` also accepts a URL or a Request. Neither is used here, and
     stringifying one to test a prefix would corrupt it. */
  const url = new URL("https://puremargin.ae/api/metrics");
  assert.equal(resolveApiUrl(url, ORIGIN), url);
  assert.equal(resolveApiUrl(undefined, ORIGIN), undefined);
});

/* ── installing it ─────────────────────────────────────────────────────── */

function fakeScope() {
  const calls = [];
  return {
    calls,
    fetch(input, init) { calls.push({ input, init, self: this }); return "response"; },
  };
}

test("the wrapper rewrites on the way through and keeps the options", () => {
  const scope = fakeScope();
  assert.equal(installApiOrigin(ORIGIN, scope), true);

  const init = { method: "POST", headers: { Authorization: "Bearer x" } };
  assert.equal(scope.fetch("/api/login", init), "response");
  assert.equal(scope.calls[0].input, "https://puremargin.ae/api/login");
  assert.equal(scope.calls[0].init, init, "the same object, not a copy");
});

test("fetch is called against its own global", () => {
  /* Detached, a browser's fetch throws "Illegal invocation". The fake records
     its `this` so the binding is actually asserted rather than assumed. */
  const scope = fakeScope();
  installApiOrigin(ORIGIN, scope);
  scope.fetch("/api/metrics");
  assert.equal(scope.calls[0].self, scope);
});

test("installing twice does not wrap twice", () => {
  /* Two wrappers would prefix an already-prefixed URL on the second pass —
     https://puremargin.ae/https://puremargin.ae/api/… — which appears after a
     hot reload and not before. */
  const scope = fakeScope();
  assert.equal(installApiOrigin(ORIGIN, scope), true);
  assert.equal(installApiOrigin(ORIGIN, scope), false, "second install refused");

  scope.fetch("/api/metrics");
  assert.equal(scope.calls[0].input, "https://puremargin.ae/api/metrics");
});

test("with no origin nothing is installed", () => {
  const scope = fakeScope();
  const before = scope.fetch;
  assert.equal(installApiOrigin("", scope), false);
  assert.equal(scope.fetch, before, "left exactly as it was");
});

test("a scope with no fetch is left alone rather than crashing", () => {
  const scope = {};
  assert.equal(installApiOrigin(ORIGIN, scope), false);
  assert.equal(scope.fetch, undefined);
});

test("native is decided by Capacitor's own answer, not by the global existing", () => {
  /* The runtime global is present in the web build too once it is bundled, so
     `window.Capacitor &&` would send every browser down the native path. */
  assert.equal(isNativePlatform({}), false, "no Capacitor at all");
  assert.equal(isNativePlatform({ Capacitor: {} }), false, "global present, not native");
  assert.equal(
    isNativePlatform({ Capacitor: { isNativePlatform: () => false } }), false,
    "the web build of the runtime",
  );
  assert.equal(
    isNativePlatform({ Capacitor: { isNativePlatform: () => true } }), true,
    "the app",
  );
});

test("a Capacitor that throws is not native, and does not take the app with it", () => {
  const scope = { get Capacitor() { throw new Error("nope"); } };
  assert.equal(isNativePlatform(scope), false);
});

/* Every test above passes its own origin, so none of them would notice the
   default being wrong, and it was: the bare domain, which redirects to www.
   iOS drops the Authorization header on a redirect to another host, so the
   app could sign in and then saw nothing. This pins the default to the host
   that serves the site; a 308 from it should never be the first answer. */
test("the app's default API origin is the host the site is served from", () => {
  assert.equal(API_ORIGIN, "https://www.puremargin.ae");
});

test("the default origin is a bare origin the rewrite can use as is", () => {
  const url = new URL(API_ORIGIN);
  assert.equal(url.protocol, "https:", "plain http would be refused by App Transport Security");
  assert.equal(url.pathname, "/");
  assert.equal(resolveApiUrl("/api/scope", API_ORIGIN), "https://www.puremargin.ae/api/scope");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
