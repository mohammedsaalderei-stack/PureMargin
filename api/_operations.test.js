/* Stage 5: operational forecasting.

   What these protect: a purchase line is a quantity with a range, a confidence
   grade and its assumptions; the rate comes from weekly buckets of real ledger
   usage; lead time extends the cover the order has to provide; a shelf that already
   covers the horizon is asked to buy nothing; volatile, short or stale data cannot
   produce high confidence; ingredients with no usage are named with a reason rather
   than dropped or ordered blind; transfers are not demand; and the branch ranking
   agrees with the leakage report it is built from. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");
const rc = await import("./_recipes.js");
const op = await import("./_operations.js");

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

const DAY = 864e5;
const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);
const lineFor = (plan, id = "beef-mince") => plan.lines.find((l) => l.ingredientId === id);

const now = Date.now();
const from = now - 28 * DAY;

/* A month of steady trading: 7 kg used in each of four weeks, on a shelf that
   received 40 kg at the start. */
async function seedSteady({ perWeek = [7, 7, 7, 7], received = 40, leadTimeDays = 0, packSize = 1 } = {}) {
  /* Lead time lives on the supplier, so an ingredient that needs one gets a
     merchant with that delivery time. */
  if (leadTimeDays > 0) await inv.saveSupplier("org1", { name: "Meat co", leadTimeDays });
  await inv.saveIngredient("org1", {
    name: "Beef mince", stockUnit: "kg", purchaseUnit: "kg", packSize,
    supplierId: leadTimeDays > 0 ? "meat-co" : "",
  });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "receive", qty: received, unit: "kg", unitCost: 40,
    at: from, actor: "storeman",
  });
  for (let week = 0; week < perWeek.length; week++) {
    if (perWeek[week] <= 0) continue;
    await mv.recordMovement("org1", "b1", {
      ingredientId: "beef-mince", type: "consume", qty: perWeek[week], unit: "kg",
      at: from + week * 7 * DAY + 2 * DAY, actor: "chef",
    });
  }
}

const plan = (over = {}) => op.purchasePlan("org1", ["b1"], { from, to: now, horizonDays: 7, ...over });

/* --------------------------- the rate --------------------------- */

await test("the usage rate comes from weekly buckets of real ledger entries", async () => {
  await seedSteady();
  const line = lineFor(await plan());
  /* 7 kg a week → 1 kg a day → 1000 g. */
  near(line.perDayBase, 1000, 5);
  assert.strictEqual(line.basis.weeksWithUsage, 4);
});

await test("a shelf that already covers the horizon is asked to buy nothing", async () => {
  await seedSteady({ received: 40 });
  /* 12 kg left, 7 days of cover needed at 1 kg/day. */
  const line = lineFor(await plan());
  assert.strictEqual(line.orderBase, 0);
  assert.strictEqual(line.packs, 0);
  near(line.coverDays, 12, 0.5);
});

await test("a thin shelf produces a quantity and a plausible range", async () => {
  await seedSteady({ received: 30 });
  const line = lineFor(await plan());
  /* 2 kg left, 7 kg needed for the week → 5 kg. */
  near(line.orderBase, 5000, 50);
  assert.ok(line.rangeBase.low <= line.orderBase && line.rangeBase.high >= line.orderBase,
    "the range must contain the recommendation");
});

await test("steady usage gives a tight range, erratic usage a wide one", async () => {
  await seedSteady({ perWeek: [7, 7, 7, 7], received: 30 });
  const steady = lineFor(await plan());
  __resetMemory();
  await seedSteady({ perWeek: [1, 13, 2, 12], received: 30 });
  const erratic = lineFor(await plan());
  const width = (l) => l.rangeBase.high - l.rangeBase.low;
  assert.ok(width(erratic) > width(steady), "spread has to reach the range");
});

await test("lead time extends the cover the order must provide", async () => {
  await seedSteady({ received: 30, leadTimeDays: 5 });
  const line = lineFor(await plan());
  /* 12 days of cover to buy now, minus 2 kg on hand → 10 kg. */
  near(line.orderBase, 10000, 100);
  assert.ok(line.assumptions.includes("leadTime"));
  assert.strictEqual(line.basis.leadDays, 5);
});

await test("stock inside its own lead time is urgent", async () => {
  await seedSteady({ received: 29, leadTimeDays: 3 });
  assert.strictEqual(lineFor(await plan()).urgent, true, "1 kg left, three days to deliver");
  __resetMemory();
  await seedSteady({ received: 40, leadTimeDays: 3 });
  assert.strictEqual(lineFor(await plan()).urgent, false);
});

