/* The overview's figures (`_aggregate.js`).

   What this protects: a period with nothing before it is no comparison, not
   "0.0%"; days and hours are the business's own, not the server's; and the
   cost of what sold comes from the recipes, the variant drawn and the cost a
   product carries — so a margin is not 100% because the costs were never
   looked up. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const { aggregate } = await import("./_aggregate.js");
const { menuCosts, saveVersion } = await import("./_recipes.js");

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

const NOW = Date.parse("2026-11-09T08:00:00Z"); // noon in Dubai
const DAY = 864e5;
const sale = (iso, total, lines = [{ item_name: "Fries", quantity: 1, total_money: total }]) => ({
  receipt_number: `R-${iso}`, receipt_type: "SALE", receipt_date: iso, store_id: "register",
  total_money: total, line_items: lines, payments: [{ name: "Cash", money_amount: total }],
});
const run = (receipts, { catalogue = new Map(), overrides = {}, timeZone } = {}) => aggregate(
  { receipts, limitedHistory: false, catalogue, storeNames: { register: "Main" }, now: NOW },
  { overrides, timeZone },
);

await test("nothing sold before is no comparison, not 0.0%", async () => {
  const m = run([sale(new Date(NOW - DAY / 2).toISOString(), 50)]);
  assert.equal(m.totals.salesDelta, null);
  assert.equal(m.totals.receiptsDelta, null);
  assert.equal(m.today.delta, null, "nothing yesterday either");
  const withPrior = run([sale(new Date(NOW - 40 * DAY).toISOString(), 40), sale(new Date(NOW - DAY / 2).toISOString(), 50)]);
  assert.equal(withPrior.totals.salesDelta, 25);
});

await test("a sale after midnight in Dubai is today's, at its own hour", async () => {
  /* 22:30 UTC on the 8th is 02:30 on the 9th in Dubai. */
  const m = run([sale("2026-11-08T22:30:00Z", 30)]);
  assert.equal(m.daily.at(-1).date, "2026-11-09");
  assert.equal(m.daily.at(-1).sales, 30, "counted today, not yesterday");
  assert.equal(m.today.sales, 30);
  assert.equal(m.hours.find((h) => h.receipts > 0).hour, 2);
  const utc = run([sale("2026-11-08T22:30:00Z", 30)], { timeZone: "UTC" });
  assert.equal(utc.daily.at(-2).sales, 30, "the same sale is the 8th in UTC");
});

await test("an unknown zone falls back to Dubai rather than failing", async () => {
  const m = run([sale("2026-11-08T22:30:00Z", 30)], { timeZone: "Mars/Olympus" });
  assert.equal(m.today.sales, 30);
});

await test("what sold is costed from recipes, variants, products and add-ons", async () => {
  const catalogue = new Map([["Fries", { cost: 2 }], ["Latte||Large", { cost: 5 }], ["Latte", { cost: 3 }]]);
  const m = run([sale(new Date(NOW - 3600e3).toISOString(), 100, [
    { item_name: "Fries", quantity: 2, total_money: 18 },                                  // 2 × 2
    { item_name: "Fries", variant_name: "Large", variant_scale: 1.5, quantity: 2, total_money: 24 }, // 2 × 2 × 1.5
    { item_name: "Latte", variant_name: "Large", quantity: 1, total_money: 18 },            // own recipe: 5
    { item_name: "Soda", quantity: 3, total_money: 12, cost: 4.5 },                         // product line: 4.5
    { item_name: "Latte", quantity: 1, total_money: 14, addon_cost: 1 },                    // 3 + 1
    { item_name: "Mystery", quantity: 1, total_money: 14 },                                 // unknown
  ])], { catalogue });
  /* 4 + 6 + 5 + 4.5 + 4 */
  assert.equal(m.totals.cost, 23.5);
  assert.equal(m.items.find((i) => i.name === "Fries").cost, 10);
  assert.ok(m.costCoverage < 100, "an uncosted dish keeps coverage below 100%");
  assert.ok(m.missingCosts.some((i) => i.name === "Mystery"));
});

await test("a cost typed by the owner still wins", async () => {
  const catalogue = new Map([["Fries", { cost: 2 }]]);
  const m = run([sale(new Date(NOW - 3600e3).toISOString(), 18, [{ item_name: "Fries", quantity: 2, total_money: 18 }])], { catalogue, overrides: { Fries: 3 } });
  assert.equal(m.totals.cost, 6);
});

