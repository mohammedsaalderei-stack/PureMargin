/* Sales and delivery channels (`shared/channelmath.js`, `_channels.js`,
   `api/channels.js`, and the register's sale path).

   The acceptance criteria of the requirements document, each as a test:
     1  create a channel and configure its fees
     2  several dated rules for one channel
     3  a recommended price for an item with a recipe
     4  only the discount the restaurant funds counts
     5  sales tax is kept out of profit
     6  each order keeps a snapshot of the fee rule
     7  the same dish makes a different profit on each channel
     8  a fee changed later does not move an old report
     9  an alert when a margin falls below the threshold
     10 a rule for one branch
     11 the business's own VAT settings
     12 the calculation can be explained, figure by figure */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const m = await import("../shared/channelmath.js");
const ch = await import("./_channels.js");
const { createAccount, getAccount } = await import("./_accounts.js");
const { issueToken } = await import("./_auth.js");
const { orgFor, setBranchAllowance, setMember } = await import("./_org.js");
const { getJSON, setJSON } = await import("./_store.js");
const { saveVersion } = await import("./_recipes.js");
const { saveStore } = await import("./_stores.js");
const till = (await import("./till.js")).default;
const route = (await import("./channels.js")).default;

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}
const near = (a, b, tol = 0.006, why = "") => {
  const [limit, note] = typeof tol === "string" ? [0.006, tol] : [tol, why];
  assert.ok(Math.abs(a - b) < limit, `${note ? `${note}: ` : ""}expected ${b}, got ${a}`);
};

/* ── The arithmetic ── */

await test("the document's example: 50 at 30% leaves 20, and 71.43 keeps 35", async () => {
  const rule = { commissionPct: 30 };
  const e = m.itemEconomics({ price: 50, recipeCost: 15, rule });
  near(e.commission, 15);
  near(e.netRevenue, 35);
  near(e.contribution, 20);
  near(m.priceFor({ target: 35, recipeCost: 15, rule }), 71.43);
  near(m.itemEconomics({ price: 71.43, recipeCost: 15, rule }).contribution, 35);
  /* The comparison table's own-delivery row: 8 of delivery cost leaves 27. */
  near(m.itemEconomics({ price: 50, recipeCost: 15, rule: { deliveryCostPerOrder: 8 } }).contribution, 27);
});

await test("a rounded price shows its own effect, and a status", async () => {
  const rule = { commissionPct: 30 };
  const at = (price) => m.compareItem({ price, inStorePrice: 50, recipeCost: 15, rule, inStoreRule: {}, minMarginPct: 15 });
  assert.equal(at(72).status, "green");
  assert.equal(at(70).status, "orange", "profitable, a little under the target");
  near(at(70).contribution, 34);
  assert.equal(at(20).status, "red", "a loss");
  assert.equal(at(24).status, "red", "a profit, but under the margin the business will accept");
  near(at(50).breakEven, 21.43);
});

await test("sales tax is never profit, whichever way prices are written (5, 11)", async () => {
  const rule = { commissionPct: 30 };
  const added = m.itemEconomics({ price: 50, recipeCost: 15, rule, vatPct: 5, vatMode: "exclusive" });
  near(added.subtotal, 50);
  near(added.tax, 2.5);
  near(added.contribution, 20, "VAT added on top changes nothing the restaurant keeps");
  const included = m.itemEconomics({ price: 52.5, recipeCost: 15, rule, vatPct: 5, vatMode: "inclusive" });
  near(included.subtotal, 50);
  near(included.contribution, 20, "the same dish, VAT inside the price");
  /* A platform that takes its cut of the VAT-inclusive total takes more. */
  near(m.itemEconomics({ price: 50, recipeCost: 15, rule: { commissionPct: 30, commissionBase: "subtotal_plus_tax" }, vatPct: 5 }).commission, 15.75);
  /* And a different country's rate is just a different rate. */
  near(m.itemEconomics({ price: 115, recipeCost: 15, rule, vatPct: 15, vatMode: "inclusive" }).subtotal, 100);
});

