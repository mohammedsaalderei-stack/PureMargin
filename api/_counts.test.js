/* Stage 4, phase 3: stock counts, variance, and the approval workflow.

   The claims worth protecting here are the ones a real count would expose:
   expectations are frozen when the sheet opens (so the evening's sales aren't
   counted as shrinkage), "not counted" is never treated as zero, approval is the
   only step that moves stock, and the adjustments it writes make the ledger
   agree with the shelf exactly. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");
const ct = await import("./_counts.js");

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

const near = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

/* Flour held in kg at 10 per kg, boxes counted each at 0.5 each. */
async function seed() {
  await inv.saveIngredient("org1", { name: "Plain flour", stockUnit: "kg", category: "Dry" });
  await inv.saveIngredient("org1", { name: "Burger box", stockUnit: "ea", category: "Packaging" });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "plain-flour", type: "receive", qty: 20, unit: "kg", unitCost: 10,
  });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "burger-box", type: "receive", qty: 500, unit: "ea", unitCost: 0.5,
  });
}

const ingredients = () => inv.listIngredients("org1", { includeArchived: true });
const rows = async () => mv.balances("org1", ["b1"], { ingredients: await ingredients() });
const onHand = async (id) => (await rows()).find((r) => r.ingredientId === id)?.qty ?? 0;

/* --------------------------- opening ----------------------------- */

await test("a count opens as a draft sheet of every ingredient in scope", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1", { actor: "amal" });
  assert.strictEqual(count.status, "draft");
  assert.strictEqual(count.lines.length, 2);
  assert.strictEqual(count.openedBy, "amal");
  /* Nothing counted yet — and that is null, never zero. */
  assert.deepStrictEqual(count.lines.map((l) => l.countedQty), [null, null]);
});

await test("scope narrows the sheet by category, and an empty scope is refused", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1", { category: "Packaging" });
  assert.deepStrictEqual(count.lines.map((l) => l.ingredientId), ["burger-box"]);
  assert.strictEqual((await ct.openCount("org1", "b1", { category: "Nothing" })).error, "empty");
});

await test("a spot count can name its own ingredients", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1", { ingredientIds: ["plain-flour"], spot: true });
  assert.strictEqual(count.spot, true);
  assert.strictEqual(count.lines.length, 1);
});

await test("expected quantities are frozen when the sheet opens, not read at approval", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  const line = count.lines.find((l) => l.ingredientId === "plain-flour");
  near(line.expectedBase, 20000);

  /* An hour of trading happens after the sheet is printed. */
  await mv.recordMovement("org1", "b1", {
    ingredientId: "plain-flour", type: "consume", qty: 5, unit: "kg",
  });
  const still = (await ct.getCount("org1", count.id)).lines.find((l) => l.ingredientId === "plain-flour");
  near(still.expectedBase, 20000, 1e-9);
});

/* ------------------------- filling in ---------------------------- */

await test("counted quantities are accepted in any unit of the right dimension", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  const out = await ct.saveLines("org1", count.id, [
    { ingredientId: "plain-flour", countedQty: 18500, unit: "g" },
  ]);
  const priced = await ct.getCount("org1", out.count.id, { priced: true });
  const line = priced.lines.find((l) => l.ingredientId === "plain-flour");
  near(line.countedBase, 18500);
  near(line.varianceQty, -1.5);
});

await test("a wrong dimension, a negative count and an unknown reason are refused", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  assert.strictEqual((await ct.saveLines("org1", count.id, [
    { ingredientId: "plain-flour", countedQty: 1, unit: "l" }])).error, "unit");
  assert.strictEqual((await ct.saveLines("org1", count.id, [
    { ingredientId: "plain-flour", countedQty: -1, unit: "kg" }])).error, "countedQty");
  assert.strictEqual((await ct.saveLines("org1", count.id, [
    { ingredientId: "plain-flour", countedQty: 1, unit: "kg", reason: "vibes" }])).error, "reason");
  assert.strictEqual((await ct.saveLines("org1", count.id, [
    { ingredientId: "nope", countedQty: 1 }])).error, "ingredientId");
});

await test("counting zero is a real statement, and clearing a line undoes it", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 0 }]);
  let line = (await ct.getCount("org1", count.id)).lines.find((l) => l.ingredientId === "plain-flour");
  assert.strictEqual(line.countedQty, 0, "zero is counted, not blank");

  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: null }]);
  line = (await ct.getCount("org1", count.id)).lines.find((l) => l.ingredientId === "plain-flour");
  assert.strictEqual(line.countedQty, null);
});

