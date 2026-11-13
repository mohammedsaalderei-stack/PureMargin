/* Loyverse, connected beside the register.

   What this protects:
     · a Loyverse receipt reads as a register receipt does, money included —
       added VAT is not turnover, included VAT is taken out, the till's item
       cost is used only when nothing here knows better;
     · the pages are all read, a plan that keeps 31 days is read as one, a
       read that stops short says so;
     · Loyverse is asked as little as it can be: kept for 45 seconds, then
       only what changed, a failure not repeated on every screen;
     · a failure shows what was last read and says so; a refused token
       shows nothing;
     · each Loyverse store is one of the business's own, so its sales land
       in a branch somebody can select — and a business that sold through
       Loyverse before it was taken out comes back as it was;
     · only the owner connects; a member reads through the owner's
       connection; the server's own key belongs to one business only;
     · a token is tried before it is kept and is never sent back. */

import assert from "node:assert/strict";
import { backend, __resetMemory, getJSON, setJSON } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const lv = await import("./_loyverse.js");
const { posSalesFor, __forgetSyncNotes } = await import("./_possales.js");
const { createAccount, getAccount, setPosToken, posTokenForOrg, posOwnership } = await import("./_accounts.js");
const { orgFor, setMember, unlockedBranches, getOrg } = await import("./_org.js");
const { listStores, adoptStores, saveStore } = await import("./_stores.js");
const { registerContext, salesReceipts, recordSale } = await import("./_till.js");
const { getMetrics } = await import("./_data.js");
const { readSyncs } = await import("./_sync.js");
const { readAudit } = await import("./_audit.js");
const { issueToken } = await import("./_auth.js");
const accountRoute = (await import("./account.js")).default;

const DAY = 864e5;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  lv.clearLoyverseCache();
  __forgetSyncNotes();
  delete process.env.POS_ACCESS_TOKEN;
  delete process.env.LOYVERSE_ACCESS_TOKEN;
  delete process.env.ADMIN_EMAIL;
  try { await fn(); console.log("  ok  ", name); }
  catch (err) { failures += 1; console.error("  FAIL", name, "\n       ", err.message); }
}
const near = (a, b, tol = 0.005) => assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

/* ── A stand-in Loyverse ─────────────────────────────────────────────────── */

function sale(n, { at = NOW - DAY, store = "L1", total = 105, added = 5, included = 0, name = "Shawarma", qty = 2, costTotal = 0, type = "SALE", updated } = {}) {
  const lineTotal = total;
  return {
    id: `uuid-${n}`, receipt_number: `1-${n}`, receipt_type: type, receipt_date: iso(at), created_at: iso(at), updated_at: iso(updated ?? at),
    store_id: store, total_money: total, total_tax: added + included, total_discount: 0,
    payments: [{ name: "Cash", type: "CASH", money_amount: total }],
    line_items: [{
      item_id: "item-1", variant_id: "var-1", item_name: name, quantity: qty, price: (lineTotal - added) / qty,
      total_money: lineTotal, total_discount: 0,
      line_taxes: [
        ...(added ? [{ type: "ADDED", rate: 5, money_amount: added }] : []),
        ...(included ? [{ type: "INCLUDED", rate: 5, money_amount: included }] : []),
      ],
      cost: costTotal / qty, cost_total: costTotal,
    }],
  };
}

function fakeLoyverse({ receipts = [], stores = [{ id: "L1", name: "Marina" }], token = "good-token", pageSize = 2, limited = false, fail = null } = {}) {
  const calls = [];
  const state = { receipts, stores, fail, token, limited };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    const reply = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (state.fail === "network") throw new TypeError("fetch failed");
    if (state.fail) return reply(state.fail, { errors: [{ code: "ERR", details: `status ${state.fail}` }] });
    if (init.headers?.Authorization !== `Bearer ${state.token}`) return reply(401, { errors: [{ code: "UNAUTHORIZED", details: "bad token" }] });
    if (u.pathname.endsWith("/stores")) return reply(200, { stores: state.stores });
    if (!u.pathname.endsWith("/receipts")) return reply(404, {});
    const createdMin = u.searchParams.get("created_at_min");
    const updatedMin = u.searchParams.get("updated_at_min");
    if (state.limited && createdMin && Date.parse(createdMin) < NOW - 31 * DAY) {
      return reply(402, { errors: [{ code: "PAYMENT_REQUIRED", details: "Unlimited Sales History needed" }] });
    }
    let rows = state.receipts
      .filter((r) => !createdMin || Date.parse(r.created_at) >= Date.parse(createdMin))
      .filter((r) => !updatedMin || Date.parse(r.updated_at) >= Date.parse(updatedMin))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const from = Number(u.searchParams.get("cursor") || 0);
    const page = rows.slice(from, from + pageSize);
    const next = from + pageSize < rows.length ? String(from + pageSize) : undefined;
    return reply(200, { receipts: page, ...(next ? { cursor: next } : {}) });
  };
  return { fetchImpl, calls, state };
}