await test("every kind of fee is counted once", async () => {
  const rule = {
    commissionPct: 20, paymentFeePct: 2, paymentFeeBase: "subtotal_plus_tax", fixedOrderFee: 1, fixedItemFee: 0.5,
    advertisingModel: "percent", advertisingPct: 5, deliveryCostPerOrder: 4, vatOnPlatformFeePct: 5,
  };
  const e = m.itemEconomics({ price: 100, recipeCost: 30, rule, vatPct: 5 });
  near(e.commission, 20);
  near(e.paymentFee, 2.1);
  near(e.advertising, 5);
  near(e.fixedFees, 1.5);
  near(e.vatOnFees, (20 + 2.1 + 5 + 1.5) * 0.05);
  near(e.deliveryCost, 4);
  near(e.channelFees, 20 + 2.1 + 5 + 1.5 + 1.43 + 4);
  near(e.contribution, 100 - e.channelFees - 30);
  /* A monthly advertising bill, over the orders it buys. */
  near(m.itemEconomics({ price: 100, recipeCost: 30, rule: { advertisingModel: "monthly_fixed", advertisingMonthly: 600, expectedMonthlyOrders: 300 } }).advertising, 2);
  /* Charges that fall once per order are shared in a bigger basket. */
  near(m.itemEconomics({ price: 100, recipeCost: 30, rule: { deliveryCostPerOrder: 8 }, itemsPerOrder: 4 }).deliveryCost, 2);
});

await test("only the restaurant's own discount counts, and it is counted once (4)", async () => {
  const rule = { commissionPct: 30, discountModel: "percent", merchantDiscountPct: 20 };
  const e = m.itemEconomics({ price: 50, recipeCost: 15, rule });
  near(e.merchantDiscount, 10);
  near(e.subtotal, 40, "the sale is what the customer paid");
  near(e.commission, 12, "commission on what was actually sold");
  near(e.contribution, 40 - 12 - 15);
  near(e.channelCost, 22, "the discount is part of what the channel cost");
  /* A discount the platform pays for is simply not entered: nothing changes. */
  near(m.itemEconomics({ price: 50, recipeCost: 15, rule, applyDiscount: false }).contribution, 20);
  /* The recommended price covers the discount as well. */
  const p = m.priceFor({ target: 35, recipeCost: 15, rule });
  near(m.itemEconomics({ price: p, recipeCost: 15, rule }).contribution, 35, 0.02);
});

await test("carrying part of the commission lowers the price by exactly that part", async () => {
  const rule = { commissionPct: 30 };
  const full = m.priceFor({ target: 35, recipeCost: 15, rule });
  const half = m.priceFor({ target: 35, recipeCost: 15, rule, absorbPct: 50 });
  assert.ok(half < full);
  const e = m.itemEconomics({ price: half, recipeCost: 15, rule });
  near(35 - e.contribution, e.commission / 2, 0.02);
});

await test("a price that cannot exist is null, not a number", async () => {
  assert.equal(m.priceFor({ target: 35, recipeCost: null, rule: {} }), null, "no recipe cost, no recommendation");
  assert.equal(m.readRule({ commissionPct: 70, paymentFeePct: 30 }).error, "commissionPct", "fees that take the whole sale are refused");
  assert.equal(m.readRule({ commissionPct: -1 }).error, "commissionPct");
  assert.equal(m.readRule({ advertisingModel: "monthly_fixed", advertisingMonthly: 500 }).error, "expectedMonthlyOrders");
  assert.equal(m.readRule({ validFrom: "2026-13-40x" }).error, "validFrom");
});

