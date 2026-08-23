/* Stage 4, phase 6: theoretical versus actual consumption.

   What these protect: sales times the dated recipe produce the expected draw at
   gross, the ledger's outgoing entries produce the actual, waste and count
   adjustments are subtracted from the variance as explanations, what remains is
   the unexplained leak, transfers between branches invent no variance, reversed
   entries leave no trace, sales with no recipe are reported rather than skipped,
   and an unpriced ingredient gets a quantity variance with no money attached. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");
const rc = await import("./_recipes.js");
const va = await import("./_variance.js");

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

const near = (a, b, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

const DAY = 864e5;

/* One ingredient, one dish, one branch: enough to see every figure move. */
async function seed({ yieldPct = 100, portions = 1, qty = 100 } = {}) {
  await inv.saveIngredient("org1", { name: "Beef mince", stockUnit: "kg" });
  await inv.saveIngredient("org1", { name: "Burger bun", stockUnit: "ea" });
  /* 10 kg at 40/kg → 0.04 per gram. */
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "receive", qty: 100, unit: "kg", unitCost: 40, actor: "storeman",
  });
  await rc.saveVersion("org1", {
    menuItem: "Cheeseburger", portions, yieldPct, sellPrice: 30,
    effectiveFrom: Date.now() - 20 * DAY,
    lines: [{ ingredientId: "beef-mince", qty, unit: "g" }],
    packaging: [{ ingredientId: "burger-bun", qty: 1, unit: "ea" }],
  });
}

const sold = (qty, name = "Cheeseburger", branchId = "b1") =>
  [{ branchId, name, variant: "", qty, revenue: qty * 30, lines: qty }];

const consume = (qty, type = "consume", branchId = "b1") =>
  mv.recordMovement("org1", branchId, {
    ingredientId: "beef-mince", type, qty, unit: "kg", actor: "chef",
  });

const report = (over = {}) =>
  va.varianceReport("org1", ["b1"], { salesRows: sold(100), from: Date.now() - 30 * DAY, ...over });

const beefOf = (out) => out.items.find((i) => i.ingredientId === "beef-mince");

/* ---------------------- theoretical usage ------------------------ */

await test("sales times the recipe give the expected draw on stock", async () => {
  await seed();
  const out = await report();
  /* 100 burgers × 100 g = 10 kg. */
  near(beefOf(out).theoreticalBase, 10000);
  near(beefOf(out).value.theoretical, 400);
});

await test("preparation yield is applied to the expectation too", async () => {
  await seed({ yieldPct: 50 });
  /* 100 g on the plate at 50% yield draws 200 g from the store. */
  near(beefOf(await report()).theoreticalBase, 20000);
});

await test("a batch recipe draws one portion's share per sale", async () => {
  await seed({ portions: 10, qty: 1000 });
  /* A batch of 1 kg makes 10 portions, so 100 sales draw 10 kg. */
  near(beefOf(await report()).theoreticalBase, 10000);
});

await test("packaging is left out of usage variance", async () => {
  await seed();
  const out = await report();
  assert.strictEqual(out.items.find((i) => i.ingredientId === "burger-bun"), undefined,
    "the bun is costed into the dish, not counted against the walk-in");
});

await test("the version in force at the end of the period is the one used", async () => {
  await seed();
  /* The chef doubles the patty today; a report for last week must not use it. */
  await rc.saveVersion("org1", {
    menuItem: "Cheeseburger", portions: 1, yieldPct: 100,
    lines: [{ ingredientId: "beef-mince", qty: 200, unit: "g" }],
  });
  near(beefOf(await report()).theoreticalBase, 20000);
  near(beefOf(await report({ to: Date.now() - DAY })).theoreticalBase, 10000);
});

await test("sales with no recipe are reported, never silently skipped", async () => {
  await seed();
  const out = await report({ salesRows: [...sold(100), ...sold(50, "Mystery wrap")] });
  near(beefOf(out).theoreticalBase, 10000);
  assert.strictEqual(out.quality.unmatched.length, 1);
  assert.strictEqual(out.quality.unmatched[0].name, "Mystery wrap");
  assert.strictEqual(out.quality.unmatched[0].reason, "norecipe");
  /* Two thirds of revenue is covered — 3000 of 4500. */
  near(out.quality.recipeCoverage, 2 / 3);
});