/* The integration half reads through the global fetch, as the server does. */
const realFetch = globalThis.fetch;
function useLoyverse(fake) { globalThis.fetch = fake.fetchImpl; return fake; }

async function business(username = "owner1", { email = "", createdAt } = {}) {
  await createAccount({ username, password: "Loyverse-test-9x!", email });
  if (createdAt) await setJSON(`acct:${username}`, { ...(await getAccount(username)), createdAt });
  const account = await getAccount(username);
  const org = await orgFor(account);
  return { account: await getAccount(username), org };
}

/* ── One receipt ─────────────────────────────────────────────────────────── */

await test("added VAT comes off the line; the receipt keeps what was paid", async () => {
  const r = lv.toReceipt(sale(1, { total: 105, added: 5 }));
  assert.equal(r.id, "1-1");
  assert.equal(r.receipt_number, "1-1");
  assert.equal(r.source, "loyverse");
  assert.equal(r.line_items[0].total_money, 100, "the line is what the dish earned");
  assert.equal(r.total_money, 105, "the receipt is what the customer paid");
  assert.equal(r.total_tax, 5);
  assert.equal(r.vat_mode, "added");
  assert.equal(r.vat_pct, 0);
});

await test("included VAT is stated as the rate it works out to", async () => {
  const r = lv.toReceipt(sale(2, { total: 105, added: 0, included: 5 }));
  assert.equal(r.line_items[0].total_money, 105);
  assert.equal(r.vat_mode, "inclusive");
  near(r.vat_pct, 5);
  /* Through the aggregation every screen uses: 100 without VAT either way. */
  const m = await getMetrics({ register: [r, lv.toReceipt(sale(3, { total: 105, added: 5 }))], now: NOW });
  near(m.totals.salesExVat, 200);
  near(m.totals.sales, 210);
});

await test("the till's item cost is used only when nothing here knows the dish", async () => {
  const r = lv.toReceipt(sale(4, { total: 100, added: 0, costTotal: 30, name: "Falafel" }));
  assert.equal(r.line_items[0].pos_cost, 30);
  assert.equal(r.line_items[0].cost, undefined, "not the register's product cost, which outranks a recipe");
  const bare = await getMetrics({ register: [r], now: NOW });
  near(bare.totals.cost, 30);
  const recipe = new Map([["Falafel", { cost: 12 }]]);
  const costed = await getMetrics({ register: [r], costs: recipe, now: NOW });
  near(costed.totals.cost, 24, 0.5);
});

await test("a refund stays a refund; a receipt with no number or date is dropped", async () => {
  assert.equal(lv.toReceipt(sale(5, { type: "REFUND" })).receipt_type, "REFUND");
  assert.equal(lv.toReceipt({ receipt_date: iso(NOW) }), null);
  assert.equal(lv.toReceipt({ receipt_number: "1-9", receipt_date: "not a date" }), null);
});

/* ── Reading ─────────────────────────────────────────────────────────────── */

await test("every page is read, newest first, 250 asked for at a time", async () => {
  const fake = fakeLoyverse({ receipts: Array.from({ length: 5 }, (_, i) => sale(10 + i, { at: NOW - (i + 1) * DAY })) });
  const out = await lv.loyverseSales("good-token", { days: 62, now: NOW, fetchImpl: fake.fetchImpl });
  assert.equal(out.receipts.length, 5);
  assert.deepEqual(out.receipts.map((r) => r.id), ["1-14", "1-13", "1-12", "1-11", "1-10"], "oldest first");
  const pages = fake.calls.filter((c) => c.startsWith("/v1.0/receipts") || c.includes("/receipts"));
  assert.equal(pages.length, 3);
  assert.ok(pages.every((c) => c.includes("limit=250")));
  assert.ok(pages[1].includes("cursor=2"));
  assert.equal(out.truncated, false);
  assert.equal(out.full, true);
});

