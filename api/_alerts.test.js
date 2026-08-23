/* Stage 4, phase 7: targets, thresholds and alerts.

   What these protect: every alert names the threshold it crossed and carries one
   recommended action, thresholds are the owner's and are bounded when saved,
   nothing is forecast from a usage rate that doesn't exist, severity ranks by money
   rather than by novelty, a small percentage variance on a cheap ingredient stays
   quiet, and one organization's thresholds and stock never reach another's. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");
const rc = await import("./_recipes.js");
const al = await import("./_alerts.js");

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
const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);
const kindOf = (out, kind) => out.alerts.filter((a) => a.kind === kind);
const one = (out, kind) => {
  const found = kindOf(out, kind);
  assert.strictEqual(found.length, 1, `expected one ${kind}, got ${found.length}`);
  return found[0];
};

const sold = (qty, name = "Cheeseburger") =>
  [{ branchId: "b1", name, variant: "", qty, revenue: qty * 30, lines: qty }];

const build = (over = {}) =>
  al.buildAlerts("org1", ["b1"], { salesRows: sold(100), from: Date.now() - 30 * DAY, ...over });

/* A kitchen with one ingredient and one dish, priced, so money is real. */
async function seed({ received = 100, reorderPoint = null, shelfLifeDays = null } = {}) {
  await inv.saveIngredient("org1", { name: "Beef mince", stockUnit: "kg", reorderPoint, shelfLifeDays });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "receive", qty: received, unit: "kg", unitCost: 40, actor: "storeman",
  });
  await rc.saveVersion("org1", {
    menuItem: "Cheeseburger", portions: 1, yieldPct: 100, sellPrice: 30,
    effectiveFrom: Date.now() - 20 * DAY,
    lines: [{ ingredientId: "beef-mince", qty: 100, unit: "g" }],
  });
}

/* --------------------------- targets ----------------------------- */

await test("targets start at ordinary practice and every one is editable", async () => {
  const t = await al.getTargets("org1");
  assert.strictEqual(t.foodCostPct, 30);
  assert.strictEqual(t.coverDays, 7);
  const saved = await al.saveTargets("org1", { foodCostPct: 26, coverDays: 3 });
  assert.strictEqual(saved.foodCostPct, 26);
  assert.strictEqual(saved.coverDays, 3);
  assert.strictEqual((await al.getTargets("org1")).foodCostPct, 26);
});

await test("a nonsense threshold is refused, not stored", async () => {
  await al.saveTargets("org1", { foodCostPct: 0, coverDays: 5000, variancePct: -3 });
  const t = await al.getTargets("org1");
  assert.strictEqual(t.foodCostPct, 30, "0% food cost would alert on everything forever");
  assert.strictEqual(t.coverDays, 7, "5000 days of cover is not a threshold");
  assert.strictEqual(t.variancePct, 5);
});

await test("one organization's thresholds are invisible to another", async () => {
  await al.saveTargets("org1", { foodCostPct: 22 });
  assert.strictEqual((await al.getTargets("org2")).foodCostPct, 30);
});

/* ------------------------- costing target ------------------------ */

await test("food cost over target reports the gap and what closing it is worth", async () => {
  await seed();
  /* 100 burgers → 3000 in sales, 10 kg expected. 30 kg actually issued at 40 =
     1200, which is 40% of sales against a 30% target. */
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 30, unit: "kg" });
  const alert = one(await build(), "foodcost");
  near(alert.actualPct, 40);
  assert.strictEqual(alert.targetPct, 30);
  near(alert.value, 300, 1);
  assert.strictEqual(alert.action, "reviewPricing");
});

await test("food cost inside target says nothing", async () => {
  await seed();
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 10, unit: "kg" });
  assert.deepStrictEqual(kindOf(await build(), "foodcost"), []);
});

