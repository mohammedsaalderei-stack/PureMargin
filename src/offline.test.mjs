/* Reads kept for offline use (`offline.js`).

   What this protects: the network is always asked first and its answer —
   including a refusal — is what the screen gets; a saved answer appears only
   when the network cannot be reached or is too slow; nothing is kept for
   sign-in, the assistant or the register; one user never sees another's;
   and signing out wipes it. */
import assert from "node:assert/strict";
import { cacheKeyFor, offlineFetch, memoryStore, offlineState, storeFor } from "./offline.js";

let failures = 0;
const test = async (name, fn) => { try { await fn(); console.log("  ok  ", name); } catch (err) { failures += 1; console.error("  FAIL", name, "\n       ", err.message); } };

class Res {
  constructor(body, { status = 200, headers = {} } = {}) { this.body = body; this.status = status; this.ok = status >= 200 && status < 300; this.h = headers; this.headers = { get: (k) => this.h[k] ?? null }; }
  clone() { return new Res(this.body, { status: this.status, headers: this.h }); }
  async text() { return this.body; }
  async json() { return JSON.parse(this.body); }
}
const tick = () => new Promise((r) => setTimeout(r, 5));
function rig({ user = "owner", slowMs = 20 } = {}) {
  const store = memoryStore();
  const net = { mode: "ok", body: '{"v":1}', status: 200, calls: 0, delay: 0 };
  const fetch = async () => {
    net.calls += 1;
    if (net.delay) await new Promise((r) => setTimeout(r, net.delay));
    if (net.mode === "down") throw new TypeError("Failed to fetch");
    return new Res(net.body, { status: net.status, headers: { "Content-Type": "application/json" } });
  };
  const who = { user };
  const f = offlineFetch({ fetch, store, userOf: () => who.user, slowMs, ResponseCtor: Res });
  return { f, net, store, who };
}

await test("only reads of the business's own data are kept", async () => {
  assert.equal(cacheKeyFor("/api/metrics?branches=a", undefined, "owner"), "owner|/api/metrics?branches=a");
  assert.equal(cacheKeyFor("/api/metrics?fresh=1&branches=a", {}, "owner"), "owner|/api/metrics?branches=a", "asking for a fresh read is the same question");
  for (const url of ["/api/login", "/api/register", "/api/reset", "/api/admin", "/api/chat", "/api/ai", "/api/till?what=catalogue", "/api/itemimage?o=1", "/assets/index.js", "https://elsewhere.example/api/metrics"]) {
    assert.equal(cacheKeyFor(url, undefined, "owner"), null, url);
  }
  assert.equal(cacheKeyFor("/api/costs", { method: "POST" }, "owner"), null, "a change is never kept");
  assert.equal(cacheKeyFor("/api/metrics", undefined, ""), null, "nobody signed in, nothing kept");
});

await test("the network's answer is what the screen gets, and it is kept", async () => {
  const { f, net, store } = rig();
  const res = await f("/api/metrics");
  assert.deepEqual(await res.json(), { v: 1 });
  await tick();
  assert.equal(await store.size(), 1);
  net.body = '{"v":2}';
  assert.deepEqual(await (await f("/api/metrics")).json(), { v: 2 }, "fresh, not the saved copy");
  assert.equal(offlineState().offline, false);
});

await test("with no connection, the saved answer is shown and marked as saved", async () => {
  const { f, net } = rig();
  await f("/api/metrics");
  await tick();
  net.mode = "down";
  const res = await f("/api/metrics?fresh=1");
  assert.deepEqual(await res.json(), { v: 1 });
  assert.ok(Number(res.headers.get("X-PM-Offline")) > 0);
  assert.equal(offlineState().offline, true);
  assert.ok(offlineState().savedAt > 0);
  /* And back when the network is. */
  net.mode = "ok";
  await f("/api/metrics");
  assert.equal(offlineState().offline, false);
});

await test("nothing saved and no connection fails as it always did", async () => {
  const { f, net } = rig();
  net.mode = "down";
  await assert.rejects(() => f("/api/metrics"), TypeError);
});

await test("a refusal is passed on, never papered over with old figures", async () => {
  const { f, net } = rig();
  await f("/api/metrics");
  await tick();
  net.status = 401;
  net.body = '{"error":"expired"}';
  assert.equal((await f("/api/metrics")).status, 401);
  net.status = 503;
  assert.equal((await f("/api/metrics")).status, 503);
  await tick();
  net.mode = "down";
  assert.deepEqual(await (await f("/api/metrics")).json(), { v: 1 }, "and the refusal did not overwrite what was saved");
});

await test("a network too slow to wait for shows what is saved, then catches up", async () => {
  const { f, net, store } = rig({ slowMs: 15 });
  await f("/api/metrics");
  await tick();
  net.delay = 60;
  net.body = '{"v":3}';
  const res = await f("/api/metrics");
  assert.deepEqual(await res.json(), { v: 1 }, "the saved copy, rather than a spinner");
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(JSON.parse((await store.get("owner|/api/metrics")).body).v, 3, "the slow answer still landed");
});

await test("one person's saved figures are never another's", async () => {
  const { f, net, who } = rig();
  await f("/api/metrics");
  await tick();
  who.user = "cashier";
  net.mode = "down";
  await assert.rejects(() => f("/api/metrics"), TypeError);
});

await test("changes are not queued: with no connection they fail, and say so", async () => {
  const { f, net, store } = rig();
  net.mode = "down";
  await assert.rejects(() => f("/api/costs", { method: "POST", body: "{}" }), TypeError);
  assert.equal(await store.size(), 0);
});

await test("a browser tab keeps it in memory only; an installed app keeps it on the device", async () => {
  let opened = 0;
  const idb = { open() { opened += 1; const req = {}; setTimeout(() => req.onerror?.(), 0); return req; } };
  const tab = storeFor({ indexedDB: idb, matchMedia: () => ({ matches: false }), navigator: {} });
  await tab.set("k", { body: "x", at: 1 });
  assert.equal(opened, 0, "a tab never touches the device's store");
  assert.equal((await tab.get("k")).body, "x");
  const installed = storeFor({ indexedDB: idb, matchMedia: () => ({ matches: true }), navigator: {} });
  await installed.set("k", { body: "y", at: 2 });
  assert.ok(opened > 0);
  assert.equal((await installed.get("k")).body, "y", "a device store that fails falls back rather than breaking the read");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