await test("an archived recipe stops explaining sales, and says so", async () => {
  await seed();
  await rc.archiveRecipe("org1", "cheeseburger");
  const out = await report();
  assert.strictEqual(out.quality.recipeCoverage, 0);
  assert.strictEqual(out.quality.unmatched[0].reason, "norecipe");
});

await test("a sale before the recipe's first version is unmatched, not costed", async () => {
  await seed();
  const out = await report({ to: Date.now() - 25 * DAY });
  assert.strictEqual(out.quality.unmatched[0].reason, "noversion");
});

/* ------------------------ actual usage --------------------------- */

await test("outgoing ledger entries make up the actual", async () => {
  await seed();
  await consume(12);
  const beef = beefOf(await report());
  near(beef.consumedBase, 12000);
  near(beef.actualBase, 12000);
  near(beef.varianceBase, 2000);
  near(beef.value.variance, 80);
  near(beef.variancePct, 20);
});

await test("waste explains part of the variance instead of hiding in it", async () => {
  await seed();
  await consume(10);
  await consume(2, "waste");
  const beef = beefOf(await report());
  near(beef.actualBase, 12000);
  near(beef.wasteBase, 2000);
  near(beef.varianceBase, 2000);
  /* All of it written down: nothing unexplained. */
  near(beef.unexplainedBase, 0);
  near(beef.value.waste, 80);
  near(beef.value.unexplained, 0);
});

await test("a count adjustment explains its own share", async () => {
  await seed();
  await consume(10);
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "adjust", qty: -3, unit: "kg", actor: "boss",
  });
  const beef = beefOf(await report());
  near(beef.adjustmentBase, 3000);
  near(beef.varianceBase, 3000);
  near(beef.unexplainedBase, 0);
});

await test("what nobody wrote down is the unexplained leak", async () => {
  await seed();
  await consume(15);
  await consume(1, "waste");
  const beef = beefOf(await report());
  near(beef.varianceBase, 6000);
  near(beef.wasteBase, 1000);
  /* 16 kg left, 10 was expected, 1 was written off: 5 kg is unaccounted for. */
  near(beef.unexplainedBase, 5000);
  near(beef.value.unexplained, 200);
});

await test("a transfer between branches invents no variance", async () => {
  await seed();
  await consume(10);
  await mv.recordTransfer("org1", {
    fromBranchId: "b1", toBranchId: "b2",
    ingredientId: "beef-mince", qty: 5, unit: "kg", actor: "boss",
  });
  /* The stock moved, it wasn't used. */
  near(beefOf(await report()).varianceBase, 0);
});

await test("a returned delivery isn't consumption either", async () => {
  await seed();
  await consume(10);
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "return_out", qty: 4, unit: "kg", actor: "storeman",
  });
  near(beefOf(await report()).varianceBase, 0);
});

await test("a reversed movement leaves no trace in the totals", async () => {
  await seed();
  await consume(10);
  const bad = await consume(7);
  await mv.reverseMovement("org1", "b1", bad.movement.id, { actor: "boss", reason: "keyed twice" });
  near(beefOf(await report()).varianceBase, 0);
});

await test("the period bounds both halves of the comparison", async () => {
  await seed();
  await consume(12);
  /* A window that closed before the consumption was recorded. */
  const out = await report({ from: Date.now() - 30 * DAY, to: Date.now() - DAY });
  near(beefOf(out).actualBase, 0);
});

await test("an ingredient the recipes expect but the ledger never issued still appears", async () => {
  await seed();
  const beef = beefOf(await report());
  near(beef.actualBase, 0);
  near(beef.varianceBase, -10000, 1);
  assert.strictEqual(beef.movements, 0, "usually this means consumption isn't being recorded");
});

/* ------------------------- money and scope ----------------------- */

await test("an unpriced ingredient gets a quantity variance and no money", async () => {
  await inv.saveIngredient("org1", { name: "Beef mince", stockUnit: "kg" });
  /* Received, but nobody keyed a price — the common real case. */
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "receive", qty: 100, unit: "kg", actor: "storeman",
  });
  await rc.saveVersion("org1", {
    menuItem: "Cheeseburger", portions: 1, yieldPct: 100, effectiveFrom: Date.now() - 20 * DAY,
    lines: [{ ingredientId: "beef-mince", qty: 100, unit: "g" }],
  });
  await consume(12);

  const out = await report();
  const beef = beefOf(out);
  near(beef.varianceBase, 2000);
  assert.strictEqual(beef.value.variance, null, "never zero — zero would look like no problem");
  assert.strictEqual(beef.priced, false);
  assert.strictEqual(out.quality.unpricedCount, 1);
  assert.strictEqual(out.totals.variance, 0, "an unknown value adds nothing rather than inventing one");
});

