/* Rent, salaries, and spreading them across a period.

   What these protect: a monthly figure is spread by day rather than by trade;
   only the days a cost was live are counted; a branch sees its own costs plus
   the whole-business ones and not another branch's; and ending a cost keeps
   the history that a report may already have used. */

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

await test("a month of rent over that month is the whole month", () => {
  const out = fc.apportion([cost({})], { from: JAN(1), to: JAN(32) });
  assert.equal(out.total, 31000);
});

await test("a single day carries one day of it", () => {
  const out = fc.apportion([cost({})], { from: JAN(10), to: JAN(11) });
  assert.equal(out.total, 1000, "31,000 over 31 days");
});

await test("a week carries seven days of it", () => {
  const out = fc.apportion([cost({})], { from: JAN(1), to: JAN(8) });
  assert.equal(out.total, 7000);
});

await test("a weekly cost is spread over seven days, not thirty", () => {
  const out = fc.apportion([cost({ period: "weekly", amount: 700 })], { from: JAN(1), to: JAN(2) });
  assert.equal(out.total, 100);
});

await test("a yearly cost is spread over the year", () => {
  const out = fc.apportion([cost({ period: "yearly", amount: 3650 })], { from: JAN(1), to: JAN(11) });
  assert.equal(out.total, 100, "3650 over 365 days, ten days of it");
});

await test("a cost that started mid-window is only counted from then", () => {
  const out = fc.apportion([cost({ startedAt: JAN(16) })], { from: JAN(1), to: JAN(32) });
  assert.equal(out.total, 16000, "sixteen of the thirty-one days");
});

await test("a cost that ended mid-window stops there", () => {
  const out = fc.apportion([cost({ endedAt: JAN(11) })], { from: JAN(1), to: JAN(32) });
  assert.equal(out.total, 10000);
});

await test("a cost outside the window entirely is not counted", () => {
  const out = fc.apportion([cost({ startedAt: JAN(20), endedAt: JAN(25) })],
    { from: JAN(1), to: JAN(10) });
  assert.equal(out.total, 0);
  assert.deepEqual(out.lines, []);
});

await test("a branch sees its own costs and the whole-business ones", () => {
  const costs = [
    cost({ id: "group", name: "Licence", amount: 3100, branchId: null }),
    cost({ id: "b1", name: "Rent A", amount: 31000, branchId: "b1" }),
    cost({ id: "b2", name: "Rent B", amount: 62000, branchId: "b2" }),
  ];
  const out = fc.apportion(costs, { from: JAN(1), to: JAN(32), branches: ["b1"] });
  assert.deepEqual(out.lines.map((l) => l.name).sort(), ["Licence", "Rent A"]);
  assert.equal(out.total, 34100);
});

await test("no branch filter means every cost", () => {
  const costs = [cost({ id: "a", branchId: "b1" }), cost({ id: "b", branchId: "b2" })];
  assert.equal(fc.apportion(costs, { from: JAN(1), to: JAN(32) }).lines.length, 2);
});

await test("lines come back with the biggest first", () => {
  const costs = [
    cost({ id: "small", name: "Wifi", amount: 310 }),
    cost({ id: "big", name: "Rent", amount: 31000 }),
  ];
  const out = fc.apportion(costs, { from: JAN(1), to: JAN(32) });
  assert.equal(out.lines[0].name, "Rent");
});

await test("a reversed or empty window costs nothing rather than crashing", () => {
  for (const w of [{ from: JAN(10), to: JAN(1) }, { from: JAN(5), to: JAN(5) },
                   { from: null, to: JAN(5) }, {}]) {
    assert.equal(fc.apportion([cost({})], w).total, 0);
  }
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
  const all = await fc.listCosts("org1", { includeEnded: true });
  assert.equal(all.length, 1, "still there for a report over January");
  assert.equal(fc.apportion(all, { from: JAN(1), to: JAN(32) }).total, 10000);
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