await test("a plan that keeps 31 days is read as 30, and remembered", async () => {
  const fake = fakeLoyverse({ limited: true, receipts: [sale(20, { at: NOW - 2 * DAY })] });
  const out = await lv.loyverseSales("good-token", { days: 62, now: NOW, fetchImpl: fake.fetchImpl });
  assert.equal(out.limitedHistory, true);
  assert.equal(out.historyDays, 30);
  assert.equal(out.receipts.length, 1);
  const walks = () => fake.calls.filter((c) => c.includes("created_at_min"));
  assert.equal(walks().length, 2, "asked once for 62 days, refused, then for 30");
  /* The next whole walk goes straight to 30 days: the refusal is not asked
     for again on every quarter-hour. */
  lv.__age(16 * 60e3);
  await lv.loyverseSales("good-token", { days: 62, now: NOW, fetchImpl: fake.fetchImpl });
  assert.equal(walks().length, 3);
  const since = Date.parse(new URL(`http://x${walks()[2]}`).searchParams.get("created_at_min"));
  near(since, NOW - 30 * DAY, 1000);
  /* And after six hours the longer history is asked for again, in case the
     plan has changed. */
  lv.__age(7 * 3600e3);
  fake.state.limited = false;
  const again = await lv.loyverseSales("good-token", { days: 62, now: NOW, fetchImpl: fake.fetchImpl });
  assert.equal(again.limitedHistory, false);
});

await test("a long history cut short says so", async () => {
  const many = Array.from({ length: 90 }, (_, i) => sale(100 + i, { at: NOW - (i % 50 + 1) * 3600e3 }));
  const fake = fakeLoyverse({ receipts: many, pageSize: 2 });
  const out = await lv.loyverseSales("good-token", { days: 62, now: NOW, fetchImpl: fake.fetchImpl });
  assert.equal(out.truncated, true);
  assert.equal(out.receipts.length, 80, "forty pages of two");
});

await test("kept for 45 seconds, then only what changed, then the whole window again", async () => {
  const fake = fakeLoyverse({ receipts: [sale(30, { at: NOW - DAY })] });
  const first = await lv.loyverseSales("good-token", { now: NOW, fetchImpl: fake.fetchImpl });
  const asked = fake.calls.length;
  const again = await lv.loyverseSales("good-token", { now: NOW + 10e3, fetchImpl: fake.fetchImpl });
  assert.equal(fake.calls.length, asked, "nothing asked inside 45 seconds");
  assert.equal(again.wentUpstream, false);
  assert.equal(first.receipts.length, 1);

  /* A new sale, and the old one refunded against. */
  fake.state.receipts.push(sale(31, { at: NOW + 50e3 }), sale(32, { at: NOW + 55e3, type: "REFUND" }));
  lv.__age(60e3);
  const changed = await lv.loyverseSales("good-token", { now: NOW + 60e3, fetchImpl: fake.fetchImpl });
  const last = fake.calls[fake.calls.length - 1];
  assert.ok(last.includes("updated_at_min"), `asked only for changes: ${last}`);
  assert.ok(!fake.calls.slice(asked).some((c) => c.includes("/stores")), "the stores are not asked for again");
  assert.equal(changed.receipts.length, 3);
  assert.equal(changed.full, false);

  lv.__age(16 * 60e3);
  const whole = await lv.loyverseSales("good-token", { now: NOW + 60e3, fetchImpl: fake.fetchImpl });
  assert.ok(fake.calls[fake.calls.length - 1].includes("created_at_min"), "the whole window, every quarter hour");
  assert.equal(whole.full, true);
});

