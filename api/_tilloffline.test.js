/* Selling with no connection, end to end.

   The real till code (`src/register/api.js`) on one side, the real route
   (`api/till.js`) on the other, and a wire between them that can be cut.
   Nothing here is a model of either: a sale is rung up by `sell()`, queued
   by it, sent by `flush()`, and recorded by the handler.

   What this protects — each of these was either broken or unguarded:

     · a sale made offline is recorded, once, under the number the customer
       was given, whatever happened on the server in the meantime: no shift
       open, the cashier's PIN session run out, a price changed, the dish
       archived, the channel switched off, the customer removed;
     · it is recorded as charged — never re-priced to a figure the customer
       did not pay — and when that differs from the server's own figure it
       is marked and written to the audit log;
     · none of that opens a way to name your own price: a sale that is not
       replayed is priced by the server alone, and a replayed receipt that
       does not add up is not believed;
     · unsent sales belong to whoever made them, survive a failing server
       and a Wi-Fi sign-in page, and are not lost to a second pass. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

/* The device: its storage, and its connection. */
const disk = new Map();
globalThis.localStorage = {
  getItem: (k) => (disk.has(k) ? disk.get(k) : null),
  setItem: (k, v) => { disk.set(k, String(v)); },
  removeItem: (k) => { disk.delete(k); },
};
let net = "up";
/* Called with each request that reaches the server; may return a response
   to stand in for the server's, or do something while it is in flight. */
let onWire = null;
const sentBodies = [];

const { createAccount, getAccount } = await import("./_accounts.js");
const { issueToken } = await import("./_auth.js");
const { orgFor } = await import("./_org.js");
const { addEmployee } = await import("./_employees.js");
const { saveVersion, setSellPrice, archiveRecipe, listRecipes } = await import("./_recipes.js");
const { registerReceipts, getSettings, putSettings } = await import("./_till.js");
const { saveCustomer } = await import("./_tillbook.js");
const { saveChannel, addRule, setPrices } = await import("./_channels.js");
const { itemKeyOf } = await import("../shared/channelmath.js");
const { readAudit } = await import("./_audit.js");
const { readTillReceipt, reconcileOffline, REVIEW_REASONS } = await import("./_tilloffline.js");
const { POS_STRINGS } = await import("../src/i18n-pos.js");
const { buildSale, receiptNumber } = await import("../shared/tillprice.js");
const route = (await import("./till.js")).default;
const client = await import("../src/register/api.js");

function fakeRes() {
  const r = { code: null, body: null, headers: {}, setHeader(k, v) { r.headers[k] = v; return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  return r;
}
const answer = (status, body, type = "application/json") => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? type : null) },
  json: async () => { if (!/json/.test(type)) throw new SyntaxError("Unexpected token <"); return body; },
});
globalThis.fetch = async (url, init = {}) => {
  if (net === "down") throw new TypeError("Failed to fetch");
  if (net === "portal") return answer(200, "<html>Sign in to Cafe Wi-Fi</html>", "text/html");
  if (net === "gateway") return answer(502, "<html>Bad gateway</html>", "text/html");
  if (net === "failing") return answer(503, { error: "storage" });
  const u = new URL(url, "http://till.test");
  const body = init.body ? JSON.parse(init.body) : undefined;
  const stood = onWire ? await onWire({ method: init.method || "GET", what: u.searchParams.get("what"), body }) : null;
  if (stood) return stood;
  if (body) sentBodies.push(body);
  const res = fakeRes();
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  await route({ method: init.method || "GET", url: u.pathname + u.search, headers, query: Object.fromEntries(u.searchParams), body }, res);
  return answer(res.code, res.body);
};

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  disk.clear();
  net = "up";
  onWire = null;
  sentBodies.length = 0;
  client.setQueueOwner("owner1");
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

async function shop({ user = "owner1", shifts = true } = {}) {
  await createAccount({ username: user, password: "Till-test-9x!" });
  const account = await getAccount(user);
  const org = await orgFor(account);
  await saveVersion(org.id, { id: "wrap", menuItem: "Chicken wrap", sellPrice: 18, lines: [{ name: "Chicken", qty: 150, unit: "g" }] });
  await saveVersion(org.id, { id: "tea", menuItem: "Tea", sellPrice: 4, lines: [{ name: "Milk", qty: 50, unit: "ml" }] });
  /* No VAT, so every figure below can be checked in the head. */
  await putSettings(org.id, { ...(await getSettings(org.id)), vatPct: 0, ...(shifts ? {} : { useShifts: false }) });
  const token = issueToken(user, account.tokenVersion || 0);
  const catalogue = await client.loadCatalogue(token, user);
  return { org, token, catalogue, user };
}
const wrapId = (catalogue) => catalogue.items.find((i) => i.name === "Chicken wrap").id;
const order = (catalogue, over = {}) => ({
  branchId: "register", orderType: "takeaway", lines: [{ itemId: wrapId(catalogue), qty: 1 }], payments: [{ type: "card" }], ...over,
});
const booked = async (org) => registerReceipts(org.id, { since: Date.now() - 86400e3, now: Date.now() + 60e3 });
const offlineSale = async (token, catalogue, over) => {
  net = "down";
  const out = await client.sell(token, order(catalogue, over), catalogue);
  net = "up";
  return out;
};