await test("the calculation can be shown figure by figure (12)", async () => {
  const e = m.itemEconomics({ price: 50, recipeCost: 15, rule: { commissionPct: 30, paymentFeePct: 2 }, vatPct: 5 });
  for (const k of ["listed", "tax", "subtotal", "merchantDiscount", "commissionBase", "commission", "paymentBase", "paymentFee",
    "advertising", "fixedFees", "vatOnFees", "deliveryCost", "channelFees", "netRevenue", "recipeCost", "contribution", "marginPct"]) {
    assert.equal(typeof e[k], "number", k);
  }
  near(e.subtotal - e.channelFees - e.recipeCost, e.contribution);
});

/* ── Channels and rules ── */

await test("a channel is created and its fees set; the counter is always there (1)", async () => {
  assert.deepEqual((await ch.listChannels("org1")).map((c) => c.id), ["in-store"]);
  const made = await ch.saveChannel("org1", { preset: "talabat" });
  assert.equal(made.channel.id, "c-talabat");
  assert.equal(made.channel.name, "Talabat");
  assert.equal(made.channel.type, "aggregator");
  assert.equal((await ch.saveChannel("org1", { name: "talabat" })).error, "duplicate");
  const rule = await ch.addRule("org1", "c-talabat", { commissionPct: 30, validFrom: "2026-01-01" }, { by: "owner" });
  assert.equal(rule.rule.commissionPct, 30);
  assert.equal((await ch.addRule("org1", "c-nowhere", { commissionPct: 30 })).error, "notfound");
  assert.equal((await ch.saveChannel("org1", { id: "in-store", active: false })).channel.active, true, "the counter cannot be switched off");
});

await test("rules are dated, kept, and the right one answers for each day (2, 10)", async () => {
  await ch.saveChannel("org1", { preset: "talabat" });
  await ch.addRule("org1", "c-talabat", { commissionPct: 25, validFrom: "2026-01-01" }, { now: 1 });
  await ch.addRule("org1", "c-talabat", { commissionPct: 30, validFrom: "2026-06-01" }, { now: 2 });
  await ch.addRule("org1", "c-talabat", { commissionPct: 22, validFrom: "2026-03-01", branchId: "s-marina" }, { now: 3 });
  const rules = (await ch.listChannels("org1")).find((c) => c.id === "c-talabat").rules;
  assert.equal(rules.length, 3, "nothing was overwritten");
  assert.equal(m.ruleAt(rules, "2026-05-31").commissionPct, 25);
  assert.equal(m.ruleAt(rules, "2026-06-01").commissionPct, 30);
  assert.equal(m.ruleAt(rules, "2025-12-31"), null, "before the first rule there is none");
  assert.equal(m.ruleAt(rules, "2026-07-01", "s-marina").commissionPct, 22, "a branch's own contract outranks the general one");
  assert.equal(m.ruleAt(rules, "2026-07-01", "register").commissionPct, 30);
  /* A typo is corrected by a newer rule from the same day; both stay on file. */
  await ch.addRule("org1", "c-talabat", { commissionPct: 28, validFrom: "2026-06-01" }, { now: 4 });
  const after = (await ch.listChannels("org1")).find((c) => c.id === "c-talabat").rules;
  assert.equal(after.length, 4);
  assert.equal(m.ruleAt(after, "2026-06-15").commissionPct, 28);
  /* A rule with an end hands back to the one before it. */
  await ch.addRule("org1", "c-talabat", { commissionPct: 15, validFrom: "2026-08-01", validTo: "2026-08-31" }, { now: 5 });
  const promo = (await ch.listChannels("org1")).find((c) => c.id === "c-talabat").rules;
  assert.equal(m.ruleAt(promo, "2026-08-15").commissionPct, 15);
  assert.equal(m.ruleAt(promo, "2026-09-01").commissionPct, 28);
});