/* --------------------------- variance ---------------------------- */

await test("variance is valued at the last cost actually paid", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1", { ingredientIds: ["plain-flour"] });
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 18, reason: "spoilage" }]);

  const priced = await ct.getCount("org1", count.id, { priced: true });
  const line = priced.lines[0];
  near(line.varianceQty, -2);
  near(line.varianceValue, -20, 1e-6);
  near(priced.totals.shrinkValue, -20, 1e-6);
  near(priced.totals.gainValue, 0);
});

await test("shrinkage and gains are reported apart, not netted away", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  await ct.saveLines("org1", count.id, [
    { ingredientId: "plain-flour", countedQty: 18 },   // −2 kg  = −20
    { ingredientId: "burger-box", countedQty: 520 },   // +20 ea = +10
  ]);
  const { totals } = await ct.getCount("org1", count.id, { priced: true });
  near(totals.shrinkValue, -20, 1e-6);
  near(totals.gainValue, 10, 1e-6);
  near(totals.netValue, -10, 1e-6);
});

await test("coverage reports how much of the sheet was actually counted", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 20 }]);
  const { totals } = await ct.getCount("org1", count.id, { priced: true });
  assert.strictEqual(totals.counted, 1);
  assert.strictEqual(totals.lines, 2);
  near(totals.coverage, 0.5);
});

await test("an ingredient never received with a cost is unpriced, not valued at zero", async () => {
  await inv.saveIngredient("org1", { name: "Salt", stockUnit: "kg" });
  await mv.recordMovement("org1", "b1", { ingredientId: "salt", type: "opening", qty: 5, unit: "kg" });
  const { count } = await ct.openCount("org1", "b1");
  await ct.saveLines("org1", count.id, [{ ingredientId: "salt", countedQty: 4 }]);

  const priced = await ct.getCount("org1", count.id, { priced: true });
  assert.strictEqual(priced.lines[0].varianceValue, null);
  assert.strictEqual(priced.totals.unpriced, 1);
  near(priced.totals.netValue, 0);
});

/* --------------------------- workflow ---------------------------- */

await test("an empty sheet cannot be submitted for review", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  assert.strictEqual((await ct.submitCount("org1", count.id)).error, "nocounts");
});

await test("draft to review to approved, and nothing moves before approval", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1", { ingredientIds: ["plain-flour"] });
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 18, reason: "spoilage" }]);

  const submitted = await ct.submitCount("org1", count.id, { actor: "amal" });
  assert.strictEqual(submitted.count.status, "review");
  near(await onHand("plain-flour"), 20, 1e-9);

  const approved = await ct.approveCount("org1", count.id, { actor: "owner" });
  assert.strictEqual(approved.count.status, "approved");
  assert.strictEqual(approved.count.approvedBy, "owner");
  near(await onHand("plain-flour"), 18, 1e-9);
});

await test("a draft cannot be approved — it has to be submitted first", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 18 }]);
  assert.strictEqual((await ct.approveCount("org1", count.id)).error, "notreview");
});

await test("lines are locked once the count is under review", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 18 }]);
  await ct.submitCount("org1", count.id);
  assert.strictEqual((await ct.saveLines("org1", count.id, [
    { ingredientId: "plain-flour", countedQty: 1 }])).error, "notdraft");
});

await test("a reviewer can send a count back, and then it accepts lines again", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 18 }]);
  await ct.submitCount("org1", count.id);

  const back = await ct.reopenCount("org1", count.id, { actor: "owner" });
  assert.strictEqual(back.count.status, "draft");
  assert.strictEqual(back.count.submittedAt, null);
  assert.ok((await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 19 }])).count);
});

await test("an approved count is final: it cannot be re-approved or cancelled", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1", { ingredientIds: ["plain-flour"] });
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 18 }]);
  await ct.submitCount("org1", count.id);
  await ct.approveCount("org1", count.id);

  assert.strictEqual((await ct.approveCount("org1", count.id)).error, "approved");
  assert.strictEqual((await ct.cancelCount("org1", count.id)).error, "approved");
  /* And approving twice did not move stock twice. */
  near(await onHand("plain-flour"), 18, 1e-9);
});

/* ------------------- what approval writes ------------------------ */