/* ── Sold offline, sent later ── */

await test("a sale made with no connection is printed, queued, and recorded once under the number the customer holds", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  const out = await offlineSale(token, catalogue);
  assert.equal(out.offline, true);
  assert.equal(out.receipt.total_money, 18, "priced on the device, by the server's own code");
  assert.equal(client.queued().length, 1);
  assert.equal((await booked(org)).length, 0, "nothing reached the server");

  const sent = await client.flush(token);
  assert.deepEqual([sent.sent, sent.left, sent.refused], [1, 0, 0]);
  const rows = await booked(org);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].receipt_number, out.receipt.receipt_number, "the number on the paper is the number in the books");
  assert.equal(rows[0].offline, true);
  assert.equal(rows[0].price_source, undefined, "the server priced it itself and agreed");
  assert.equal(rows[0].review, undefined);

  /* The answer to the first send never arrived, so the till sends it again. */
  const again = await globalThis.fetch("/api/till?what=sale", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(sentBodies.at(-1)) });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).duplicate, true);
  assert.equal((await booked(org)).length, 1, "a sale sent twice is one sale");
});

await test("it is not refused because no shift was open on the server — a sale rung up now still is", async () => {
  const { org, token, catalogue } = await shop();
  await assert.rejects(client.sell(token, order(catalogue), catalogue), (err) => err.status === 409 && err.body.error === "noshift");

  await offlineSale(token, catalogue);
  const sent = await client.flush(token);
  assert.deepEqual([sent.sent, sent.refused], [1, 0], "already sold: there is nobody left to refuse");
  const [row] = await booked(org);
  assert.equal(row.shift_id, null, "in no drawer count, rather than in the wrong one");
});

await test("a shift opened offline starts when the till opened it, and the sales made since are in its drawer", async () => {
  const { org, token, catalogue } = await shop();
  const openedAt = Date.now() - 5 * 60e3;
  /* What `OpenShift` queues when the server cannot be reached. */
  client.enqueue("shift-open", { branchId: "register", float: 200, offline: true, at: openedAt, by: "Sara" });
  await offlineSale(token, catalogue, { payments: [{ type: "cash" }] });

  const sent = await client.flush(token);
  assert.deepEqual([sent.sent, sent.refused], [2, 0]);
  const state = await client.call(token, "shift", { query: { branchId: "register" } });
  assert.equal(state.shift.openedAt, openedAt, "not when the connection came back");
  assert.equal(state.shift.float, 200);
  const [row] = await booked(org);
  assert.equal(row.shift_id, state.shift.id);
  assert.equal(state.summary.sales ?? state.summary.count ?? 1, 1);
  assert.ok(JSON.stringify(state.summary).includes("18"), "the cash is in the count");
});

await test("a shift opened offline that the server already has open is dropped quietly, and the sale behind it still goes", async () => {
  const { org, token, catalogue } = await shop();
  await client.call(token, "shift-open", { method: "POST", body: { branchId: "register", float: 50 } });
  client.enqueue("shift-open", { branchId: "register", float: 200, offline: true, at: Date.now(), by: "Sara" });
  await offlineSale(token, catalogue);
  const sent = await client.flush(token);
  assert.deepEqual([sent.sent, sent.left, sent.refused], [1, 0, 0], "an opening nobody needs is not a problem to show anyone");
  assert.equal((await booked(org)).length, 1);
});

await test("a sale from before the shift now open is not added to that shift's cash", async () => {
  const { org, token, catalogue } = await shop();
  await offlineSale(token, catalogue);
  /* Sent only after somebody else has opened a new shift. */
  await new Promise((r) => setTimeout(r, 5));
  await client.call(token, "shift-open", { method: "POST", body: { branchId: "register", float: 0 } });
  await client.flush(token);
  const [row] = await booked(org);
  assert.equal(row.shift_id, null);
});