await test("channel prices are set, cleared, copied and keep their history", async () => {
  await ch.saveChannel("org1", { preset: "talabat" });
  await ch.saveChannel("org1", { preset: "deliveroo" });
  await ch.setPrices("org1", "c-talabat", [{ itemKey: "wrap", price: 71.43, recommended: true }, { itemKey: "fries::v-large", price: 16 }], { now: 10 });
  assert.deepEqual((await ch.pricesFor("org1")).byChannel["c-talabat"], { wrap: 71.43, "fries::v-large": 16 });
  assert.equal((await ch.setPrices("org1", "c-talabat", [{ itemKey: "wrap", price: -1 }])).error, "price");
  assert.equal((await ch.copyPrices("org1", "c-talabat", "c-deliveroo", { now: 11 })).changed, 2);
  assert.equal((await ch.copyPrices("org1", "c-talabat", "c-talabat")).error, "same");
  await ch.setPrices("org1", "c-talabat", [{ itemKey: "wrap", price: null }], { now: 12 });
  const { doc, byChannel } = await ch.pricesFor("org1");
  assert.deepEqual(byChannel["c-talabat"], { "fries::v-large": 16 });
  assert.equal(doc["c-talabat"].wrap.length, 2, "taking a price off is recorded, not erased");
  assert.equal(byChannel["c-deliveroo"].wrap, 71.43);
});

/* ── Through the register and the report ── */