await test("a wider window than was read is read in full", async () => {
  const fake = fakeLoyverse({ receipts: [sale(40, { at: NOW - 100 * DAY }), sale(41, { at: NOW - DAY })] });
  const short = await lv.loyverseSales("good-token", { days: 62, now: NOW, fetchImpl: fake.fetchImpl });
  assert.equal(short.receipts.length, 1);
  const long = await lv.loyverseSales("good-token", { days: 182, now: NOW, fetchImpl: fake.fetchImpl });
  assert.equal(long.receipts.length, 2);
  const back = await lv.loyverseSales("good-token", { days: 62, now: NOW, fetchImpl: fake.fetchImpl });
  assert.equal(back.receipts.length, 1, "a narrower ask is answered from the wider read, narrowed");
});

await test("a failed read shows what was last read and says so, without asking again at once", async () => {
  const fake = fakeLoyverse({ receipts: [sale(50)] });
  await lv.loyverseSales("good-token", { now: NOW, fetchImpl: fake.fetchImpl });
  fake.state.fail = 500;
  lv.__age(60e3);
  const out = await lv.loyverseSales("good-token", { now: NOW, fetchImpl: fake.fetchImpl });
  assert.equal(out.receipts.length, 1);
  assert.equal(out.error.code, "upstream");
  const asked = fake.calls.length;
  const soon = await lv.loyverseSales("good-token", { now: NOW + 5e3, fetchImpl: fake.fetchImpl });
  assert.equal(fake.calls.length, asked, "not asked again inside 30 seconds");
  assert.equal(soon.error.code, "upstream");
  fake.state.fail = null;
  lv.__age(31e3);
  const back = await lv.loyverseSales("good-token", { now: NOW + 5e3, fetchImpl: fake.fetchImpl });
  assert.equal(back.error, null);
});

await test("with nothing read before, a failure is a failure, and a refused token drops what was kept", async () => {
  const down = fakeLoyverse({ fail: "network" });
  await assert.rejects(lv.loyverseSales("good-token", { now: NOW, fetchImpl: down.fetchImpl }), (e) => e.code === "unreachable");
  lv.clearLoyverseCache();
  const fake = fakeLoyverse({ receipts: [sale(60)] });
  await lv.loyverseSales("good-token", { now: NOW, fetchImpl: fake.fetchImpl });
  fake.state.token = "rotated";
  lv.__age(60e3);
  await assert.rejects(lv.loyverseSales("good-token", { now: NOW, fetchImpl: fake.fetchImpl }), (e) => e.code === "token");
  await assert.rejects(lv.loyverseSales("good-token", { now: NOW + 1e3, fetchImpl: fake.fetchImpl }), (e) => e.code === "token" && e.remembered);
  /* Nothing read under the refused connection comes back when the next
     failure is an ordinary one. */
  fake.state.fail = 503;
  lv.__age(31e3);
  await assert.rejects(lv.loyverseSales("good-token", { now: NOW + 1e3, fetchImpl: fake.fetchImpl }), (e) => e.code === "upstream");
});

await test("a read that works clears a failure another screen hit a moment before", async () => {
  const fake = fakeLoyverse({ receipts: [sale(65)] });
  let first = true;
  const flaky = async (url, init) => {
    if (first) { first = false; return { ok: false, status: 500, json: async () => ({}), text: async () => "{}" }; }
    await new Promise((r) => setTimeout(r, 10));
    return fake.fetchImpl(url, init);
  };
  /* Two screens at once, the second asking for a longer window, so it does
     not wait for the first: the first fails, the second works. */
  const [a, b] = await Promise.allSettled([
    lv.loyverseSales("good-token", { days: 62, now: NOW, fetchImpl: flaky }),
    lv.loyverseSales("good-token", { days: 182, now: NOW, fetchImpl: flaky }),
  ]);
  assert.equal(a.status, "rejected");
  assert.equal(b.status, "fulfilled");
  const next = await lv.loyverseSales("good-token", { days: 62, now: NOW + 1e3, fetchImpl: flaky });
  assert.equal(next.error, null, "the working read is what counts");
});

await test("what was kept goes stale after six hours rather than standing in for ever", async () => {
  const fake = fakeLoyverse({ receipts: [sale(70)] });
  await lv.loyverseSales("good-token", { now: NOW, fetchImpl: fake.fetchImpl });
  fake.state.fail = 503;
  lv.__age(7 * 3600e3);
  await assert.rejects(lv.loyverseSales("good-token", { now: NOW, fetchImpl: fake.fetchImpl }), (e) => e.code === "upstream");
});