await test("menu costs leave out a dish whose cost is unknown, never 0", async () => {
  await saveVersion("org1", { id: "fries", menuItem: "Fries", sellPrice: 9, lines: [{ name: "Potato", qty: 200, unit: "g", estimatedCost: 0.01 }] });
  await saveVersion("org1", { id: "mystery", menuItem: "Mystery", sellPrice: 9, lines: [{ name: "Secret", qty: 1, unit: "g" }] });
  await saveVersion("org1", { id: "latte-large", menuItem: "Latte", variant: "Large", sellPrice: 18, lines: [{ name: "Milk", qty: 300, unit: "ml", estimatedCost: 0.01 }] });
  const costs = await menuCosts("org1", ["register"]);
  assert.ok(costs.get("Fries")?.cost > 0, "estimated cost counts until an invoice prices it");
  assert.equal(costs.has("Mystery"), false);
  assert.ok(costs.get("Latte||Large")?.cost > 0);
  assert.equal(costs.has("Latte"), false, "a variant's recipe is not the plain dish's");
});

const { pureScore } = await import("./_margin.js");
const vatSale = (iso, lines, { mode = "exclusive", pct = 5 } = {}) => {
  const lineTotal = lines.reduce((a, l) => a + l.total_money, 0);
  const tax = mode === "exclusive" ? lineTotal * pct / 100 : lineTotal - lineTotal / (1 + pct / 100);
  const total = mode === "exclusive" ? lineTotal + tax : lineTotal;
  return { receipt_number: `V-${iso}`, receipt_type: "SALE", receipt_date: iso, store_id: "register", vat_mode: mode, vat_pct: pct,
    total_money: total, total_tax: tax, line_items: lines, payments: [{ name: "Card", money_amount: total }] };
};
const hourAgo = new Date(NOW - 3600e3).toISOString();

await test("VAT collected is not profit", async () => {
  const catalogue = new Map([["Fries", { cost: 4 }]]);
  const m = run([vatSale(hourAgo, [{ item_name: "Fries", quantity: 10, total_money: 100 }])], { catalogue });
  assert.equal(m.totals.sales, 105, "sales stay what the customers paid");
  assert.equal(m.totals.tax, 5);
  assert.equal(m.totals.salesExVat, 100);
  assert.equal(m.totals.grossProfit, 60, "100 without VAT less 40 of food, not 105 less 40");
  assert.equal(m.totals.marginPct, 60);
  assert.equal(m.items[0].marginPct, 60);
});

await test("VAT included in prices is taken out of a dish's takings", async () => {
  const catalogue = new Map([["Fries", { cost: 4 }]]);
  const m = run([vatSale(hourAgo, [{ item_name: "Fries", quantity: 10, total_money: 105 }], { mode: "inclusive" })], { catalogue });
  assert.equal(m.items[0].netRevenue, 100);
  assert.equal(m.totals.grossProfit, 60);
});

await test("a fully costed menu reads 100% costed, VAT or not", async () => {
  const catalogue = new Map([["Fries", { cost: 4 }]]);
  assert.equal(run([vatSale(hourAgo, [{ item_name: "Fries", quantity: 1, total_money: 10 }])], { catalogue }).costCoverage, 100);
});

await test("an uncosted dish is neither free nor 100% margin, and the score leaves it out", async () => {
  const catalogue = new Map([["Fries", { cost: 7 }]]);
  const m = run([vatSale(hourAgo, [{ item_name: "Fries", quantity: 10, total_money: 100 }, { item_name: "Mystery", quantity: 10, total_money: 100 }])], { catalogue });
  assert.equal(m.costCoverage, 50);
  assert.equal(m.totals.marginPct, 65, "the headline still counts the mystery dish as free");
  assert.equal(m.totals.costedMarginPct, 30, "the costed margin does not");
  assert.equal(m.items.find((i) => i.name === "Mystery").marginPct, null);
  const score = pureScore(m);
  assert.equal(score.margin, 30, "purity is scored on the costed margin");
});

await test("purity says it can't score a menu with almost no costs", async () => {
  const m = run([vatSale(hourAgo, [{ item_name: "Mystery", quantity: 10, total_money: 100 }])]);
  assert.equal(pureScore(m).value, null);
  assert.equal(pureScore(m).state, "nocost");
});