await test("it is not refused because the cashier's PIN session ran out, and it still names who rang it up", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  const sara = await addEmployee(org.id, { name: "Sara", title: "Cashier", branchId: "register" });
  await client.call(token, "pins", { method: "PUT", body: { employeeId: sara.employee?.id || sara.id, pin: "1234", role: "cashier" } });
  const pin = await client.call(token, "pin", { method: "POST", body: { pin: "1234" } });
  client.setOperator(pin.operator, pin.token);
  await offlineSale(token, catalogue);

  /* By the time the connection is back she has signed out of the till. */
  client.setOperator(null);
  await assert.rejects(client.sell(token, order(catalogue), catalogue), (err) => err.status === 401, "a sale rung up now needs a PIN");
  const sent = await client.flush(token);
  assert.deepEqual([sent.sent, sent.refused], [1, 0]);
  assert.equal((await booked(org))[0].cashier, "Sara", "not the account the tablet is signed in to");
});

/* ── Recorded as charged ── */

await test("a price changed while the till was offline: the books say what the customer paid, and say so", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  /* As the charge screen sends it: the money tendered, to the fil. That is
     what makes this the hard case — at the new price the same payment no
     longer covers the sale, so the server cannot build it at all, and has
     to find out separately that the reason is the price. */
  const out = await offlineSale(token, catalogue, { lines: [{ itemId: wrapId(catalogue), qty: 2 }], payments: [{ type: "cash", amount: 36, received: 50 }] });
  assert.equal(out.receipt.total_money, 36);
  await setSellPrice(org.id, "wrap", 20);

  const sent = await client.flush(token);
  assert.deepEqual([sent.sent, sent.refused], [1, 0]);
  const [row] = await booked(org);
  assert.equal(row.total_money, 36, "not 40: nobody paid 40");
  assert.equal(row.line_items[0].price, 18);
  assert.equal(row.price_source, "till");
  assert.deepEqual(row.review, ["total"]);
  assert.equal(row.review_server_total, 40, "what the menu would have charged, for whoever looks");
  assert.equal(row.receipt_number, out.receipt.receipt_number);
  assert.equal(row.store_id, "register");
  assert.equal(row.channel_id, "in-store");

  const log = await readAudit(org.id);
  const entry = log.find((e) => e.action === "register.offline");
  assert.ok(entry, "and it can be found afterwards");
  assert.equal(entry.detail.total, 36);
  assert.equal(entry.detail.serverTotal, 40);
  assert.equal(entry.detail.why, "total");
});

await test("an unchanged menu leaves nothing to look at: the server's own receipt, no mark, no audit row", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  await offlineSale(token, catalogue);
  await client.flush(token);
  const [row] = await booked(org);
  assert.equal(row.price_source, undefined);
  assert.equal((await readAudit(org.id)).some((e) => e.action === "register.offline"), false);
});

await test("a dish archived while the till was offline was still sold", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  const out = await offlineSale(token, catalogue, { payments: [{ type: "cash", amount: 18, received: 20 }] });
  await archiveRecipe(org.id, "wrap");
  assert.equal((await listRecipes(org.id)).some((r) => r.id === "wrap" && !r.archived), false);

  const sent = await client.flush(token);
  assert.deepEqual([sent.sent, sent.refused], [1, 0]);
  const [row] = await booked(org);
  assert.equal(row.total_money, 18);
  assert.equal(row.line_items[0].item_name, "Chicken wrap");
  assert.equal(row.receipt_number, out.receipt.receipt_number);
  assert.deepEqual(row.review, ["rebuild"]);
  assert.equal("review_server_total" in row, false, "there was no menu price to compare with");
});

await test("sent twice after the menu moved, it is answered 'we have it' — not examined again and refused", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  await offlineSale(token, catalogue);
  const [entry] = client.queued();
  await client.flush(token);
  await archiveRecipe(org.id, "wrap");

  client.enqueue(entry.kind, entry.body);
  const sent = await client.flush(token);
  assert.deepEqual([sent.sent, sent.refused], [1, 0]);
  assert.equal((await booked(org)).length, 1);
});

await test("a channel or a customer gone since does not undo the sale", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  await assert.rejects(client.sell(token, order(catalogue, { channelId: "c-gone" }), catalogue), (err) => err.status === 422 && err.body.error === "channel");
  await assert.rejects(client.sell(token, order(catalogue, { customerId: "nobody" }), catalogue), (err) => err.status === 422 && err.body.error === "customer");

  await offlineSale(token, catalogue, { channelId: "c-gone", customerId: "nobody" });
  const sent = await client.flush(token);
  assert.deepEqual([sent.sent, sent.refused], [1, 0]);
  const [row] = await booked(org);
  assert.equal(row.channel_id, "in-store", "filed at the counter");
  assert.equal(row.customer_id || null, null);
});