/* ── Stores ──────────────────────────────────────────────────────────────── */

await test("a new business's one Loyverse store is its first store, not a second", async () => {
  const { org } = await business();
  const { map } = await adoptStores(org.id, [{ id: "L1", name: "Marina" }], { orgName: org.name, unused: true });
  assert.deepEqual(map, { L1: "register" });
  const stores = await listStores(org.id, { includeArchived: true });
  assert.equal(stores.length, 1);
  assert.equal(stores[0].id, "register");
  assert.equal(stores[0].archived, false);
  assert.equal(stores[0].name, "Marina", "the default name gives way to the till's");
  assert.deepEqual(unlockedBranches(await getOrg(org.id), stores.map((s) => s.id)), ["register"]);
  /* Editing the store's address keeps which Loyverse store it is. */
  await saveStore(org.id, { id: "register", name: "Marina", address: "Marina Walk" }, { orgName: org.name });
  assert.equal((await listStores(org.id))[0].pos, "L1");
});

await test("a store the owner named keeps its name; a second Loyverse store is added", async () => {
  const { org } = await business();
  await setJSON(`org:${org.id}:stores`, [{ id: "register", name: "Corniche", address: "", phone: "", trn: "", archived: false }]);
  const { map } = await adoptStores(org.id, [{ id: "L1", name: "Marina" }, { id: "L2", name: "JLT" }], { orgName: org.name });
  assert.deepEqual(map, { L1: "register", L2: "L2" });
  const stores = await listStores(org.id);
  assert.deepEqual(stores.map((s) => s.name), ["Corniche", "JLT"]);
});

await test("a business that sold on Loyverse before comes back as it was", async () => {
  const { org } = await business("old1", { createdAt: Date.parse("2026-06-01") });
  /* What it had when Loyverse was taken out: a ledger per Loyverse store and
     a manager on the second. The first read of its stores made them
     "Branch 2" and "Branch 3" beside an untouched first store. */
  await setJSON(`inv:${org.id}:moves:L1`, [{ id: "m1" }]);
  await setJSON(`inv:${org.id}:moves:L2`, [{ id: "m2" }]);
  await listStores(org.id, { orgName: org.name });
  const { map } = await adoptStores(org.id, [{ id: "L1", name: "Marina" }, { id: "L2", name: "JLT" }], { orgName: org.name, unused: true });
  assert.deepEqual(map, { L1: "L1", L2: "L2" });
  const open = await listStores(org.id);
  assert.deepEqual(open.map((s) => [s.id, s.name]), [["L1", "Marina"], ["L2", "JLT"]]);
  const all = await listStores(org.id, { includeArchived: true });
  assert.equal(all.find((s) => s.id === "register").archived, true, "the empty first store steps aside");
});

await test("the first store stays when it has been used, even with every Loyverse store matched", async () => {
  const { org } = await business("old2", { createdAt: Date.parse("2026-06-01") });
  await setJSON(`inv:${org.id}:moves:L1`, [{ id: "m1" }]);
  await setJSON(`inv:${org.id}:moves:register`, [{ id: "m0" }]);
  await listStores(org.id, { orgName: org.name });
  await adoptStores(org.id, [{ id: "L1", name: "Marina" }], { orgName: org.name, unused: true });
  const all = await listStores(org.id, { includeArchived: true });
  assert.equal(all.find((s) => s.id === "register").archived, false, "it has stock");
});

await test("the first store stays when the register has sold in it", async () => {
  const { org } = await business("old3", { createdAt: Date.parse("2026-06-01") });
  await setJSON(`inv:${org.id}:moves:L1`, [{ id: "m1" }]);
  await listStores(org.id, { orgName: org.name });
  await adoptStores(org.id, [{ id: "L1", name: "Marina" }], { orgName: org.name, unused: false });
  assert.equal((await listStores(org.id)).some((s) => s.id === "register"), true);
});

await test("a store renamed by the owner is not renamed back; a different Loyverse account lets go of the old tie", async () => {
  const { org } = await business();
  await adoptStores(org.id, [{ id: "L1", name: "Marina" }], { orgName: org.name });
  const list = await listStores(org.id, { includeArchived: true });
  await setJSON(`org:${org.id}:stores`, list.map((s) => ({ ...s, name: "Our place" })));
  await adoptStores(org.id, [{ id: "L1", name: "Marina renamed in Loyverse" }], { orgName: org.name });
  assert.equal((await listStores(org.id))[0].name, "Our place");
  const { map } = await adoptStores(org.id, [{ id: "X9", name: "Other account" }], { orgName: org.name });
  assert.deepEqual(map, { X9: "register" }, "the first store is free for the new till");
});