await test("a refund gives back its VAT as well as the sale", async () => {
  const catalogue = new Map([["Fries", { cost: 4 }]]);
  const refund = { ...vatSale(hourAgo, [{ item_name: "Fries", quantity: 1, total_money: 10 }]), receipt_type: "REFUND", receipt_number: "RF-1" };
  const m = run([vatSale(hourAgo, [{ item_name: "Fries", quantity: 10, total_money: 100 }]), refund], { catalogue });
  /* 105 sold, 10.50 given back: 94.50 taken, 4.50 of it VAT, 90 kept. */
  assert.equal(m.totals.salesExVat, 90);
  assert.equal(m.totals.grossProfit, 90 - 40, "the refunded fries were still eaten");
});

await test("the dashboard's net profit is worked without VAT and knows how much is costed", async () => {
  const { createAccount, getAccount } = await import("./_accounts.js");
  const { issueToken } = await import("./_auth.js");
  const { orgFor } = await import("./_org.js");
  const till = (await import("./till.js")).default;
  const metrics = (await import("./metrics.js")).default;
  await createAccount({ username: "owner1", password: "Till-test-9x!" });
  const account = await getAccount("owner1");
  const org = await orgFor(account);
  await saveVersion(org.id, { id: "fries", menuItem: "Fries", sellPrice: 10, lines: [{ name: "Potato", qty: 100, unit: "g", estimatedCost: 0.04 }] });
  await saveVersion(org.id, { id: "mystery", menuItem: "Mystery", sellPrice: 10, lines: [{ name: "Secret", qty: 1, unit: "g" }] });
  const token = issueToken("owner1", account.tokenVersion || 0);
  const call = async (route, method, url, query, body) => {
    const r = { code: 0, body: null, setHeader() { return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
    await route({ method, url, headers: { authorization: `Bearer ${token}` }, query, body }, r);
    return r;
  };
  await call(till, "POST", "/api/till?what=shift-open", { what: "shift-open" }, { branchId: "register", float: 0 });
  const sold = await call(till, "POST", "/api/till?what=sale", { what: "sale" }, {
    branchId: "register", orderType: "takeaway", payments: [{ type: "card" }],
    lines: [{ itemId: "fries", qty: 1 }, { itemId: "mystery", qty: 1 }],
  });
  assert.equal(sold.code, 201, JSON.stringify(sold.body));
  const out = (await call(metrics, "GET", "/api/metrics", {}, undefined)).body;
  assert.equal(out.totals.sales, 21, "two dishes at 10, plus 5% VAT");
  assert.equal(out.totals.salesExVat, 20);
  assert.equal(out.costCoverage, 50);
  assert.equal(out.profit.netSales, 20);
  assert.equal(out.profit.costCoverage, 0.5, "a share, so the screen can say the figure is an upper bound");
});

await test("the days add up to the total, to the fil, over the same 30 days", async () => {
  /* Three sales of 10.40: rounding each day first made the days sum to 30,
     not 31.20. And a sale 30 days and some hours ago is in neither, since the
     period is today and the 29 days before it — exactly the days drawn. */
  const m = run([
    sale(new Date(NOW - 3600e3).toISOString(), 10.4),
    sale(new Date(NOW - 2 * DAY).toISOString(), 10.4),
    sale(new Date(NOW - 29 * DAY).toISOString(), 10.4),
    sale(new Date(NOW - 30 * DAY - 6 * 3600e3).toISOString(), 99),
  ]);
  const days = m.daily.reduce((a, d) => a + d.sales, 0);
  assert.equal(Math.round(days * 100) / 100, 31.2);
  assert.equal(m.totals.sales, 31.2);
  assert.equal(m.totals.salesDelta, -68.5, "the 99 is the period before, compared like for like");
});

await test("a longer period has its own totals, comparison and grouped chart", async () => {
  const { bucketSeries } = await import("./_data.js");
  const receipts = [
    sale(new Date(NOW - 3600e3).toISOString(), 20),
    sale(new Date(NOW - 200 * DAY).toISOString(), 30),
    sale(new Date(NOW - 500 * DAY).toISOString(), 25),
  ];
  const year = aggregate({ receipts, limitedHistory: false, catalogue: new Map(), storeNames: {}, now: NOW }, { periodDays: 365 });
  assert.equal(year.daily.length, 365);
  assert.equal(year.totals.sales, 50);
  assert.equal(year.totals.salesDelta, 100, "50 this year against 25 the year before");
  const { bucket, series } = bucketSeries(year.daily);
  assert.equal(bucket, "week");
  assert.ok(series.length >= 52 && series.length <= 53);
  assert.equal(series.reduce((a, d) => a + d.sales, 0), 50);
  assert.equal(bucketSeries(year.daily.slice(-90)).bucket, "day");
  assert.equal(bucketSeries(new Array(700).fill(0).map((_, i) => ({ date: new Date(NOW - (699 - i) * DAY).toISOString().slice(0, 10), sales: 1, receipts: 1 }))).bucket, "month");
});

await test("each day carries its own cost, and the days add up to the period's gross profit", async () => {
  /* Today: 10 fries (cost 4 each) and 2 of a dish nobody has costed, VAT on
     top, then one fries refunded. Six days ago: 5 fries with the VAT inside
     the price. Worked on paper: today 110 without VAT less 40 = 70; six days
     ago 50 less 20 = 30; the period 100. */
  const catalogue = new Map([["Fries", { cost: 4 }]]);
  const sixDaysAgo = new Date(NOW - 6 * DAY).toISOString();
  const refund = { ...vatSale(hourAgo, [{ item_name: "Fries", quantity: 1, total_money: 10 }]), receipt_type: "REFUND", receipt_number: "RF-DAY" };
  const m = run([
    vatSale(hourAgo, [{ item_name: "Fries", quantity: 10, total_money: 100 }, { item_name: "Mystery", quantity: 2, total_money: 20 }]),
    vatSale(sixDaysAgo, [{ item_name: "Fries", quantity: 5, total_money: 52.5 }], { mode: "inclusive" }),
    refund,
  ], { catalogue });
  const sum = (k) => Math.round(m.daily.reduce((a, d) => a + d[k], 0) * 100) / 100;
  assert.equal(m.totals.grossProfit, 100);
  assert.equal(sum("cost"), m.totals.cost, "the days' cost is the period's");
  assert.equal(Math.round((sum("sales") - sum("tax") - sum("cost")) * 100) / 100, m.totals.grossProfit,
    "sales less VAT less cost, day by day, is the period's gross profit");
  const today = m.daily.at(-1);
  assert.equal(today.cost, 40, "today's fries; the mystery dish has no known cost");
  assert.equal(today.lineNet, 120, "every line's takings without VAT");
  assert.equal(today.costedNet, 100, "only the costed lines");
  assert.equal(today.costedCost, 40);
  const earlier = m.daily.at(-7);
  assert.equal(earlier.cost, 20);
  assert.equal(earlier.lineNet, 50, "VAT inside the price is taken out of the line");
});

await test("a long range carries its own profit, costed margin and coverage", async () => {
  /* Today: 10 fries, 100 without VAT, cost 40. Sixty days ago: 5 fries
     (cost 20) and 50 of a dish nobody has costed. Over 90 days: 200 without
     VAT, cost 60, gross profit 140, margin 70%; 150 of it costed at 60, so
     the costed margin is 60% and coverage 75%. The 30 days hold only today. */
  const { getMetrics } = await import("./_data.js");
  const m = await getMetrics({
    register: [
      vatSale(hourAgo, [{ item_name: "Fries", quantity: 10, total_money: 100 }]),
      vatSale(new Date(NOW - 60 * DAY).toISOString(), [{ item_name: "Fries", quantity: 5, total_money: 50 }, { item_name: "Mystery", quantity: 5, total_money: 50 }]),
    ],
    costs: new Map([["Fries", { cost: 4 }]]),
    period: { key: "quarter", days: 90 },
    now: NOW,
  });
  const p = m.period.totals;
  assert.equal(p.salesExVat, 200);
  assert.equal(p.cost, 60);
  assert.equal(p.grossProfit, 140);
  assert.equal(p.marginPct, 70);
  assert.equal(p.costedMarginPct, 60, "the uncosted dish is left out");
  assert.equal(p.costCoverage, 75);
  assert.equal(m.totals.grossProfit, 60, "the 30 days are today's sale alone");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