const NOW = Date.now();
function fakeRes() {
  const r = { code: 0, body: null, setHeader() { return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  return r;
}
async function shop() {
  await createAccount({ username: "owner1", password: "Till-test-9x!" });
  const account = await getAccount("owner1");
  const org = await orgFor(account);
  await saveVersion(org.id, { id: "wrap", menuItem: "Wrap", sellPrice: 50, lines: [{ name: "Chicken", qty: 100, unit: "g", estimatedCost: 0.15 }] });
  const token = issueToken("owner1", account.tokenVersion || 0);
  const call = async (handler, method, what, body, query = {}) => {
    const res = fakeRes();
    await handler({ method, url: `/api/x?what=${what}`, headers: { authorization: `Bearer ${token}` }, query: { what, ...query }, body }, res);
    return res;
  };
  await call(till, "PUT", "settings", { section: "options", value: { useShifts: false } });
  await call(till, "PUT", "vat", { vatPct: 0 });
  return { org, call };
}
const order = (over = {}) => ({ branchId: "register", orderType: "delivery", lines: [{ itemId: "wrap", qty: 1 }], payments: [{ type: "card" }], ...over });

await test("an order keeps its channel, its price there, and a snapshot of the rule (6, 7)", async () => {
  const { call } = await shop();
  assert.equal((await call(route, "POST", "channel", { preset: "talabat" })).code, 201);
  assert.equal((await call(route, "POST", "rule", { channelId: "c-talabat", commissionPct: 30, validFrom: "2026-01-01" })).code, 201);

  const counter = (await call(till, "POST", "sale", order({ orderType: "takeaway" }))).body.receipt;
  assert.equal(counter.channel_id, "in-store");
  near(counter.channel_economics.contribution_profit, 35);

  const talabat = (await call(till, "POST", "sale", order({ channelId: "c-talabat" }))).body.receipt;
  assert.equal(talabat.channel_id, "c-talabat");
  assert.equal(talabat.channel_name, "Talabat");
  assert.equal(talabat.channel_fee_rule.commissionPct, 30);
  near(talabat.channel_economics.commission_amount, 15);
  near(talabat.channel_economics.recipe_cost, 15);
  near(talabat.channel_economics.contribution_profit, 20, "the same dish, a different profit");

  /* Listed at its own price on the channel, the customer there pays that. */
  await call(route, "PUT", "prices", { channelId: "c-talabat", prices: [{ itemKey: "wrap", price: 71.43 }] });
  const dearer = (await call(till, "POST", "sale", order({ channelId: "c-talabat" }))).body.receipt;
  near(dearer.total_money, 71.43);
  near(dearer.channel_economics.contribution_profit, 35);
  near((await call(till, "POST", "sale", order({ orderType: "takeaway" }))).body.receipt.total_money, 50, "the counter still charges 50");

  assert.equal((await call(till, "POST", "sale", order({ channelId: "c-nowhere" }))).code, 422);
  await call(route, "POST", "channel", { id: "c-talabat", active: false });
  assert.equal((await call(till, "POST", "sale", order({ channelId: "c-talabat" }))).body.error, "channel", "a channel switched off takes no orders");
});

await test("a fee changed later moves nothing already sold (8)", async () => {
  const { call } = await shop();
  await call(route, "POST", "channel", { preset: "talabat" });
  await call(route, "POST", "rule", { channelId: "c-talabat", commissionPct: 25, validFrom: "2026-01-01" });
  await call(till, "POST", "sale", order({ channelId: "c-talabat" }));
  const before = (await call(route, "GET", "", undefined)).body.report.rows.find((r) => r.channelId === "c-talabat");
  near(before.contribution, 50 - 12.5 - 15);

  await call(route, "POST", "rule", { channelId: "c-talabat", commissionPct: 30, validFrom: "2026-01-01" });
  const after = (await call(route, "GET", "", undefined)).body.report.rows.find((r) => r.channelId === "c-talabat");
  near(after.contribution, before.contribution, 0.001);
  near(after.channelCost, 12.5);
  /* And the next order is costed under the new rule. */
  near((await call(till, "POST", "sale", order({ channelId: "c-talabat" }))).body.receipt.channel_economics.commission_amount, 15);
});

await test("the report says what each channel sold, kept and cost", async () => {
  const { call } = await shop();
  await call(route, "POST", "channel", { preset: "talabat" });
  await call(route, "POST", "rule", { channelId: "c-talabat", commissionPct: 30, validFrom: "2026-01-01" });
  await call(till, "POST", "sale", order({ orderType: "takeaway" }));
  await call(till, "POST", "sale", order({ channelId: "c-talabat", lines: [{ itemId: "wrap", qty: 3 }] }));
  const report = (await call(route, "GET", "", undefined)).body.report;
  const t = report.rows.find((r) => r.channelId === "c-talabat");
  const c = report.rows.find((r) => r.channelId === "in-store");
  near(t.sales, 150);
  near(t.contribution, 60);
  near(t.avgProfitPerOrder, 60);
  near(t.costPct, 30);
  near(c.contribution, 35);
  assert.equal(report.mostSales, "c-talabat");
  assert.equal(report.mostProfit, "c-talabat");
  assert.equal(report.leastProfitable, "c-talabat", "most money, thinnest margin");
  assert.equal(t.topItems[0].name, "Wrap");
});

await test("alerts: below the counter's profit, below the minimum, a discount, fees changed, fees stale (9)", async () => {
  const rows = [{ key: "wrap", name: "Wrap", variant: "", price: 50, cost: 15 }, { key: "soup", name: "Soup", variant: "", price: 20, cost: 12 }];
  const base = { id: "c-t", name: "Talabat", active: true };
  const counter = { id: "in-store", name: "In-store", active: true, rules: [{ validFrom: "2000-01-01", createdAt: 1 }] };
  const run = (rules, extra = {}) => ch.channelAlerts({
    channels: [counter, { ...base, rules }], prices: {}, rows, vatPct: 0, vatMode: "exclusive", settings: { minMarginPct: 15 }, now: NOW, ...extra,
  }).alerts;

  const a = run([{ validFrom: "2026-01-01", commissionPct: 30, createdAt: NOW }]);
  const wrap = a.find((x) => x.kind === "belowInStore" && x.itemKey === "wrap");
  near(wrap.values.inStore, 35);
  near(wrap.values.here, 20);
  near(wrap.values.recommended, 71.43);
  const soup = a.find((x) => x.kind === "belowMinimum" && x.itemKey === "soup");
  assert.ok(soup, "20 less 30% less 12 leaves 2: a 10% margin, under the 15% floor");
  near(soup.values.marginPct, 10);

  const d = run([{ validFrom: "2026-01-01", commissionPct: 10, discountModel: "percent", merchantDiscountPct: 25, createdAt: NOW }]);
  assert.ok(d.some((x) => x.kind === "discountMargin" && x.itemKey === "soup"), "fine without the discount, under the floor with it");

  const changed = run([{ validFrom: "2026-01-01", commissionPct: 25, createdAt: NOW - 5000 }, { validFrom: "2026-06-01", commissionPct: 30, createdAt: NOW - 1000 }]);
  assert.ok(changed.some((x) => x.kind === "feesChanged"));
  const repriced = run([{ validFrom: "2026-01-01", commissionPct: 25, createdAt: NOW - 5000 }, { validFrom: "2026-06-01", commissionPct: 30, createdAt: NOW - 1000 }],
    { pricesDoc: { "c-t": { wrap: [{ price: 71, at: NOW - 10 }] } }, prices: { "c-t": { wrap: 71 } } });
  assert.ok(!repriced.some((x) => x.kind === "feesChanged"), "prices looked at since the change");

  const stale = run([{ validFrom: "2026-01-01", commissionPct: 30, createdAt: NOW - 100 * 864e5 }]);
  assert.equal(stale.find((x) => x.kind === "feesStale").values.days, 100);
  assert.ok(run([]).some((x) => x.kind === "noFees"));
});

await test("a branch's own rule is what its orders are costed under (10)", async () => {
  const { org, call } = await shop();
  await setBranchAllowance(org.id, null);
  await saveStore(org.id, { name: "Marina" });
  await call(route, "POST", "channel", { preset: "talabat" });
  await call(route, "POST", "rule", { channelId: "c-talabat", commissionPct: 30, validFrom: "2026-01-01" });
  await call(route, "POST", "rule", { channelId: "c-talabat", commissionPct: 20, validFrom: "2026-01-01", branchId: "s-marina" });
  const marina = (await call(till, "POST", "sale", order({ channelId: "c-talabat", branchId: "s-marina" }))).body.receipt;
  near(marina.channel_economics.commission_amount, 10);
  const main = (await call(till, "POST", "sale", order({ channelId: "c-talabat" }))).body.receipt;
  near(main.channel_economics.commission_amount, 15);
  assert.equal((await call(route, "POST", "rule", { channelId: "c-talabat", commissionPct: 20, branchId: "s-someone-elses" })).code, 403);
});

await test("the route is closed to those who may not see profit, and writes need more", async () => {
  const { call } = await shop();
  const out = (await call(route, "GET", "", undefined)).body;
  assert.equal(out.can.manage, true);
  assert.deepEqual(out.items.map((i) => [i.key, i.price, i.cost]), [["wrap", 50, 15]]);
  assert.equal(out.settings.minMarginPct, ch.DEFAULT_MIN_MARGIN_PCT);
  assert.equal((await call(route, "PUT", "settings", { minMarginPct: 20 })).body.settings.minMarginPct, 20);
  assert.equal((await call(route, "PUT", "settings", { minMarginPct: 120 })).code, 422);

  await createAccount({ username: "cashier1", password: "Till-test-9x!" });
  const org = await orgFor(await getAccount("owner1"));
  await setMember(org.id, "cashier1", { role: "cashier", branches: ["register"] });
  await setJSON("acct:cashier1", { ...(await getJSON("acct:cashier1")), orgId: org.id });
  const cashier = await getAccount("cashier1");
  const res = fakeRes();
  await route({ method: "GET", url: "/api/channels", headers: { authorization: `Bearer ${issueToken("cashier1", cashier.tokenVersion || 0)}` }, query: {} }, res);
  assert.equal(res.code, 403);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