/* ── Tokens and who reads what ───────────────────────────────────────────── */

await test("a member reads through the owner's connection; the token is stored encrypted", async () => {
  const { org } = await business();
  await createAccount({ username: "cashier1", password: "Loyverse-test-9x!" });
  await setMember(org.id, "cashier1", { role: "branch_manager", branches: ["register"] });
  await setJSON("acct:cashier1", { ...(await getAccount("cashier1")), orgId: org.id });
  await setPosToken("owner1", "good-token");
  const stored = await getAccount("owner1");
  assert.ok(stored.posToken && !stored.posToken.includes("good-token"), "not kept as typed");
  assert.equal((await posTokenForOrg(org)).token, "good-token");
  const member = await posOwnership(await getAccount("cashier1"), org);
  assert.deepEqual([member.canConnect, member.connected, member.viaOwner], [false, true, true]);
  const owner = await posOwnership(stored, org);
  assert.deepEqual([owner.canConnect, owner.connected, owner.viaOwner], [true, true, false]);
});

await test("a token a member pasted before only owners could connect still connects the business, until the owner disconnects", async () => {
  const { org } = await business();
  await createAccount({ username: "manager1", password: "Loyverse-test-9x!" });
  await setMember(org.id, "manager1", { role: "ops", branches: [] });
  await setJSON("acct:manager1", { ...(await getAccount("manager1")), orgId: org.id });
  await setPosToken("manager1", "member-token");
  const fresh = await getOrg(org.id);
  assert.deepEqual([(await posTokenForOrg(fresh)).token, (await posTokenForOrg(fresh)).via], ["member-token", "member"]);
  await setPosToken("owner1", "owner-token");
  assert.equal((await posTokenForOrg(fresh)).token, "owner-token", "the owner's own wins");
  await setPosToken("owner1", "");
  assert.equal((await posTokenForOrg(fresh)).token, "", "and the owner disconnecting is the business disconnecting");
});

await test("the server's key belongs to the operator's own business only, and not once it is disconnected", async () => {
  process.env.LOYVERSE_ACCESS_TOKEN = "server-token";
  process.env.ADMIN_EMAIL = "Operator@Example.test";
  const { org: other } = await business("someone", { email: "someone@example.test" });
  assert.equal((await posTokenForOrg(other)).token, "", "not every business's sales");
  const { org: mine } = await business("operator", { email: "operator@example.test" });
  const got = await posTokenForOrg(mine);
  assert.deepEqual([got.token, got.via], ["server-token", "server"]);
  await setPosToken("operator", "");
  assert.equal((await posTokenForOrg(mine)).token, "", "disconnecting means disconnected");
});

await test("a stored token this server can no longer read is a lost connection, not none", async () => {
  const { org } = await business();
  await setJSON("acct:owner1", { ...(await getAccount("owner1")), posToken: "garbage.not.cipher" });
  const out = await posSalesFor(org, { now: NOW });
  assert.equal(out.status.lost, true);
  assert.equal(out.receipts.length, 0);
});

/* ── Into every report ───────────────────────────────────────────────────── */

