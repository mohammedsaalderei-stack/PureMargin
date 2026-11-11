/* What the app has read, kept on the device, for when there is no connection.

   A restaurant's Wi-Fi is the least reliable thing in it, and a phone in a
   walk-in fridge has no signal at all. The register already sells without a
   connection (`register/api.js`). This is the other half: every screen in the
   back office reads its figures from `/api/…`, and each answer is kept as it
   arrives, so with no connection the screen opens on what it last showed —
   yesterday's sales, the stock list, the recipes — instead of an error.

   ── How it decides ───────────────────────────────────────────────────────

   The network is always asked first. A saved answer is used only when the
   network cannot be reached, or has not answered after a few seconds and
   there is something saved to show in the meantime. Nothing is ever served
   from here while a fresher answer is available, and whatever the network
   says — including "no" — is what the screen gets.

   Only reads. A change made with no connection is not queued here: saving a
   cost or receiving a delivery into a queue that might be replayed hours
   later, against figures that have since moved, is how a ledger ends up with
   entries nobody can explain. Those say they need a connection. Selling is
   the one thing that cannot wait, and the register queues it itself.

   ── Where it is kept ─────────────────────────────────────────────────────

   On the device only when the app has been installed — the iPhone app, or
   the website added to a home screen. In an ordinary browser tab it is held
   in memory and gone when the tab closes, for the reason `session.js` gives
   for the sign-in: these screens run on tablets shared by a whole shift, and
   a browser that is closed should leave nothing of the business behind.

   Kept per signed-in user, and wiped on sign-out. */

import { readSession, USER_KEY } from "./session.js";
import { isInstalledApp } from "./platform.js";

const DB_NAME = "puremargin-offline";
const STORE = "responses";
/* How long to wait for the network before showing what is saved. */
export const SLOW_MS = 6000;
const MAX_BODY = 1.5 * 1024 * 1024;
const MAX_ENTRIES = 300;

/* Which requests are kept: reads of the business's own data. Not sign-in or
   sign-up, not the operator panel, not the assistant (an answer is not a
   record), not pictures (the browser caches those), and not the register,
   which keeps its own copy of what it needs and has to know for itself
   whether it is offline. */
const API = /^\/api\/([a-z0-9_-]+)/;
const SKIP = new Set(["login", "register", "reset", "admin", "chat", "ai", "itemimage", "till", "billing", "feedback", "password"]);

