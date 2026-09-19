/* What the business kept, over one window.

   ── The bug this file exists for ─────────────────────────────────────────

   Net profit was assembled from components measured over different periods: a
   rolling thirty days of revenue and cost of goods, a whole calendar month of
   rent, and a *month-to-date* total of variable spending.

   That last one moved with the calendar rather than with the business. On the
   third of the month it set three days of costs against thirty days of sales,
   so profit read high; by the thirty-first the same business read normal. The
   shape of that curve was produced entirely by the window, and an owner
   watching it month after month would have learned a pattern that was not
   there.

   The test below reproduces it directly: a spend eleven days ago, read on the
   fifth of a month. Month-to-date cannot see it. A thirty-day window must. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const { netProfit, operatingCosts, TRAILING_DAYS } = await import("./_profit.js");
const fc = await import("./_fixedcosts.js");
const vc = await import("./_varcosts.js");

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

/* The fifth of September, local noon. Early enough in the month that
   month-to-date and a thirty-day window disagree sharply. */
const NOW = new Date(2026, 8, 5, 12, 0, 0).getTime();
const daysAgo = (n) => {
  const d = new Date(NOW - n * 864e5);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};

await test("a spend from last month still counts against this month's sales", async () => {
  /* Eleven days back from the fifth is the previous month. The figure it is
     being set against covers thirty days, so it belongs. */
  await vc.saveVarCost("org1", { title: "Packaging", amount: 900, date: daysAgo(11) });
  await vc.saveVarCost("org1", { title: "Ice", amount: 100, date: daysAgo(1) });

  const costs = await operatingCosts("org1", { now: NOW });
  assert.equal(costs.variable, 1000, "both, not just the one in the calendar month");
  assert.equal(costs.entries.variable, 2);

  /* And the month-to-date reading it replaced, for contrast: it can only see
     the one spend that happens to fall after the first of the month. */
  const monthOnly = await vc.listVarCosts("org1", { month: "2026-09" });
  assert.equal(monthOnly.length, 1, "which is what made the old figure wrong");
});

await test("a spend older than the window is left out", async () => {
  await vc.saveVarCost("org1", { title: "Old delivery", amount: 5000, date: daysAgo(40) });
  await vc.saveVarCost("org1", { title: "Ice", amount: 100, date: daysAgo(2) });

  const costs = await operatingCosts("org1", { now: NOW });
  assert.equal(costs.variable, 100, "forty days ago is not in a thirty-day window");
});

await test("the window's edges are inclusive at both ends", async () => {
  await vc.saveVarCost("org1", { title: "Edge", amount: 10, date: daysAgo(TRAILING_DAYS - 1) });
  await vc.saveVarCost("org1", { title: "Today", amount: 10, date: daysAgo(0) });
  await vc.saveVarCost("org1", { title: "Just outside", amount: 999, date: daysAgo(TRAILING_DAYS) });

  const costs = await operatingCosts("org1", { now: NOW });
  assert.equal(costs.variable, 20);
});

await test("rent is charged for the window, and the monthly figure comes too", async () => {
  await fc.saveCost("org1", { name: "Rent", amount: 18000, period: "monthly" });
  await fc.saveCost("org1", { name: "Licence", amount: 8400, period: "yearly" });

  const costs = await operatingCosts("org1", { now: NOW });
  assert.equal(costs.fixedMonthly, 18700, "18000 + 8400/12");

  /* Thirty days is slightly less than an average month, so a month's rent set
     whole against it would overstate the cost by about a percent and a half.
     Both numbers are returned so the smaller one can be explained rather than
     look like an error. */
  assert.equal(costs.fixed, Math.round(18700 * (30 / 30.4375) * 100) / 100);
  assert.ok(costs.fixed < costs.fixedMonthly);
  assert.equal(costs.days, 30);
});

await test("the components reproduce the answer", async () => {
  await fc.saveCost("org1", { name: "Rent", amount: 18000, period: "monthly" });
  await vc.saveVarCost("org1", { title: "Packaging", amount: 1620, date: daysAgo(3) });

  const out = await netProfit("org1", { netSales: 100000, cogs: 30000, now: NOW });

  assert.equal(out.grossProfit, 70000);
  assert.equal(
    Math.round((out.netSales - out.costOfGoods - out.fixedCosts - out.variableCosts) * 100) / 100,
    out.net,
    "a figure nobody can check is a figure nobody should act on");
  assert.equal(out.formula, "net = netSales - costOfGoods - fixedCosts - variableCosts");
});

await test("with no overheads on record, net is gross and says so", async () => {
  const out = await netProfit("org1", { netSales: 100000, cogs: 30000, now: NOW });

  assert.equal(out.net, out.grossProfit);
  /* The flag is the point. A business with nothing entered is not a business
     with no overheads, and presenting the two the same way is the most
     flattering lie this calculation could tell. */
  assert.equal(out.hasOperatingCosts, false);
});

await test("one fixed cost is enough to stop that claim", async () => {
  await fc.saveCost("org1", { name: "Rent", amount: 18000, period: "monthly" });
  const out = await netProfit("org1", { netSales: 100000, cogs: 30000, now: NOW });
  assert.equal(out.hasOperatingCosts, true);
  assert.ok(out.net < out.grossProfit);
});

await test("no sales is a null margin, not a zero one", async () => {
  await fc.saveCost("org1", { name: "Rent", amount: 18000, period: "monthly" });
  const out = await netProfit("org1", { netSales: 0, cogs: 0, now: NOW });

  /* Zero percent is a claim about a business that traded. This one did not. */
  assert.equal(out.netMarginPct, null);
  assert.equal(out.grossMarginPct, null);
  assert.ok(out.net < 0, "the rent was still due");
});

await test("coverage travels with the answer", async () => {
  const out = await netProfit("org1", { netSales: 100000, cogs: 30000, coverage: 0.5, now: NOW });
  /* Half the menu has no recipe, so cost of goods is a lower bound and this
     profit is an upper one. The number cannot be read without it. */
  assert.equal(out.costCoverage, 0.5);
});

await test("one business's overheads are not another's", async () => {
  await fc.saveCost("org1", { name: "Rent", amount: 18000, period: "monthly" });
  const other = await operatingCosts("org2", { now: NOW });
  assert.equal(other.fixed, 0);
  assert.equal(other.variable, 0);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