await test("the register's sales and Loyverse's are one list, under the business's own stores", async () => {
  const fake = useLoyverse(fakeLoyverse({
    stores: [{ id: "L1", name: "Marina" }, { id: "L2", name: "JLT" }],
    receipts: [sale(80, { store: "L1", at: NOW - DAY }), sale(81, { store: "L2", at: NOW - 2 * DAY })],
  }));
  try {
    const { account, org } = await business("both", { createdAt: Date.parse("2026-06-01") });
    await setPosToken("both", "good-token");
    await recordSale(org.id, {
      id: "PM-261101-000001-ABC", receipt_number: "PM-261101-000001-ABC", receipt_type: "SALE", source: "register",
      receipt_date: iso(NOW - 3 * DAY), store_id: "register", total_money: 40, total_tax: 0, vat_mode: "added", vat_pct: 0,
      payments: [{ name: "Cash", money_amount: 40 }], line_items: [{ item_name: "Tea", quantity: 4, total_money: 40 }],
    });
    const ctx = await registerContext(await getAccount("both"));
    assert.equal(ctx.register.length, 3);
    assert.deepEqual(ctx.register.map((r) => r.store_id), ["register", "L2", "register"], "L1 is the first store");
    assert.equal(ctx.pos.ok, true);
    assert.equal(ctx.names.L2, "JLT");
    const m = await getMetrics({ register: ctx.register, names: ctx.names, pos: ctx.pos, now: NOW });
    near(m.totals.sales, 250);
    assert.equal(m.source, "PureMargin + Loyverse");
    assert.equal(m.fetch.posCount, 2);
    assert.ok(fake.calls.length > 0);
    assert.ok(account);
  } finally { globalThis.fetch = realFetch; }
});

await test("a 31-day Loyverse plan means no comparison, not a comparison against nothing", async () => {
  useLoyverse(fakeLoyverse({ limited: true, receipts: [sale(90, { at: NOW - DAY })] }));
  try {
    await business();
    await setPosToken("owner1", "good-token");
    const ctx = await registerContext(await getAccount("owner1"));
    assert.equal(ctx.pos.limitedHistory, true);
    const m = await getMetrics({ register: ctx.register, names: ctx.names, pos: ctx.pos, now: NOW });
    assert.equal(m.totals.salesDelta, null);
    assert.equal(m.fetch.limitedHistory, true);
  } finally { globalThis.fetch = realFetch; }
});

await test("a Loyverse that cannot be read leaves the register's sales and says why", async () => {
  const fake = useLoyverse(fakeLoyverse({ fail: 429 }));
  try {
    const { org } = await business();
    await setPosToken("owner1", "good-token");
    const ctx = await registerContext(await getAccount("owner1"));
    assert.deepEqual([ctx.pos.ok, ctx.pos.error], [false, "ratelimit"]);
    assert.equal(ctx.register.length, 0);
    /* Every screen asking within the minute is one line in the log, not one each. */
    await registerContext(await getAccount("owner1"));
    lv.__age(35e3);
    await registerContext(await getAccount("owner1"));
    const log = await readSyncs(org.id);
    assert.equal(log.length, 1, JSON.stringify(log));
    assert.deepEqual([log[0].ok, log[0].error, log[0].source], [false, "ratelimit", "Loyverse"]);
    fake.state.fail = null;
    lv.__age(35e3);
    await registerContext(await getAccount("owner1"));
    const after = await readSyncs(org.id);
    assert.equal(after.length, 2);
    assert.equal(after[0].ok, true, "and the recovery is noted");
  } finally { globalThis.fetch = realFetch; }
});

await test("figures as last read are marked as such, and a recovery by a small read is noted", async () => {
  const fake = useLoyverse(fakeLoyverse({ receipts: [sale(91, { at: NOW - DAY })] }));
  try {
    const { org } = await business();
    await setPosToken("owner1", "good-token");
    const ok = await posSalesFor(org, { now: NOW });
    assert.equal(ok.status.ok, true);
    fake.state.fail = 500;
    lv.__age(60e3);
    const stale = await posSalesFor(org, { now: NOW });
    assert.equal(stale.receipts.length, 1, "what was last read");
    assert.deepEqual([stale.status.ok, stale.status.error], [false, "upstream"], "and said to be");
    fake.state.fail = null;
    lv.__age(31e3);
    const back = await posSalesFor(org, { now: NOW });
    assert.equal(back.status.ok, true);
    const log = await readSyncs(org.id);
    assert.deepEqual(log.map((e) => e.ok), [true, false, true], JSON.stringify(log));
    /* While it keeps working in small reads, nothing more is written. */
    lv.__age(60e3);
    await posSalesFor(org, { now: NOW });
    assert.equal((await readSyncs(org.id)).length, 3);
  } finally { globalThis.fetch = realFetch; }
});