await test("approval writes one adjustment per varying line, and none for matches", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  await ct.saveLines("org1", count.id, [
    { ingredientId: "plain-flour", countedQty: 18, reason: "spoilage" },
    { ingredientId: "burger-box", countedQty: 500 },
  ]);
  await ct.submitCount("org1", count.id);
  const out = await ct.approveCount("org1", count.id, { actor: "owner" });

  assert.strictEqual(out.movementIds.length, 1, "the matching line writes nothing");
  const adjustments = await mv.listMovements("org1", "b1", { type: "adjust" });
  assert.strictEqual(adjustments.length, 1);
  near(adjustments[0].qty, -2);
  assert.strictEqual(adjustments[0].unit, "kg");
  assert.strictEqual(adjustments[0].reason, "spoilage");
  assert.strictEqual(adjustments[0].ref, `count:${count.id}`);
  assert.strictEqual(adjustments[0].actor, "owner");
});

await test("after approval the ledger agrees with what was counted, in any unit", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1", { ingredientIds: ["plain-flour"] });
  /* Counted in grams against an ingredient held in kilograms. */
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 17250, unit: "g" }]);
  await ct.submitCount("org1", count.id);
  await ct.approveCount("org1", count.id);
  near(await onHand("plain-flour"), 17.25, 1e-9);
});

await test("a count of nothing left drives the balance to zero even with negative stock refused", async () => {
  await seed();
  await mv.savePolicy("org1", { allowNegative: false });
  const { count } = await ct.openCount("org1", "b1", { ingredientIds: ["plain-flour"] });
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 0, reason: "theft" }]);
  await ct.submitCount("org1", count.id);
  await ct.approveCount("org1", count.id);
  near(await onHand("plain-flour"), 0, 1e-9);
});

await test("uncounted lines are left alone by approval", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 18 }]);
  await ct.submitCount("org1", count.id);
  await ct.approveCount("org1", count.id);
  near(await onHand("burger-box"), 500, 1e-9);
});

await test("the valuation is frozen onto the count when it is approved", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1", { ingredientIds: ["plain-flour"] });
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 18 }]);
  await ct.submitCount("org1", count.id);
  const out = await ct.approveCount("org1", count.id);
  near(out.count.totals.netValue, -20, 1e-6);

  /* Flour is bought again at triple the price; what the count was worth when it
     was signed off does not move. */
  await mv.recordMovement("org1", "b1", {
    ingredientId: "plain-flour", type: "receive", qty: 10, unit: "kg", unitCost: 30,
  });
  const stored = await ct.getCount("org1", count.id);
  near(stored.totals.netValue, -20, 1e-6);
});

/* --------------------- listing and isolation --------------------- */

await test("counts list only for the branches asked for, newest first", async () => {
  await seed();
  const a = await ct.openCount("org1", "b1", { name: "First" });
  const b = await ct.openCount("org1", "b2", { name: "Second" });

  const one = await ct.listCounts("org1", ["b1"]);
  assert.deepStrictEqual(one.map((c) => c.id), [a.count.id]);
  const both = await ct.listCounts("org1", ["b1", "b2"]);
  assert.deepStrictEqual(both.map((c) => c.id), [b.count.id, a.count.id]);
  assert.deepStrictEqual(await ct.listCounts("org1", []), []);
  /* The list stays thin — lines are only loaded for the count you open. */
  assert.strictEqual(one[0].lines, undefined);
  assert.strictEqual(one[0].lineCount, 2);
});

await test("a status filter separates what needs reviewing from what is done", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 20 }]);
  await ct.submitCount("org1", count.id);
  await ct.openCount("org1", "b1", { ingredientIds: ["burger-box"] });

  assert.strictEqual((await ct.listCounts("org1", ["b1"], { status: "review" })).length, 1);
  assert.strictEqual((await ct.listCounts("org1", ["b1"], { status: "draft" })).length, 1);
});

await test("one organization's counts are unreachable from another", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1");
  assert.strictEqual(await ct.getCount("org2", count.id), null);
  assert.deepStrictEqual(await ct.listCounts("org2", ["b1"]), []);
});

await test("a cancelled count is kept, and writes nothing to the ledger", async () => {
  await seed();
  const { count } = await ct.openCount("org1", "b1", { ingredientIds: ["plain-flour"] });
  await ct.saveLines("org1", count.id, [{ ingredientId: "plain-flour", countedQty: 5 }]);
  const out = await ct.cancelCount("org1", count.id, { actor: "owner", reason: "wrong shelf" });

  assert.strictEqual(out.count.status, "cancelled");
  assert.strictEqual(out.count.cancelReason, "wrong shelf");
  assert.ok(await ct.getCount("org1", count.id), "kept, not deleted");
  near(await onHand("plain-flour"), 20, 1e-9);
  assert.strictEqual((await mv.listMovements("org1", "b1", { type: "adjust" })).length, 0);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
