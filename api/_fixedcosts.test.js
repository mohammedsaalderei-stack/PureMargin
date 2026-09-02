/* Rent, salaries, and what they come to in a month.

   What these protect: a yearly figure is a twelfth of itself, a legacy weekly
   entry still converts rather than reading as zero, weekly is refused for
   anything new, and ending a cost keeps the history that a report may already
   have used. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const fc = await import("./_fixedcosts.js");

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

const DAY = 86400000;
/* A 31-day month, so the arithmetic below is checkable by hand. */
const JAN = (d) => Date.UTC(2026, 0, d);

const cost = (over) => ({
  id: over.id || "c1", name: "Rent", amount: 31000, period: "monthly",
  branchId: null, startedAt: JAN(1), endedAt: null, ...over,
});

/* ---- what a cost comes to in a month ---------------------------- */

/* The only normalisation left. Per-day apportionment across an arbitrary
   window used to live here too, with eleven tests of its own; nothing ever
   read its output — the screen sent ?from&to on every load and discarded the
   result — so it went, and this is what the screen actually shows. */

await test("a monthly cost is itself", () => {
  assert.equal(fc.monthlyEquivalent(cost({})), 31000);
});

await test("a yearly cost is a twelfth, exactly", () => {
  /* A year is twelve months by definition, so this is arithmetic rather than
     a convention that could be argued with. */
  assert.equal(fc.monthlyEquivalent(cost({ period: "yearly", amount: 8400 })), 700);
  assert.equal(fc.monthlyEquivalent(cost({ period: "yearly", amount: 1000 })), 83.33);
});

await test("a legacy weekly entry still converts rather than reading as zero", () => {
  /* No longer creatable — PERIODS refuses it — but rows stored before it was
     dropped are real money. 52 weeks over 12 months is the average month. */
  assert.equal(fc.monthlyEquivalent(cost({ period: "weekly", amount: 700 })), 3033.33);
});

await test("weekly is refused for anything new", () => {
  assert.equal(fc.validateCost({ name: "Rent", amount: 100, period: "weekly" }), "period");
  assert.equal(fc.validateCost({ name: "Rent", amount: 100, period: "monthly" }), null);
  assert.equal(fc.validateCost({ name: "Rent", amount: 100, period: "yearly" }), null);
});

await test("a missing or nonsense amount is worth nothing, not NaN", () => {
  assert.equal(fc.monthlyEquivalent(cost({ amount: 0 })), 0);
  assert.equal(fc.monthlyEquivalent(cost({ amount: -5 })), 0);
  assert.equal(fc.monthlyEquivalent(cost({ amount: "abc" })), 0);
  assert.equal(fc.monthlyEquivalent(null), 0);
});

await test("the total is the sum of the monthly equivalents", () => {
  const total = fc.monthlyTotal([
    cost({ id: "a", amount: 12000 }),
    cost({ id: "b", period: "yearly", amount: 8400 }),
    cost({ id: "c", amount: 3000 }),
  ]);
  assert.equal(total, 15700);
  assert.equal(fc.monthlyTotal([]), 0);
});

await test("a name or a non-positive amount is refused", () => {
  assert.equal(fc.validateCost({ name: "", amount: 100 }), "name");
  assert.equal(fc.validateCost({ name: "Rent", amount: 0 }), "amount");
  assert.equal(fc.validateCost({ name: "Rent", amount: -5 }), "amount");
  assert.equal(fc.validateCost({ name: "Rent", amount: 100, period: "hourly" }), "period");
  assert.equal(fc.validateCost({ name: "Rent", amount: 100, period: "monthly" }), null);
});

await test("saving then listing returns it", async () => {
  const { cost: made } = await fc.saveCost("org1", { name: "Rent", amount: 31000 });
  assert.ok(made.id);
  assert.equal(made.period, "monthly", "monthly is the default");
  const list = await fc.listCosts("org1");
  assert.equal(list.length, 1);
});

await test("ending a cost keeps it out of the list but not out of history", async () => {
  const { cost: made } = await fc.saveCost("org1", { name: "Rent", amount: 31000, startedAt: JAN(1) });
  await fc.endCost("org1", made.id, JAN(11));

  assert.equal((await fc.listCosts("org1")).length, 0, "not offered as current");

  /* Still on file, with the day it stopped, so a report over January can
     account for it. The screen totals only current costs; the record is what
     makes it possible to answer a question about a month that has passed. */
  const all = await fc.listCosts("org1", { includeEnded: true });
  assert.equal(all.length, 1);
  assert.equal(all[0].endedAt, JAN(11));
  assert.equal(fc.monthlyTotal(all), 31000);
});

await test("deleting removes it from history too", async () => {
  const { cost: made } = await fc.saveCost("org1", { name: "Typo", amount: 1 });
  await fc.deleteCost("org1", made.id);
  assert.equal((await fc.listCosts("org1", { includeEnded: true })).length, 0);
});

await test("ending or deleting something that is not there says so", async () => {
  assert.equal((await fc.endCost("org1", "nope")).error, "notfound");
  assert.equal((await fc.deleteCost("org1", "nope")).error, "notfound");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
