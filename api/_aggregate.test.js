/* Turning receipts into the figures an owner reads.

   ── The two things this exists to hold down ──────────────────────────────

   **Money given back leaves the turnover.** It did not. Refund receipts were
   skipped with the same `continue` as cancellations and `extras.refunds` was a
   hardcoded zero, so a refunded table stayed in the sales figure at full value
   for ever. Nothing in the suite noticed, because nothing in the suite had ever
   fed this function a refund.

   **The headline figure is called what it is.** `sales - costOfGoods` is gross
   profit. It was published as `netProfit` and labelled, in Arabic and Urdu, as
   "what is left after deducting the expenses" — which rent and wages are not
   deducted from. `_domains.js` has always computed a real net profit for the
   assistant, so the product disagreed with itself about the meaning of the
   word in two different screens.

   The sign of `total_money` on a refund is not documented by Loyverse, so both
   signs are fed in here deliberately. A test that only ever sends the sign
   somebody guessed is a test that agrees with the guess. */

import assert from "node:assert/strict";
import { aggregate } from "./_aggregate.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0);
const DAY = 864e5;

const sale = (over = {}) => ({
  receipt_type: "SALE",
  receipt_date: new Date(NOW - DAY).toISOString(),
  store_id: "b1",
  total_money: 100,
  currency: "AED",
  payments: [],
  line_items: [{ item_name: "Shawarma", quantity: 1, total_money: 100 }],
  ...over,
});

const refund = (over = {}) => sale({ receipt_type: "REFUND", refund_for: "1-1", ...over });

/* A catalogue that puts a cost of 30 on the one dish, so cost of goods is a
   number rather than zero and the margin has something to be wrong about. */
const catalogue = new Map([["Shawarma", { cost: 30, image: null }]]);
const run = (receipts) =>
  aggregate({ receipts, limitedHistory: false, catalogue, storeNames: { b1: "Main" }, now: NOW });

test("a refund comes off the turnover", () => {
  const plain = run([sale(), sale()]);
  assert.equal(plain.totals.sales, 200);

  const withRefund = run([sale(), sale(), refund({ total_money: 100 })]);
  assert.equal(withRefund.totals.sales, 100, "two sales less one refund");
  assert.equal(withRefund.totals.refunds, 100, "and it is visible on its own");
  assert.equal(withRefund.extras.refunds, 100);
});

test("whichever sign the till puts on it", () => {
  /* Loyverse documents neither, and the app has never had a fixture that
     pinned it. Taking the magnitude is right either way; adding the raw value
     would be right only half the time, and silently doubling sales the other
     half. */
  const positive = run([sale(), refund({ total_money: 40 })]);
  const negative = run([sale(), refund({ total_money: -40 })]);
  assert.equal(positive.totals.sales, 60);
  assert.equal(negative.totals.sales, 60);
  assert.equal(positive.totals.refunds, negative.totals.refunds);
});

test("the food does not come back with the money", () => {
  /* `drawsStock` already refuses to return a served meal to the shelf. The
     same has to hold here, or a refunded dish looks free to produce. */
  const out = run([sale(), refund({ total_money: 100 })]);
  assert.equal(out.totals.cost, 30, "one sale's ingredients, still consumed");
  assert.equal(out.totals.sales, 0);
  assert.equal(out.totals.grossProfit, -30, "a refunded meal costs money, and says so");
});

test("a refund is not an order", () => {
  const out = run([sale(), sale(), refund({ total_money: 100 })]);
  /* Counting it would put the average ticket on three receipts that produced
     one sale's worth of money. */
  assert.equal(out.totals.receipts, 2);
  assert.equal(Math.round(out.totals.avgTicket), 50);
});

test("gross profit is turnover less the cost of goods, and is named that", () => {
  const out = run([sale({ total_money: 100 })]);
  assert.equal(out.totals.grossProfit, 70);
  assert.equal(out.totals.marginPct, 70);

  /* The old field still carries the same number for the Flutter client, which
     reads it and has not been updated. It is an alias, never a second figure:
     if these ever disagree, one screen is lying. */
  assert.equal(out.totals.netProfit, out.totals.grossProfit);
});

test("the day and the branch still add up to the headline", () => {
  const out = run([sale(), sale(), refund({ total_money: 100 })]);

  const daySum = out.daily.reduce((n, d) => n + d.sales, 0);
  assert.equal(daySum, out.totals.sales, "the chart matches the number above it");

  const branchSum = out.stores.reduce((n, s) => n + s.sales, 0);
  assert.equal(branchSum, out.totals.sales, "and so does the branch ranking");
});

test("a refund at one branch does not move another", () => {
  const out = run([
    sale({ store_id: "b1" }),
    sale({ store_id: "b2" }),
    refund({ store_id: "b2", total_money: 100 }),
  ]);
  const byId = Object.fromEntries(out.stores.map((s) => [s.id, s.sales]));
  assert.equal(byId.b1, 100);
  assert.equal(byId.b2, 0);
});

test("a cancelled receipt is not a refund", () => {
  /* Nothing was sold and nothing was handed back, so it belongs in neither
     figure. Folding it into refunds would invent money that never moved. */
  const out = run([sale(), sale({ cancelled_at: new Date(NOW).toISOString() })]);
  assert.equal(out.totals.sales, 100);
  assert.equal(out.totals.refunds, 0);
  assert.equal(out.totals.receipts, 1);
});

test("last month's refunds net off last month, so the change is like for like", () => {
  const old = { receipt_date: new Date(NOW - 40 * DAY).toISOString() };
  const flat = run([sale(), sale(old)]);
  assert.equal(flat.totals.salesDelta, 0, "100 against 100");

  /* Half of the prior period was handed back. Leaving it in would make this
     month look flat against a month that was really half the size. */
  const out = run([sale(), sale(old), refund({ ...old, total_money: 50 })]);
  assert.equal(out.totals.salesDelta, 100, "100 against 50");
});

test("refunding everything is not a divide-by-zero", () => {
  const out = run([sale(), refund({ total_money: 100 })]);
  assert.equal(out.totals.sales, 0);
  assert.equal(Number.isFinite(out.totals.marginPct), true);
  assert.equal(out.totals.marginPct, 0);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