await test("an order rung up offline on a delivery app is charged that app's price, and stays on it after the app is switched off", async () => {
  const { org, token } = await shop({ shifts: false });
  const made = await saveChannel(org.id, { preset: "talabat", name: "Talabat", active: true });
  assert.ok(!made.error, made.error);
  const id = made.channel.id;
  assert.ok(!(await addRule(org.id, id, { commissionPct: 30, validFrom: "2026-01-01" })).error);
  const catalogue = await client.loadCatalogue(token, "owner1");
  const priced = await setPrices(org.id, id, [{ itemKey: itemKeyOf(wrapId(catalogue), ""), price: 24 }], { by: "owner1" });
  assert.ok(!priced.error, priced.error);
  const fresh = await client.loadCatalogue(token, "owner1");
  assert.ok(fresh.channels.some((c) => c.id === id), "the till keeps the channel and its prices");

  const out = await offlineSale(token, fresh, { channelId: id });
  assert.equal(out.receipt.total_money, 24, "not the counter's 18");
  await saveChannel(org.id, { id, active: false });

  await client.flush(token);
  const [row] = await booked(org);
  assert.equal(row.total_money, 24);
  assert.equal(row.channel_id, id);
  assert.equal(row.channel_fee_rule?.commissionPct, 30, "costed under the fees it was sold under");
});

await test("a till left in a drawer for ten days: its sales are filed on the day they were made, under their own numbers", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  await offlineSale(token, catalogue);
  const [entry] = client.queued();
  const then = Date.now() - 10 * 86400e3;
  const made = (at, clientId) => {
    const number = receiptNumber(at);
    const body = { ...entry.body, at, number, clientId };
    const receipt = buildSale(body, { catalogue: catalogue.items, vatPct: catalogue.vatPct, vatMode: catalogue.vatMode, paymentTypes: catalogue.paymentTypes, discounts: catalogue.discounts, branchId: "register", at, number, clientId }).receipt;
    return { kind: "sale", body: { ...body, receipt }, at };
  };
  const old = made(then, "ten-days");
  const absurd = made(Date.now() - 400 * 86400e3, "last-year");
  disk.set("pm_reg_q:owner1", JSON.stringify([old, absurd]));
  /* And the dish has gone from the menu since, so the server has no number
     of its own to fall back on unless it makes one. */
  await archiveRecipe(org.id, "wrap");
  const sent = await client.flush(token);
  assert.deepEqual([sent.sent, sent.refused], [2, 0]);

  const rows = await registerReceipts(org.id, { since: Date.now() - 30 * 86400e3, now: Date.now() + 60e3 });
  const kept = rows.find((r) => r.client_id === "ten-days");
  assert.equal(new Date(kept.receipt_date).getTime(), then);
  assert.equal(kept.receipt_number, old.body.number);
  const redated = rows.find((r) => r.client_id === "last-year");
  assert.ok(redated, "a date nobody can believe is filed on arrival, not thrown away");
  assert.ok(Date.now() - new Date(redated.receipt_date).getTime() < 60e3);
  assert.match(redated.receipt_number, /^PM-\d{6}-\d{6}-[0-9A-Z]{3}$/);
  assert.notEqual(redated.receipt_number, absurd.body.number);
});