await test("the stock catch-up and the assistant see Loyverse's sales", async () => {
  useLoyverse(fakeLoyverse({ receipts: [sale(95, { at: NOW - DAY }), sale(96, { at: NOW - 10 * DAY }), sale(98, { at: NOW - 7.5 * DAY })] }));
  try {
    const { org } = await business();
    await setPosToken("owner1", "good-token");
    const week = await salesReceipts(org.id, { since: NOW - 7 * DAY });
    assert.deepEqual(week.receipts.map((r) => r.id), ["1-95"]);
    assert.equal(week.receipts[0].store_id, "register");
  } finally { globalThis.fetch = realFetch; }
});

/* ── Connecting ──────────────────────────────────────────────────────────── */

function fakeRes() {
  const r = { code: null, body: null, headers: {}, setHeader(k, v) { r.headers[k] = v; return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  return r;
}
async function call(username, method, body) {
  const account = await getAccount(username);
  const res = fakeRes();
  await accountRoute({ method, url: "/api/account", headers: { authorization: `Bearer ${issueToken(username, account.tokenVersion || 0)}` }, query: {}, body }, res);
  return res;
}

await test("only the owner connects; a token Loyverse refuses is not kept", async () => {
  useLoyverse(fakeLoyverse({ stores: [{ id: "L1", name: "Marina" }, { id: "L2", name: "JLT" }] }));
  try {
    const { org } = await business();
    await createAccount({ username: "chef1", password: "Loyverse-test-9x!" });
    await setMember(org.id, "chef1", { role: "chef", branches: [] });
    await setJSON("acct:chef1", { ...(await getAccount("chef1")), orgId: org.id });

    assert.equal((await call("chef1", "PUT", { posToken: "good-token" })).code, 403);
    const wrong = await call("owner1", "PUT", { posToken: "wrong-token" });
    assert.deepEqual([wrong.code, wrong.body.reason], [422, "token"]);
    assert.equal((await getAccount("owner1")).posToken || "", "", "nothing kept");
    assert.equal((await call("owner1", "PUT", { posToken: "has space" })).code, 400);

    const ok = await call("owner1", "PUT", { posToken: " good-token " });
    assert.equal(ok.code, 200);
    assert.deepEqual(ok.body.stores, ["Marina", "JLT"]);
    assert.equal(ok.body.pos.connected, true);
    assert.ok(!JSON.stringify(ok.body).includes("good-token"), "the token never comes back");
    assert.deepEqual((await listStores(org.id)).map((s) => s.name), ["Marina", "JLT"], "the stores are there before any sale is read");
    const audit = await readAudit(org.id);
    assert.equal(audit[0].action, "pos.connect");
    assert.ok(!JSON.stringify(audit).includes("good-token"));

    const seen = await call("chef1", "GET");
    assert.deepEqual([seen.body.pos.connected, seen.body.pos.viaOwner, seen.body.pos.canConnect], [true, true, false]);
    assert.ok(!JSON.stringify(seen.body).includes("good-token"));

    const off = await call("owner1", "PUT", { posToken: "" });
    assert.equal(off.code, 200);
    assert.equal(off.body.pos.connected, false);
    assert.equal((await readAudit(org.id))[0].action, "pos.disconnect");
  } finally { globalThis.fetch = realFetch; }
});

await test("a Loyverse that does not answer while connecting is not the owner's mistake", async () => {
  useLoyverse(fakeLoyverse({ fail: "network" }));
  try {
    await business();
    const out = await call("owner1", "PUT", { posToken: "good-token" });
    assert.deepEqual([out.code, out.body.reason], [502, "unreachable"]);
  } finally { globalThis.fetch = realFetch; }
});

await test("an account connected before Loyverse was taken out is connected again, with no action", async () => {
  useLoyverse(fakeLoyverse({ stores: [{ id: "L1", name: "Marina" }], receipts: [sale(97, { store: "L1" })] }));
  try {
    /* Its record still carries the encrypted token it saved back then. */
    const { org } = await business("before", { createdAt: Date.parse("2026-05-01") });
    await setPosToken("before", "good-token");
    await setJSON(`inv:${org.id}:moves:L1`, [{ id: "m1" }]);
    const ctx = await registerContext(await getAccount("before"));
    assert.equal(ctx.pos.connected, true);
    assert.deepEqual(ctx.register.map((r) => r.store_id), ["L1"], "filed under the branch its stock is under");
    assert.equal(ctx.names.L1, "Marina");
  } finally { globalThis.fetch = realFetch; }
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