await test("the cost method carries through to the financial effect", async () => {
  await seed();
  /* A second, dearer delivery: last cost 80/kg, weighted average 60/kg. */
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "receive", qty: 100, unit: "kg", unitCost: 80,
  });
  await consume(12);
  near(beefOf(await report({ method: "wavg" })).value.variance, 120);
  near(beefOf(await report({ method: "last" })).value.variance, 160);
});

await test("totals roll up and the food-cost percentages come from the same sales", async () => {
  await seed();
  await consume(12);
  const out = await report();
  near(out.totals.theoretical, 400);
  near(out.totals.actual, 480);
  near(out.totals.unexplained, 80);
  near(out.totals.revenue, 3000);
  near(out.totals.theoreticalCostPct, 13.3, 0.1);
  near(out.totals.actualCostPct, 16, 0.1);
});

await test("rows are ranked by the money at stake", async () => {
  await seed();
  await inv.saveIngredient("org1", { name: "Cheese", stockUnit: "kg" });
  await mv.recordMovement("org1", "b1", { ingredientId: "cheese", type: "receive", qty: 50, unit: "kg", unitCost: 30 });
  await mv.recordMovement("org1", "b1", { ingredientId: "cheese", type: "consume", qty: 1, unit: "kg" });
  await consume(20);
  const out = await report();
  assert.strictEqual(out.items[0].ingredientId, "beef-mince",
    "10 kg of beef at 40 outranks 1 kg of cheese at 30");
});

await test("a branch's variance is its own, and the group's is the sum", async () => {
  await seed();
  await mv.recordMovement("org1", "b2", {
    ingredientId: "beef-mince", type: "receive", qty: 100, unit: "kg", unitCost: 40,
  });
  await consume(12, "consume", "b1");
  await consume(30, "consume", "b2");

  const one = await va.varianceReport("org1", ["b1"], { salesRows: sold(100, "Cheeseburger", "b1") });
  near(beefOf(one).actualBase, 12000);

  const both = await va.varianceReport("org1", ["b1", "b2"], {
    salesRows: [...sold(100, "Cheeseburger", "b1"), ...sold(100, "Cheeseburger", "b2")],
  });
  near(beefOf(both).actualBase, 42000);
  near(beefOf(both).theoreticalBase, 20000);
  /* And the split survives the consolidation. */
  near(beefOf(both).byBranch.b1.consumed, 12000);
  near(beefOf(both).byBranch.b2.consumed, 30000);
});

await test("another organization's ledger and recipes are invisible", async () => {
  await seed();
  await consume(12);
  const out = await va.varianceReport("org2", ["b1"], { salesRows: sold(100) });
  assert.deepStrictEqual(out.items, []);
  assert.strictEqual(out.quality.recipeCoverage, 0);
});

await test("the report says which period, branches and basis produced it", async () => {
  await seed();
  const from = Date.now() - 7 * DAY;
  const out = await va.varianceReport("org1", ["b1"], { salesRows: sold(10), from, method: "last" });
  assert.strictEqual(out.period.from, from);
  assert.strictEqual(out.method, "last");
  assert.deepStrictEqual(out.branches, ["b1"]);
});

await test("each row names the dishes that drove the expectation", async () => {
  await seed();
  await rc.saveVersion("org1", {
    menuItem: "Beef bowl", portions: 1, yieldPct: 100, effectiveFrom: Date.now() - 20 * DAY,
    lines: [{ ingredientId: "beef-mince", qty: 300, unit: "g" }],
  });
  const out = await report({ salesRows: [...sold(10), ...sold(10, "Beef bowl")] });
  const beef = beefOf(out);
  near(beef.theoreticalBase, 4000);
  assert.strictEqual(beef.drivers[0].name, "Beef bowl", "3 kg of it against 1 kg of burgers");
  near(beef.drivers[0].qtyBase, 3000);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