await test("everything the till can ring up is a receipt the server will take as it stands", async () => {
  const items = [
    { id: "burger", kind: "recipe", name: "Burger", price: 32.5, variants: [], addons: [{ id: "cheese", name: "Cheese", price: 3.25, cost: 1.1 }, { id: "egg", name: "Egg", price: 4, cost: null }] },
    { id: "fries", kind: "recipe", name: "Fries", price: 9, addons: [], variants: [{ id: "v-l", name: "Large", price: 12.75, scale: 1.5 }] },
    { id: "water", kind: "product", name: "Water", price: 2.5, cost: 0.8, addons: [], variants: [], stock: { ingredientId: "water-500", qty: 1, unit: "ea" } },
  ];
  const presets = [{ id: "staff", name: "Staff", type: "pct", value: 12.5 }, { id: "five", name: "Five off", type: "amount", value: 5, restricted: true }];
  const types = [{ id: "cash", name: "Cash", kind: "cash" }, { id: "card", name: "Card", kind: "card" }];
  const orders = [
    { orderType: "dine_in", table: "7", note: "no onions", lines: [{ itemId: "burger", qty: 3, addons: ["cheese", "egg"], discount: { id: "staff" }, note: "well done" }, { itemId: "fries", qty: 2, variantId: "v-l" }, { itemId: "water", qty: 7 }], discount: { id: "five" } },
    { orderType: "delivery", lines: [{ itemId: "water", qty: 1 }, { itemId: "burger", qty: 1 }], discount: { type: "pct", value: 33.33 } },
    { orderType: "takeaway", lines: [{ itemId: "fries", qty: 999, variantId: "v-l" }] },
  ];
  let checked = 0;
  for (const [vatPct, vatMode] of [[5, "exclusive"], [5, "inclusive"], [0, "exclusive"], [15, "inclusive"], [7.5, "exclusive"]]) {
    for (const o of orders) {
      const price = buildSale({ ...o, payments: [{ type: "card" }] }, { catalogue: items, vatPct, vatMode, paymentTypes: types, discounts: presets, at: Date.now() });
      assert.ok(!price.error, price.error);
      const total = price.receipt.total_money;
      const half = Math.round((total / 2) * 100) / 100;
      const built = buildSale({ ...o, payments: [{ type: "card", amount: half }, { type: "cash", amount: Math.round((total - half) * 100) / 100, received: total + 50 }] }, {
        catalogue: items, vatPct, vatMode, paymentTypes: types, discounts: presets, at: Date.now(),
      });
      assert.ok(!built.error, `${vatMode} ${vatPct}: ${built.error}`);
      const read = readTillReceipt(built.receipt, { presets });
      assert.ok(read, `refused its own till's receipt: ${vatMode} ${vatPct}% ${o.orderType}`);
      for (const key of ["total_money", "total_tax", "subtotal_money", "total_discount", "order_type", "table", "note", "vat_pct", "vat_mode"]) {
        assert.deepEqual(read[key], built.receipt[key], `${key} (${vatMode} ${vatPct}%)`);
      }
      assert.deepEqual(JSON.parse(JSON.stringify(read.line_items)), JSON.parse(JSON.stringify(built.receipt.line_items)), "the lines, to the field");
      assert.deepEqual(read.payments.map((p) => [p.type, p.money_amount, p.change]), built.receipt.payments.map((p) => [p.type, p.money_amount, p.change || 0]));
      assert.deepEqual(read.discounts.map((d) => Boolean(d.custom)), built.receipt.discounts.map((d) => Boolean(d.custom)), "what was typed in stays marked as typed in");
      checked += 1;
    }
  }
  assert.equal(checked, 15);
});

/* ── Not a way to name your own price ── */

await test("a sale that is not replayed is priced by the server alone, whatever receipt it carries", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  const cheap = buildSale({ ...order(catalogue), clientId: "x", number: receiptNumber(Date.now()), at: Date.now() }, {
    catalogue: catalogue.items.map((i) => ({ ...i, price: 1 })), vatPct: catalogue.vatPct, vatMode: catalogue.vatMode,
    paymentTypes: catalogue.paymentTypes, discounts: catalogue.discounts, branchId: "register", at: Date.now(),
  }).receipt;
  assert.equal(cheap.total_money, 1);
  const out = await client.call(token, "sale", { method: "POST", body: { ...order(catalogue), receipt: cheap } });
  assert.equal(out.receipt.total_money, 18);
  assert.equal((await booked(org))[0].total_money, 18);
});

await test("a replayed receipt that does not add up is not believed", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  await offlineSale(token, catalogue);
  const [entry] = client.queued();
  /* The total lowered, the lines left alone. */
  const bent = { ...entry.body, clientId: "bent-1", receipt: { ...entry.body.receipt, total_money: 1, payments: [{ ...entry.body.receipt.payments[0], money_amount: 1 }] } };
  const out = await client.call(token, "sale", { method: "POST", body: bent });
  assert.equal(out.receipt.total_money, 18, "the server can price it, so the server's price it is");
  assert.equal(out.receipt.price_source, undefined);

  /* And when the server cannot price it either, there is nothing to record. */
  await archiveRecipe(org.id, "wrap");
  await assert.rejects(client.call(token, "sale", { method: "POST", body: { ...bent, clientId: "bent-2", number: receiptNumber(Date.now()) } }), (err) => err.status === 422);
  assert.equal((await booked(org)).length, 1);
});

