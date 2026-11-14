/* The Overview's figures for a picked range (`rangeTotals.js`).

   What this protects: gross profit, margin, food cost and the purity score
   used to stay on the last 30 days whatever range was picked, so on "Today"
   a month's profit sat beside a day's takings and could be the larger of the
   two. Each now covers the same days as the sales beside it. Also that food
   cost is over sales without VAT, that a range nobody sold in says so, and
   that the 30 days and the long ranges keep the server's own figures.

   The arithmetic is checkable on paper; each day row is what
   `api/_aggregate.js` emits. */

import assert from "node:assert/strict";
import { rangeTotals, foodCostPct, profitOfDays } from "./rangeTotals.js";

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

const row = (i, o = {}) => ({
  date: `2026-10-${String(i + 1).padStart(2, "0")}`, sales: 0, receipts: 0, tax: 0,
  cost: 0, lineNet: 0, costedNet: 0, costedCost: 0, ...o,
});

/* Thirty days, quiet but for three:
   - day 21 (in the week before last): 50 without VAT, cost 15;
   - yesterday: 100 without VAT, cost 25;
   - today: 200 without VAT, of which 150 is costed at 60 and 50 is a dish
     with no cost. Gross profit 140, margin 70%, costed margin 60%,
     coverage 75%, food cost 30%. */
const daily = Array.from({ length: 30 }, (_, i) => row(i));
daily[20] = row(20, { sales: 52.5, receipts: 1, tax: 2.5, cost: 15, lineNet: 50, costedNet: 50, costedCost: 15 });
daily[28] = row(28, { sales: 105, receipts: 2, tax: 5, cost: 25, lineNet: 100, costedNet: 100, costedCost: 25 });
daily[29] = row(29, { sales: 210, receipts: 3, tax: 10, cost: 60, lineNet: 200, costedNet: 150, costedCost: 60 });

/* The server's 30 days, and a stand-in for its score: the 30-day range must
   hand back this very object, not work out its own. */
const SERVER_SCORE = { value: 61, state: "steady", fromServer: true };
const data = {
  daily,
  totals: { sales: 367.5, receipts: 6, tax: 17.5, salesExVat: 350, cost: 100, grossProfit: 250,
    marginPct: 71.4, costedMarginPct: 66.7, salesDelta: null },
  costCoverage: 86,
  margin: { score: SERVER_SCORE },
};

test("today's gross profit is today's, not the month's", () => {
  const r = rangeTotals(data, "daily");
  assert.equal(r.basis, "daily");
  assert.equal(r.totals.sales, 210);
  assert.equal(r.totals.salesExVat, 200, "takings less the VAT in them");
  assert.equal(r.totals.cost, 60);
  assert.equal(r.totals.grossProfit, 140, "the month's was 250, more than today's 210 taken");
  assert.equal(r.totals.marginPct, 70);
  assert.equal(r.totals.costedMarginPct, 60, "the uncosted dish is left out of the costed margin");
  assert.equal(r.costCoverage, 75, "150 of 200 costed");
});

test("the last 7 days add their own days up", () => {
  const r = rangeTotals(data, "weekly");
  assert.equal(r.basis, "weekly");
  assert.equal(r.totals.salesExVat, 300);
  assert.equal(r.totals.grossProfit, 215, "300 less 85; day 21 is outside the week");
  assert.equal(r.totals.costedMarginPct, 66);
  assert.equal(r.costCoverage, 83);
});

test("the purity score follows the range", () => {
  /* Today: costed margin 60% is a third of the way from 55 to 70, and
     today doubled yesterday, so trend is full: 21.7 + 35 = 57. */
  const today = rangeTotals(data, "daily").score;
  assert.equal(today.value, 57);
  assert.equal(today.noTrend, false, "today is compared with yesterday");
  /* The week: 66% is 11/15 of the way, and it sold far more than the week
     before: 47.7 + 35 = 83. */
  assert.equal(rangeTotals(data, "weekly").score.value, 83);
  assert.equal(rangeTotals(data, "monthly").score, SERVER_SCORE, "the 30 days keep the server's score");
});

test("a range nobody sold in says so, rather than asking for costs", () => {
  const quiet = { ...data, daily: [...daily.slice(0, 29), row(29)] };
  const s = rangeTotals(quiet, "daily").score;
  assert.equal(s.value, null);
  assert.equal(s.state, "nosales");
});

test("food cost is over sales without VAT", () => {
  assert.equal(foodCostPct(rangeTotals(data, "daily").totals), 30, "60 of 200, not 60 of 210");
  assert.equal(foodCostPct({ cost: 14, salesExVat: 40 }), 35, "the 65% margin's food cost, not 33.3");
  assert.equal(foodCostPct({ cost: 0, salesExVat: 0 }), null, "nothing sold is no figure, not 0%");
});

test("the 30 days keep the server's own figures", () => {
  const r = rangeTotals(data, "monthly");
  assert.equal(r.basis, "monthly");
  assert.equal(r.totals.grossProfit, 250);
  assert.equal(r.costCoverage, 86);
});

test("day rows from before they carried a cost stay on the 30 days, and say so", () => {
  const old = { ...data, daily: daily.map(({ cost, lineNet, costedNet, costedCost, ...rest }) => rest) };
  const r = rangeTotals(old, "daily");
  assert.equal(r.basis, "monthly", "the label says which days the profit covers");
  assert.equal(r.totals.grossProfit, 250);
  assert.equal(r.score, SERVER_SCORE);
  assert.equal(r.totals.sales, 210, "the sales still follow the range");
});

test("a long range scores the period the server worked out", () => {
  const period = { key: "quarter", series: [], totals: { sales: 1050, receipts: 10, tax: 50, salesExVat: 1000,
    cost: 316, grossProfit: 684, marginPct: 68.4, costedMarginPct: 68.4, costCoverage: 90, salesDelta: 10 } };
  const r = rangeTotals({ ...data, period }, "quarter");
  assert.equal(r.basis, "quarter");
  assert.equal(r.totals.grossProfit, 684);
  assert.equal(r.costCoverage, 90);
  /* 68.4% is 13.4/15 of the way (58.1) and +10% is three quarters of the
     trend (26.25): 84. */
  assert.equal(r.score.value, 84);
  const older = { ...period, totals: { sales: 1050, receipts: 10, tax: 50, salesDelta: 10 } };
  assert.equal(rangeTotals({ ...data, period: older }, "quarter").basis, "monthly",
    "a period without its profit leaves the profit on the 30 days");
});

test("a run of days with no takings has no margin, not a negative one", () => {
  const p = profitOfDays([row(0), row(1)]);
  assert.equal(p.totals.marginPct, 0);
  assert.equal(p.totals.costedMarginPct, null);
  assert.equal(p.costCoverage, 0);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
