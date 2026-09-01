/* The variable cost ledger, and normalising constant costs to a month.

   What these protect: a date is a calendar day and never drifts into the
   neighbouring month; a month's total counts that month and nothing else; an
   id a client invented cannot overwrite somebody's row; a yearly constant cost
   is counted as a twelfth rather than a whole year; and validation names the
   field rather than the language. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const vc = await import("./_varcosts.js");
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

const ORG = "org-1";

await test("a spend is stored and comes back in its month", async () => {
  const { cost, created } = await vc.saveVarCost(ORG, {
    title: "Packaging", amount: 1620, date: "2026-05-15",
  });
  assert.equal(created, true);
  assert.equal(cost.title, "Packaging");
  assert.equal(cost.amount, 1620);

  const may = await vc.listVarCosts(ORG, { month: "2026-05" });
  assert.equal(may.length, 1);
  assert.equal(await vc.monthTotal(ORG, "2026-05"), 1620);
});

await test("a spend on the last day of a month stays in that month", async () => {
  /* The reason `date` is a string and not a timestamp. Held as milliseconds
     and read back as UTC, an evening spend in Dubai lands in the next day —
     and on the 31st, in the next month, where the list would show it and the
     total would not. */
  await vc.saveVarCost(ORG, { title: "Late delivery", amount: 300, date: "2026-05-31" });
  assert.equal(await vc.monthTotal(ORG, "2026-05"), 300);
  assert.equal(await vc.monthTotal(ORG, "2026-06"), 0);
});

await test("a month's total counts that month and nothing else", async () => {
  await vc.saveVarCost(ORG, { title: "Packaging", amount: 1620, date: "2026-05-15" });
  await vc.saveVarCost(ORG, { title: "Maintenance", amount: 1240, date: "2026-05-10" });
  await vc.saveVarCost(ORG, { title: "Commission", amount: 900, date: "2026-06-02" });

  assert.equal(await vc.monthTotal(ORG, "2026-05"), 2860);
  assert.equal(await vc.monthTotal(ORG, "2026-06"), 900);
  assert.equal((await vc.listVarCosts(ORG)).length, 3, "no month asked for means everything");
});

await test("entries come back newest first", async () => {
  await vc.saveVarCost(ORG, { title: "Older", amount: 10, date: "2026-05-02" });
  await vc.saveVarCost(ORG, { title: "Newer", amount: 10, date: "2026-05-20" });
  const rows = await vc.listVarCosts(ORG, { month: "2026-05" });
  assert.equal(rows[0].title, "Newer");
});

await test("amending by id replaces the row rather than adding one", async () => {
  const { cost } = await vc.saveVarCost(ORG, { title: "Packaging", amount: 1620, date: "2026-05-15" });
  const { cost: after, created } = await vc.saveVarCost(ORG, {
    id: cost.id, title: "Packaging and cups", amount: 1700, date: "2026-05-15",
  });

  assert.equal(created, false);
  assert.equal(after.id, cost.id);
  assert.equal(after.createdAt, cost.createdAt, "when it was first entered is not rewritten");
  assert.equal((await vc.listVarCosts(ORG, { month: "2026-05" })).length, 1);
  assert.equal(await vc.monthTotal(ORG, "2026-05"), 1700);
});

await test("an id the org does not own creates a new row instead of writing over one", async () => {
  const { cost } = await vc.saveVarCost("org-2", { title: "Theirs", amount: 500, date: "2026-05-01" });
  const { cost: mine, created } = await vc.saveVarCost(ORG, {
    id: cost.id, title: "Mine", amount: 1, date: "2026-05-01",
  });

  assert.equal(created, true);
  assert.notEqual(mine.id, cost.id);
  const theirs = await vc.listVarCosts("org-2");
  assert.equal(theirs[0].title, "Theirs", "another org's row is untouched");
});

await test("deleting removes it and the total follows", async () => {
  const { cost } = await vc.saveVarCost(ORG, { title: "Typo", amount: 99999, date: "2026-05-15" });
  assert.deepEqual(await vc.deleteVarCost(ORG, cost.id), { deleted: true, id: cost.id });
  assert.equal(await vc.monthTotal(ORG, "2026-05"), 0);
  assert.equal((await vc.deleteVarCost(ORG, cost.id)).error, "notfound");
});

await test("validation names the field, so the client owns the wording", () => {
  assert.equal(vc.validateVarCost({ title: "", amount: 5 }), "title");
  assert.equal(vc.validateVarCost({ title: " ", amount: 5 }), "title");
  assert.equal(vc.validateVarCost({ title: "Rent", amount: 0 }), "amount");
  assert.equal(vc.validateVarCost({ title: "Rent", amount: -5 }), "amount");
  assert.equal(vc.validateVarCost({ title: "Rent", amount: 5, date: "15/05/2026" }), "date");
  assert.equal(vc.validateVarCost({ title: "Rent", amount: 5, date: "2026-05-15" }), null);
});

await test("a missing date falls back to today rather than being rejected", async () => {
  const { cost } = await vc.saveVarCost(ORG, { title: "Cash spend", amount: 40 });
  assert.equal(cost.date, vc.todayISO());
});

await test("a yearly constant cost counts as a twelfth of itself", () => {
  assert.equal(fc.monthlyEquivalent({ amount: 8400, period: "yearly" }), 700);
  assert.equal(fc.monthlyEquivalent({ amount: 4000, period: "monthly" }), 4000);
  /* Legacy: the screen no longer offers weekly, but money entered under it is
     still real and must not read as zero. */
  assert.equal(fc.monthlyEquivalent({ amount: 120, period: "weekly" }), 520);
});

await test("a nonsense amount normalises to zero rather than NaN", () => {
  /* NaN propagates: one bad row and the whole header reads "—". */
  assert.equal(fc.monthlyEquivalent({ amount: "abc", period: "monthly" }), 0);
  assert.equal(fc.monthlyEquivalent({ amount: -5, period: "monthly" }), 0);
  assert.equal(fc.monthlyEquivalent(null), 0);
});

await test("the constant total adds monthly and yearly on one basis", () => {
  const total = fc.monthlyTotal([
    { amount: 4000, period: "monthly" },
    { amount: 3750, period: "monthly" },
    { amount: 8400, period: "yearly" },
  ]);
  assert.equal(total, 8450);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