await test("the till's receipt is read as a receipt and nothing more", async () => {
  const { token, catalogue } = await shop({ shifts: false });
  await offlineSale(token, catalogue);
  const raw = client.queued()[0].body.receipt;
  const read = readTillReceipt({ ...raw, store_id: "someone-elses", shift_id: "s-9", price_source: "server", channel_economics: { profit: 999 }, points_earned: 500, points_redeemed: 500, evil: true });
  for (const key of ["store_id", "shift_id", "price_source", "channel_economics", "evil", "id", "receipt_number", "cashier"]) {
    assert.equal(key in read, false, key);
  }
  assert.deepEqual([read.points_earned, read.points_redeemed], [0, 0]);
  assert.equal(read.total_money, 18);

  const line = raw.line_items[0];
  const bad = (over, lineOver) => readTillReceipt({ ...raw, ...over, line_items: [{ ...line, ...lineOver }] });
  assert.equal(bad({}, { quantity: -1 }), null, "a negative quantity");
  assert.equal(bad({}, { quantity: 1.5 }), null);
  assert.equal(bad({}, { total_money: 2 }), null, "a line that is not price × quantity less its discount");
  assert.equal(bad({}, { price: 1 }), null, "a price the line's own total contradicts");
  assert.equal(bad({}, { total_discount: 30, total_money: -12 }), null, "more taken off than there was");
  assert.equal(bad({ total_tax: 9 }), null, "tax that is not the rate on the lines");
  assert.equal(bad({ payments: [{ ...raw.payments[0], money_amount: 5 }] }), null, "payments that do not come to the total");
  assert.equal(bad({ receipt_type: "REFUND" }), null, "only ever a sale");
  assert.equal(bad({ vat_pct: 500 }), null);
  assert.equal(readTillReceipt(null), null);
  assert.equal(readTillReceipt({ ...raw, line_items: [] }), null);
});

await test("a discount typed in offline by a cashier is flagged for a manager, not undone — and one rung up now is still refused", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  const sara = await addEmployee(org.id, { name: "Sara", title: "Cashier", branchId: "register" });
  await client.call(token, "pins", { method: "PUT", body: { employeeId: sara.employee?.id || sara.id, pin: "1234", role: "cashier" } });
  const pin = await client.call(token, "pin", { method: "POST", body: { pin: "1234" } });
  client.setOperator(pin.operator, pin.token);
  const half = { discount: { type: "pct", value: 50 } };
  await assert.rejects(client.sell(token, order(catalogue, half), catalogue), (err) => err.status === 403 && err.body.error === "discount");

  const out = await offlineSale(token, catalogue, half);
  assert.equal(out.receipt.total_money, 9);
  /* Once with her still signed in, once with nobody at the till. */
  await client.flush(token);
  await offlineSale(token, catalogue, half);
  client.setOperator(null);
  const sent = await client.flush(token);
  assert.equal(sent.refused, 0);

  const rows = await booked(org);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.total_money, 9, "it was given; the books say so");
    assert.deepEqual(row.review, ["discount"]);
  }
  assert.equal((await readAudit(org.id)).filter((e) => e.action === "register.offline").length, 2);
});

await test("points are not spent offline, and a receipt cannot claim they were", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  await putSettings(org.id, { ...(await getSettings(org.id)), loyaltyPct: 5 });
  const saved = await saveCustomer(org.id, { name: "Layla", phone: "0500000001" });
  const customerId = saved.customer?.id || saved.id;
  assert.ok(customerId);
  const fresh = await client.loadCatalogue(token, "owner1");
  /* She has points to spend: twenty wraps' worth. */
  await client.call(token, "sale", { method: "POST", body: order(fresh, { customerId, lines: [{ itemId: wrapId(fresh), qty: 20 }] }) });
  const before = (await client.call(token, "customers")).customers.find((c) => c.id === customerId).points;
  assert.equal(before, 18);
  /* The screen showed a total with points off. Charging the full amount
     instead, silently, would be a different sale from the one agreed. */
  net = "down";
  await assert.rejects(client.sell(token, order(fresh, { customerId, redeemPoints: 10 }), fresh), (err) => err.body.error === "pointsOffline");
  assert.equal(client.queued().length, 0);
  const out = await offlineSale(token, fresh, { customerId });
  assert.equal(out.receipt.total_money, 18);
  /* And a queue entry edited to ask for them anyway gets none. */
  const [entry] = client.queued();
  disk.set("pm_reg_q:owner1", JSON.stringify([{ ...entry, body: { ...entry.body, redeemPoints: 10 } }]));
  await client.flush(token);
  const row = (await booked(org)).find((r) => r.offline);
  assert.equal(row.total_money, 18);
  assert.equal(row.points_redeemed || 0, 0);
  assert.equal(row.customer_id, customerId);
  assert.equal(row.price_source, undefined, "and that is the server's own figure, not a disagreement to review");

  const raw = { ...out.receipt };
  const claimed = readTillReceipt({ ...raw, discounts: [{ id: "points", name: "Points", type: "amount", value: 5, scope: "ticket", money_amount: 5 }] });
  assert.equal(claimed.discounts[0].custom, true, "a discount nobody preset, whatever it calls itself");
});