await test("a food-cost breach carries the recipe coverage behind it", async () => {
  await seed();
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 90, unit: "kg" });
  /* Half the revenue has no recipe, so 3600 of cost sits against 6000 of sales. */
  const alert = one(await build({ salesRows: [...sold(100), ...sold(100, "Mystery wrap")] }), "foodcost");
  near(alert.coverage, 0.5, 0.01);
});

/* ----------------------- unusual variance ------------------------ */

await test("unexplained variance past both thresholds names the money and the target", async () => {
  await seed();
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 20, unit: "kg" });
  const alert = one(await build(), "variance");
  assert.strictEqual(alert.subject, "Beef mince");
  near(alert.value, 400, 1);
  near(alert.pct, 100);
  assert.strictEqual(alert.severity, "critical");
  assert.strictEqual(alert.action, "investigateUsage");
});

await test("a variance too small to matter in money stays quiet", async () => {
  await seed();
  /* 10.5 kg against 10 expected: 5% over, but only 20 of money. */
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 10.5, unit: "kg" });
  assert.deepStrictEqual(kindOf(await build(), "variance"), []);
});

await test("waste that explains itself doesn't become a variance alert", async () => {
  await seed();
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 10, unit: "kg" });
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "waste", qty: 10, unit: "kg" });
  assert.deepStrictEqual(kindOf(await build(), "variance"), [],
    "it is written down, so it is known — not unexplained");
});

await test("the owner's own variance tolerance is what's applied", async () => {
  await seed();
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 20, unit: "kg" });
  const quiet = await build({ targets: { ...al.TARGET_DEFAULTS, variancePct: 200 } });
  assert.deepStrictEqual(kindOf(quiet, "variance"), []);
});

/* --------------------------- stock ------------------------------- */

await test("days of cover come from recorded usage and give a run-out date", async () => {
  await seed({ received: 100 });
  /* 90 kg out over 30 days = 3 kg/day, 10 kg left → 3.3 days of cover. */
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 90, unit: "kg" });
  const alert = one(await build(), "stockout");
  near(alert.coverDays, 3.3, 0.1);
  assert.strictEqual(alert.targetDays, 7);
  assert.ok(alert.runsOutAt > Date.now(), "a date, not just a number");
  near(alert.basis.perDayBase, 3000, 1);
  assert.strictEqual(alert.action, "orderNow");
});

await test("plenty of cover raises nothing", async () => {
  await seed({ received: 1000 });
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 30, unit: "kg" });
  assert.deepStrictEqual(kindOf(await build(), "stockout"), []);
});

await test("a day or less of cover is critical, not a warning", async () => {
  await seed({ received: 91 });
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 90, unit: "kg" });
  assert.strictEqual(one(await build(), "stockout").severity, "critical");
});

await test("no recorded usage means no forecast — the gap is the finding", async () => {
  await seed({ received: 100, reorderPoint: 10 });
  const out = await build({ salesRows: [] });
  assert.deepStrictEqual(kindOf(out, "stockout"), [], "never invent a rate");
  const alert = one(out, "norate");
  assert.strictEqual(alert.days, 30);
  assert.strictEqual(alert.action, "recordIssues");
});

await test("below the reorder point names the point and the par level", async () => {
  await seed({ received: 5, reorderPoint: 10 });
  await inv.saveIngredient("org1", { name: "Beef mince", stockUnit: "kg", reorderPoint: 10, parLevel: 40 });
  const alert = one(await build({ salesRows: [] }), "reorder");
  near(alert.qty, 5);
  assert.strictEqual(alert.reorderPoint, 10);
  assert.strictEqual(alert.parLevel, 40);
  assert.strictEqual(alert.action, "reorder");
});

await test("negative stock is critical and asks for a count, not an order", async () => {
  await inv.saveIngredient("org1", { name: "Beef mince", stockUnit: "kg" });
  await mv.savePolicy("org1", { allowNegative: true });
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 4, unit: "kg" });
  const alert = one(await build({ salesRows: [] }), "negative");
  assert.strictEqual(alert.severity, "critical");
  assert.strictEqual(alert.action, "countStock");
  assert.deepStrictEqual(kindOf(await build({ salesRows: [] }), "stockout"), [],
    "an impossible balance is a data problem, not a purchasing one");
});