await test("packs are rounded up and the rounding is declared", async () => {
  await seedSteady({ received: 30, packSize: 6 });
  const line = lineFor(await plan());
  /* 5 kg needed, 6 kg to a case → one case. */
  assert.strictEqual(line.packs, 1);
  assert.ok(line.assumptions.includes("packRounding"));
});

await test("a longer horizon asks for more", async () => {
  await seedSteady({ received: 30 });
  const week = lineFor(await plan({ horizonDays: 7 })).orderBase;
  const fortnight = lineFor(await plan({ horizonDays: 14 })).orderBase;
  assert.ok(fortnight > week);
});

/* ------------------------- confidence ---------------------------- */

await test("a month of steady usage earns high confidence", async () => {
  await seedSteady({ received: 30 });
  const line = lineFor(await plan());
  assert.strictEqual(line.confidence, "high");
  assert.deepStrictEqual(line.confidenceReasons, []);
});

await test("volatile usage cannot be high confidence", async () => {
  await seedSteady({ perWeek: [0.2, 14, 0.2, 14], received: 30 });
  const line = lineFor(await plan());
  assert.notStrictEqual(line.confidence, "high");
  assert.ok(line.confidenceReasons.includes("volatile"));
});

await test("one week of history is never high confidence, however tidy", async () => {
  await inv.saveIngredient("org1", { name: "Beef mince", stockUnit: "kg" });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "receive", qty: 30, unit: "kg", unitCost: 40, at: now - 6 * DAY,
  });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "consume", qty: 7, unit: "kg", at: now - 5 * DAY,
  });
  const line = lineFor(await op.purchasePlan("org1", ["b1"], { from: now - 6 * DAY, to: now }));
  assert.notStrictEqual(line.confidence, "high");
  assert.ok(line.confidenceReasons.includes("shortHistory"));
});

await test("stale sales are named as a reason and cost confidence", async () => {
  await seedSteady({ received: 30 });
  const line = lineFor(await plan({ stale: true }));
  assert.strictEqual(line.confidence, "medium");
  assert.ok(line.confidenceReasons.includes("staleSales"));
});

await test("the plan's own confidence is the weakest row's, not the best", async () => {
  await seedSteady({ received: 30 });
  await inv.saveIngredient("org1", { name: "Saffron", stockUnit: "g" });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "saffron", type: "receive", qty: 100, unit: "g", unitCost: 5, at: now - 3 * DAY,
  });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "saffron", type: "consume", qty: 10, unit: "g", at: now - 2 * DAY,
  });
  const out = await plan();
  assert.strictEqual(lineFor(out).confidence, "high");
  assert.notStrictEqual(out.confidence, "high", "a screen must not imply more than its weakest row");
});

await test("grading is explicit about what it lacks", () => {
  assert.strictEqual(op.gradeConfidence({ days: 30, weeksWithUsage: 4, cv: 0.1, stale: false }).level, "high");
  assert.strictEqual(op.gradeConfidence({ days: 30, weeksWithUsage: 4, cv: 0.9, stale: false }).level, "medium");
  const poor = op.gradeConfidence({ days: 3, weeksWithUsage: 1, cv: 1.4, stale: true });
  assert.strictEqual(poor.level, "low");
  assert.deepStrictEqual(poor.reasons, ["shortHistory", "fewWeeks", "volatile", "staleSales"]);
});

/* ------------------- what the plan refuses to do ----------------- */

await test("an ingredient with no recorded usage is named, not ordered blind", async () => {
  await inv.saveIngredient("org1", { name: "Beef mince", stockUnit: "kg" });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "receive", qty: 30, unit: "kg", unitCost: 40, at: from,
  });
  const out = await plan();
  assert.strictEqual(lineFor(out), undefined, "no rate, no recommendation");
  assert.deepStrictEqual(out.skipped, [{ ingredientId: "beef-mince", name: "Beef mince", reason: "nousage" }]);
});

await test("a transfer out is not demand", async () => {
  await seedSteady({ received: 40 });
  await mv.recordTransfer("org1", {
    fromBranchId: "b1", toBranchId: "b2", ingredientId: "beef-mince", qty: 5, unit: "kg", actor: "boss",
  });
  const line = lineFor(await plan());
  near(line.perDayBase, 1000, 5, "ordering for another branch's shelf");
});

await test("waste counts as demand, because it has to be replaced", async () => {
  await seedSteady({ perWeek: [7, 7, 7, 7], received: 40 });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "waste", qty: 7, unit: "kg", at: from + 3 * 7 * DAY + 3 * DAY,
  });
  assert.ok(lineFor(await plan()).perDayBase > 1000);
});