await test("reconciling: the server's receipt when it agrees, the till's when it does not, an error only when neither stands", async () => {
  const { token, catalogue } = await shop({ shifts: false });
  await offlineSale(token, catalogue);
  const till = client.queued()[0].body.receipt;
  const server = (total) => ({ receipt: { total_money: total, marker: "server" } });
  assert.equal(reconcileOffline(server(18), till).from, "server");
  assert.equal(reconcileOffline(server(18.01), till).from, "server", "a rounding fil is not a disagreement");
  const moved = reconcileOffline(server(20), till);
  assert.deepEqual([moved.from, moved.why, moved.serverTotal, moved.receipt.total_money], ["till", "total", 20, 18]);
  assert.equal(reconcileOffline({ error: "item" }, till).from, "till");
  /* Underpaid at today's price is a changed price, not a missing dish. */
  assert.deepEqual([reconcileOffline({ error: "payment" }, till, { menuTotal: 21 }).why, reconcileOffline({ error: "payment" }, till, { menuTotal: 21 }).serverTotal], ["total", 21]);
  assert.deepEqual([reconcileOffline({ error: "payment" }, till, { menuTotal: 18 }).why, reconcileOffline({ error: "payment" }, till, { menuTotal: 18 }).serverTotal], ["rebuild", null], "same price, so something else moved");
  assert.equal(reconcileOffline({ error: "item" }, till, { menuTotal: null }).why, "rebuild");
  assert.equal(reconcileOffline({ error: "item" }, { ...till, total_money: 3 }).error, "item");
  assert.equal(reconcileOffline(server(20), null).receipt.marker, "server", "no receipt sent: priced as ever");
});

await test("every reason a sale can be marked has its wording, in every language the register speaks", async () => {
  for (const [lang, P] of Object.entries(POS_STRINGS)) {
    assert.deepEqual(Object.keys(P.offline.why).sort(), [...REVIEW_REASONS].sort(), lang);
    for (const code of REVIEW_REASONS) assert.ok(P.offline.why[code].trim(), `${lang}: ${code}`);
  }
  const { token, catalogue } = await shop({ shifts: false });
  await offlineSale(token, catalogue);
  const till = client.queued()[0].body.receipt;
  for (const built of [{ error: "item" }, { receipt: { total_money: 99 } }]) {
    assert.ok(REVIEW_REASONS.includes(reconcileOffline(built, till).why), "and nothing is marked for a reason nobody can read");
  }
});

/* ── The queue ── */

await test("unsent sales belong to whoever made them: the next person to sign in on the tablet does not send them", async () => {
  const a = await shop({ shifts: false });
  await offlineSale(a.token, a.catalogue);
  assert.equal(client.queued().length, 1);

  /* Another business signs in on the same device. */
  const b = await shop({ user: "owner2", shifts: false });
  client.setQueueOwner("owner2");
  assert.equal(client.queued().length, 0);
  const sent = await client.flush(b.token);
  assert.equal(sent.sent, 0);
  assert.equal((await booked(b.org)).length, 0, "not in somebody else's books");

  client.setQueueOwner("owner1");
  assert.equal(client.queued().length, 1, "still waiting for the person who rang it up");
  await client.flush(a.token);
  assert.equal((await booked(a.org)).length, 1);
});

await test("sales queued by the build before this one are adopted, not stranded", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  await offlineSale(token, catalogue);
  const [entry] = client.queued();
  disk.delete("pm_reg_q:owner1");
  disk.set("pm_reg_queue", JSON.stringify([{ kind: "sale", body: { ...entry.body, offline: undefined, receipt: undefined }, at: entry.at }]));
  disk.set("pm_reg_queue:refused", JSON.stringify([{ kind: "sale", body: { ...entry.body, clientId: "old-refused" }, error: { error: "noshift" } }]));

  client.setQueueOwner("owner1");
  assert.equal(client.queued().length, 1);
  assert.equal(client.refusedSales().length, 1);
  assert.equal(disk.has("pm_reg_queue"), false);
  client.setQueueOwner("owner1");
  assert.equal(client.queued().length, 1, "adopting twice adopts once");
  await client.flush(token);
  assert.equal((await booked(org)).length, 1);
});