await test("stock nobody has touched for months is dead money", async () => {
  await seed({ received: 20 });
  const out = await build({ salesRows: [], targets: { ...al.TARGET_DEFAULTS, slowMovingDays: 0 } });
  const alert = one(out, "slowmoving");
  assert.strictEqual(alert.severity, "info");
  assert.strictEqual(alert.action, "reduceHolding");
});

await test("approaching expiry is flagged as an estimate, from shelf life", async () => {
  await seed({ received: 20, shelfLifeDays: 3 });
  const alert = one(await build({ salesRows: [] }), "expiry");
  assert.strictEqual(alert.estimated, true, "inferred from the last delivery, not a batch date");
  assert.strictEqual(alert.shelfLifeDays, 3);
  assert.strictEqual(alert.action, "useFirst");
});

await test("an ingredient with no shelf life set is never guessed at", async () => {
  await seed({ received: 20 });
  assert.deepStrictEqual(kindOf(await build({ salesRows: [] }), "expiry"), []);
});

/* ------------------------ ranking and shape ---------------------- */

await test("every alert carries a kind, a threshold and one action", async () => {
  await seed({ received: 100, reorderPoint: 500, shelfLifeDays: 2 });
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 90, unit: "kg" });
  const out = await build();
  assert.ok(out.alerts.length >= 3);
  for (const a of out.alerts) {
    assert.ok(al.ALERT_KINDS[a.kind], `${a.kind} is not a declared kind`);
    assert.ok(a.action, "an alert with no recommended action is just a number");
    assert.ok(["critical", "warning", "info"].includes(a.severity));
    assert.strictEqual(typeof a.id, "string");
  }
});

await test("the worst money comes first", async () => {
  await seed({ received: 100 });
  await inv.saveIngredient("org1", { name: "Parsley", stockUnit: "kg" });
  await mv.recordMovement("org1", "b1", { ingredientId: "parsley", type: "receive", qty: 10, unit: "kg", unitCost: 5 });
  await rc.saveVersion("org1", {
    menuItem: "Cheeseburger", portions: 1, yieldPct: 100, sellPrice: 30, effectiveFrom: Date.now() - 20 * DAY,
    lines: [{ ingredientId: "beef-mince", qty: 100, unit: "g" }, { ingredientId: "parsley", qty: 10, unit: "g" }],
  });
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 30, unit: "kg" });
  await mv.recordMovement("org1", "b1", { ingredientId: "parsley", type: "consume", qty: 8, unit: "kg" });
  const variances = kindOf(await build(), "variance");
  assert.strictEqual(variances[0].subject, "Beef mince", "800 of beef outranks 35 of parsley");
});

await test("the counts and the period travel with the list", async () => {
  await seed({ received: 100 });
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "consume", qty: 90, unit: "kg" });
  const out = await build();
  assert.strictEqual(out.counts.critical + out.counts.warning + out.counts.info, out.alerts.length);
  assert.strictEqual(out.period.days, 30);
  assert.ok(out.quality, "an empty list has two meanings; data quality says which");
});

await test("no wording is baked into an alert", async () => {
  await seed({ received: 5, reorderPoint: 10 });
  const alert = one(await build({ salesRows: [] }), "reorder");
  /* Names and units are data the operator typed; everything else must be a key. */
  const { subject, unit, ingredientId, ...rest } = alert;
  for (const value of Object.values(rest)) {
    assert.ok(!(typeof value === "string" && value.includes(" ")),
      "a sentence in the payload is a bug in three languages");
  }
});

await test("another organization's stock raises no alerts here", async () => {
  await seed({ received: 5, reorderPoint: 10 });
  const out = await al.buildAlerts("org2", ["b1"], { salesRows: sold(100) });
  assert.deepStrictEqual(out.alerts, []);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