await test("the period, horizon and assumptions travel with the plan", async () => {
  await seedSteady({ received: 30 });
  const out = await plan({ horizonDays: 10 });
  assert.strictEqual(out.horizonDays, 10);
  assert.strictEqual(out.period.days, 28);
  assert.ok(lineFor(out).assumptions.includes("usageFromLedger"));
  assert.ok(lineFor(out).basis.weeklyMeanBase > 0);
});

await test("the most urgent line comes first", async () => {
  await seedSteady({ received: 40 });
  await inv.saveSupplier("org1", { name: "Greens", leadTimeDays: 2 });
  await inv.saveIngredient("org1", { name: "Tomato", stockUnit: "kg", supplierId: "greens" });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "tomato", type: "receive", qty: 8, unit: "kg", unitCost: 5, at: from,
  });
  for (let w = 0; w < 4; w++) {
    await mv.recordMovement("org1", "b1", {
      ingredientId: "tomato", type: "consume", qty: 2, unit: "kg", at: from + w * 7 * DAY + DAY,
    });
  }
  const out = await plan();
  assert.strictEqual(out.lines[0].ingredientId, "tomato", "hours of cover against a two-day lead time");
});

await test("another organization's ledger produces no plan here", async () => {
  await seedSteady({ received: 30 });
  const out = await op.purchasePlan("org2", ["b1"], { from, to: now });
  assert.deepStrictEqual(out.lines, []);
  assert.deepStrictEqual(out.skipped, []);
});

/* --------------------- the branch ranking ------------------------ */

async function seedTwoBranches() {
  await inv.saveIngredient("org1", { name: "Beef mince", stockUnit: "kg" });
  for (const branch of ["b1", "b2"]) {
    await mv.recordMovement("org1", branch, {
      ingredientId: "beef-mince", type: "receive", qty: 200, unit: "kg", unitCost: 40, at: from,
    });
  }
  await rc.saveVersion("org1", {
    menuItem: "Cheeseburger", portions: 1, yieldPct: 100, sellPrice: 30, effectiveFrom: from,
    lines: [{ ingredientId: "beef-mince", qty: 100, unit: "g" }],
  });
  /* Both sell 100 burgers (10 kg expected). b2 gets through 30 kg. */
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 11, unit: "kg", at: from + 10 * DAY });
  await mv.recordMovement("org1", "b2", { ingredientId: "beef-mince", type: "consume", qty: 30, unit: "kg", at: from + 10 * DAY });

  const sold = (branchId) => [{ branchId, name: "Cheeseburger", variant: "", qty: 100, revenue: 3000, lines: 100 }];
  return new Map([["b1", sold("b1")], ["b2", sold("b2")]]);
}

await test("the worst branch is ranked first and says why", async () => {
  const salesByBranch = await seedTwoBranches();
  const { rows } = await op.branchRanking("org1", ["b1", "b2"], { salesByBranch, from, to: now });
  assert.strictEqual(rows[0].branchId, "b2");
  near(rows[0].unexplained, 800, 1);
  near(rows[1].unexplained, 40, 1);
  assert.strictEqual(rows[0].drivers[0].name, "Beef mince", "the why, not just the what");
});

await test("each branch's food cost is its own sales against its own usage", async () => {
  const salesByBranch = await seedTwoBranches();
  const { rows } = await op.branchRanking("org1", ["b1", "b2"], { salesByBranch, from, to: now });
  const b2 = rows.find((r) => r.branchId === "b2");
  near(b2.actualCostPct, 40, 0.5);
  near(b2.overTarget, 10, 0.5, "against the 30% default target");
  near(b2.theoreticalCostPct, 13.3, 0.5);
});

await test("a single-branch scope is the same computation, one row", async () => {
  const salesByBranch = await seedTwoBranches();
  const { rows } = await op.branchRanking("org1", ["b1"], { salesByBranch, from, to: now });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].branchId, "b1");
});

await test("the ranking carries each branch's data quality", async () => {
  const salesByBranch = await seedTwoBranches();
  salesByBranch.set("b1", [
    ...salesByBranch.get("b1"),
    { branchId: "b1", name: "Mystery wrap", variant: "", qty: 100, revenue: 3000, lines: 100 },
  ]);
  const { rows } = await op.branchRanking("org1", ["b1", "b2"], { salesByBranch, from, to: now });
  near(rows.find((r) => r.branchId === "b1").recipeCoverage, 0.5, 0.01);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