await test("a server that is failing is no reason to stop selling: the sale is queued, and sent when it recovers", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  for (const state of ["failing", "gateway", "portal"]) {
    net = state;
    const out = await client.sell(token, order(catalogue), catalogue);
    assert.equal(out.offline, true, state);
  }
  assert.equal(client.queued().length, 3);
  net = "portal";
  const stuck = await client.flush(token);
  assert.deepEqual([stuck.sent, stuck.left], [0, 3], "a Wi-Fi sign-in page saying 200 is not the sale going through");
  net = "up";
  const sent = await client.flush(token);
  assert.deepEqual([sent.sent, sent.left, sent.refused], [3, 0, 0]);
  assert.equal((await booked(org)).length, 3);
});

await test("one sale the server keeps failing on is set aside after a few goes, where it can be seen and sent again", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  await offlineSale(token, catalogue);
  await offlineSale(token, catalogue);
  const poison = client.queued()[0].body.clientId;
  onWire = ({ body }) => (body?.clientId === poison ? answer(500, { error: "server" }) : null);

  let out = null;
  for (let i = 0; i < 5; i += 1) {
    out = await client.flush(token);
    assert.deepEqual([out.sent, out.left, out.refused], [0, 2, 0], `go ${i + 1}: still in order behind it`);
  }
  out = await client.flush(token);
  assert.deepEqual([out.sent, out.left, out.refused], [1, 0, 1], "the sixth go steps over it");
  assert.equal((await booked(org)).length, 1);
  assert.equal(client.refusedSales()[0].error.error, "server");

  onWire = null;
  assert.equal(client.retryRefused(), 1);
  assert.equal(client.queued()[0].tries, undefined, "a fresh start, not one go from being set aside again");
  await client.flush(token);
  assert.equal((await booked(org)).length, 2);
  assert.equal(client.refusedSales().length, 0);
});

await test("a sale rung up while the queue is being sent is still in it afterwards", async () => {
  const { org, token, catalogue } = await shop({ shifts: false });
  await offlineSale(token, catalogue);
  let during = 0;
  onWire = async ({ what, method }) => {
    if (method === "POST" && what === "sale" && during === 0) {
      during += 1;
      /* The connection drops again mid-send, and somebody sells. */
      net = "down";
      await client.sell(token, order(catalogue), catalogue).catch(() => null);
      net = "up";
      /* …and the timer fires a second pass at the same moment. */
      client.flush(token);
    }
    return null;
  };
  const first = client.queued()[0].body.clientId;
  const out = await client.flush(token);
  assert.deepEqual([out.sent, out.left], [1, 1]);
  assert.equal(client.queued().length, 1, "not written over by what the pass thought was left");
  assert.equal(sentBodies.filter((b) => b.clientId === first).length, 1, "a second pass asked for mid-send is the same pass, not another");
  onWire = null;
  await client.flush(token);
  assert.equal((await booked(org)).length, 2);
});

await test("a sign-in that has run out keeps everything waiting, in order", async () => {
  const { token, catalogue } = await shop({ shifts: false });
  await offlineSale(token, catalogue);
  await offlineSale(token, catalogue);
  const out = await client.flush("not-a-session");
  assert.deepEqual([out.sent, out.left, out.refused], [0, 2, 0]);
  assert.equal((await client.flush(token)).sent, 2);
});

/* ── Signing in at the till with no connection ── */

await test("a cashier who has used this till can sign in to it offline with their PIN; nobody else can", async () => {
  const { org, token } = await shop({ shifts: false });
  const sara = await addEmployee(org.id, { name: "Sara", title: "Cashier", branchId: "register" });
  await client.call(token, "pins", { method: "PUT", body: { employeeId: sara.employee?.id || sara.id, pin: "1234", role: "cashier" } });
  const pin = await client.call(token, "pin", { method: "POST", body: { pin: "1234" } });
  assert.equal(await client.offlinePin("1234"), null, "never signed in here: nothing to go on");
  await client.rememberPin("1234", pin.operator, pin.token);

  net = "down";
  const hit = await client.offlinePin("1234");
  assert.equal(hit.operator.name, "Sara");
  assert.equal(await client.offlinePin("4321"), null);
  assert.equal([...disk.values()].some((v) => v.includes("1234")), false, "the PIN itself is not on the device");

  /* Two weeks on, the device no longer vouches for her. */
  const real = Date.now;
  Date.now = () => real() + 15 * 864e5;
  try { assert.equal(await client.offlinePin("1234"), null); } finally { Date.now = real; }
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
