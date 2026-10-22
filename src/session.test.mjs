/* Where the token is kept.

   Three things are being asserted, and the third is the one that would
   otherwise be found by a user: that the web keeps the behaviour it already
   had, that the app keeps you signed in across a restart, and that a store
   which throws does not take sign-in down with it. */

import assert from "node:assert/strict";
import {
  readSession, writeSession, clearSession, __resetSession, TOKEN_KEY, USER_KEY,
} from "./session.js";

let failures = 0;
function test(name, fn) {
  try {
    __resetSession();
    fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

/* A storage that behaves. `broken` throws on write the way Safari's private
   mode does — present, shaped correctly, and unusable. */
function storage({ broken = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { if (broken) throw new Error("QuotaExceededError"); map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

const web = (over = {}) => ({
  sessionStorage: storage(), localStorage: storage(), ...over,
});
const native = (over = {}) => ({
  Capacitor: { isNativePlatform: () => true },
  sessionStorage: storage(), localStorage: storage(), ...over,
});

test("on the web the token goes to sessionStorage, as it always has", () => {
  const scope = web();
  writeSession(TOKEN_KEY, "tok", scope);
  assert.equal(scope.sessionStorage.map.get(TOKEN_KEY), "tok");
  assert.equal(scope.localStorage.map.has(TOKEN_KEY), false, "not the durable one");
  assert.equal(readSession(TOKEN_KEY, scope), "tok");
});

test("in the app it goes to localStorage, so a restart does not sign you out", () => {
  /* iOS terminates an app to reclaim memory with no warning and no user
     intent. sessionStorage there means being signed out at random. */
  const scope = native();
  writeSession(TOKEN_KEY, "tok", scope);
  assert.equal(scope.localStorage.map.get(TOKEN_KEY), "tok");
  assert.equal(scope.sessionStorage.map.has(TOKEN_KEY), false);
});

test("a missing value reads as empty string, not null", () => {
  /* `useState(() => readSession(...) || "")` would paper over null anyway,
     but a null reaching a value prop renders the word "null" in an input. */
  assert.equal(readSession(TOKEN_KEY, web()), "");
});

test("a store that throws falls back to memory instead of failing sign-in", () => {
  const scope = web({ sessionStorage: storage({ broken: true }) });
  assert.equal(writeSession(TOKEN_KEY, "tok", scope), false, "reports it did not persist");
  assert.equal(readSession(TOKEN_KEY, scope), "tok", "but the session still works");
});

test("a scope with no storage at all is survivable", () => {
  const scope = { Capacitor: undefined };
  assert.equal(writeSession(TOKEN_KEY, "tok", scope), false);
  assert.equal(readSession(TOKEN_KEY, scope), "tok");
});

test("signing out clears both stores, not just the preferred one", () => {
  /* A developer's browser, or a session that began on the web and continued
     in the app, can have left a token in the other store. Signing out has to
     mean signing out. */
  const scope = native();
  scope.sessionStorage.map.set(TOKEN_KEY, "old-web-token");
  scope.sessionStorage.map.set(USER_KEY, "sam");
  writeSession(TOKEN_KEY, "tok", scope);
  writeSession(USER_KEY, "sam", scope);

  clearSession(scope);

  assert.equal(scope.localStorage.map.has(TOKEN_KEY), false);
  assert.equal(scope.sessionStorage.map.has(TOKEN_KEY), false, "the stale one too");
  assert.equal(scope.sessionStorage.map.has(USER_KEY), false);
  assert.equal(readSession(TOKEN_KEY, scope), "", "and not left in memory");
});

test("signing out when storage throws still clears the memory copy", () => {
  const scope = web({ sessionStorage: storage({ broken: true }) });
  writeSession(TOKEN_KEY, "tok", scope);
  assert.equal(readSession(TOKEN_KEY, scope), "tok");
  clearSession(scope);
  assert.equal(readSession(TOKEN_KEY, scope), "", "a failed sign-out is a signed-in user");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