export function cacheKeyFor(input, init, user) {
  if (!user || typeof input !== "string") return null;
  if (init?.method && String(init.method).toUpperCase() !== "GET") return null;
  const route = API.exec(input)?.[1];
  if (!route || SKIP.has(route)) return null;
  /* `fresh=1` asks the server to skip its own cache; it is the same question. */
  const [path, query = ""] = input.split("?");
  const params = new URLSearchParams(query);
  params.delete("fresh");
  params.sort();
  const qs = params.toString();
  return `${user}|${path}${qs ? `?${qs}` : ""}`;
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

export function memoryStore() {
  const map = new Map();
  return {
    get: async (key) => map.get(key) || null,
    set: async (key, value) => { map.set(key, value); },
    clear: async () => { map.clear(); },
    size: async () => map.size,
  };
}

function idbStore(scope) {
  let opening = null;
  const open = () => {
    opening = opening || new Promise((resolve, reject) => {
      const req = scope.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return opening;
  };
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out?.result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: (key) => run("readonly", (s) => s.get(key)).then((row) => row?.value || null),
    set: async (key, value) => {
      await run("readwrite", (s) => s.put({ key, value, at: value.at }));
      /* Now and then, drop the oldest so this cannot grow without limit. */
      if (Math.random() < 0.05) {
        const rows = (await run("readonly", (s) => s.getAll())) || [];
        if (rows.length > MAX_ENTRIES) {
          const old = rows.sort((a, b) => a.at - b.at).slice(0, rows.length - MAX_ENTRIES);
          await run("readwrite", (s) => { old.forEach((r) => s.delete(r.key)); return null; });
        }
      }
    },
    clear: () => run("readwrite", (s) => s.clear()),
    size: () => run("readonly", (s) => s.count()),
  };
}

/* The device's store when the app is installed and the browser has one;
   otherwise memory. A store that fails is treated as empty rather than
   allowed to break a request. */
export function storeFor(scope = globalThis) {
  const fallback = memoryStore();
  if (!isInstalledApp(scope) || !scope.indexedDB) return fallback;
  const disk = idbStore(scope);
  const safe = (fn, otherwise) => async (...args) => {
    try { return await fn(...args); } catch { return otherwise ? otherwise(...args) : null; }
  };
  return {
    get: safe(disk.get, fallback.get),
    set: safe(disk.set, fallback.set),
    clear: safe(async () => { await fallback.clear(); return disk.clear(); }),
    size: safe(disk.size, fallback.size),
  };
}

/* ── Whether the app is working from what it saved ───────────────────────── */

let state = { offline: false, savedAt: null };
const listeners = new Set();
function setState(next) {
  if (next.offline === state.offline && next.savedAt === state.savedAt) return;
  state = next;
  listeners.forEach((fn) => { try { fn(state); } catch { /* a listener's problem */ } });
}
export const offlineState = () => state;
export function subscribeOffline(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ── The fetch that remembers ────────────────────────────────────────────── */

export function offlineFetch({ fetch, store, userOf, now = () => Date.now(), slowMs = SLOW_MS, wait = (ms) => new Promise((r) => setTimeout(() => r(null), ms)), ResponseCtor = globalThis.Response }) {
  const fromSaved = (saved) => new ResponseCtor(saved.body, {
    status: 200,
    headers: { "Content-Type": saved.type || "application/json", "X-PM-Offline": String(saved.at) },
  });

  return async function remembering(input, init) {
    const key = cacheKeyFor(input, init, userOf());
    if (!key) {
      /* Not something this keeps — but its answer still says the network is
         there, and its failure says nothing a read has not said already. */
      const res = await fetch(input, init);
      setState({ offline: false, savedAt: null });
      return res;
    }

    const saved = await store.get(key);
    const network = (async () => {
      const res = await fetch(input, init);
      setState({ offline: false, savedAt: null });
      if (res.ok) {
        /* Kept from a copy, after the caller has its answer on the way. */
        res.clone().text().then((body) => {
          if (body.length <= MAX_BODY) return store.set(key, { body, type: res.headers.get("Content-Type") || "application/json", at: now() });
          return null;
        }).catch(() => {});
      }
      return res;
    })();

    /* Nothing saved: exactly what happened before this existed. */
    if (!saved) return network;

    let res = null;
    try {
      res = await Promise.race([network, wait(slowMs)]);
    } catch {
      res = null;
    }
    if (res) return res;
    /* Unreachable, or too slow to wait for. The request may still land, and
       updates what is saved if it does. */
    network.catch(() => {});
    setState({ offline: true, savedAt: state.offline && state.savedAt ? Math.min(state.savedAt, saved.at) : saved.at });
    return fromSaved(saved);
  };
}

let installedStore = null;

/* Wrap `fetch`, once. After `initPlatform`, so the address of the API is
   added underneath this and keys stay the short relative paths. */
export function installOfflineCache(scope = globalThis) {
  if (scope.__pureMarginOffline || typeof scope.fetch !== "function") return false;
  installedStore = storeFor(scope);
  const inner = scope.fetch;
  scope.fetch = offlineFetch({
    fetch: (input, init) => inner.call(scope, input, init),
    store: installedStore,
    userOf: () => readSession(USER_KEY, scope),
  });
  scope.__pureMarginOffline = true;
  /* The device saying so is believed at once; a read confirms it either way. */
  scope.addEventListener?.("offline", () => setState({ offline: true, savedAt: state.savedAt }));
  scope.addEventListener?.("online", () => setState({ offline: false, savedAt: null }));
  return true;
}

/* Signing out leaves nothing of the business on the device. */
export async function clearOfflineCache() {
  setState({ offline: false, savedAt: null });
  try { await installedStore?.clear(); } catch { /* nothing to clear */ }
}
