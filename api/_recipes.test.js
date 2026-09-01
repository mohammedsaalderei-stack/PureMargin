/* Stage 4, phase 5: cost basis, recipe versions, recipe cost and simulation.

   What these protect: last cost and weighted average are both real and both
   labelled, preparation yield draws more from stock than the dish contains,
   packaging is costed but kept out of food cost, an unpriced ingredient produces
   a reported gap rather than a flattering zero, a dated version costs a dated
   sale, and a simulation changes nothing. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");
const costing = await import("./_costing.js");
const rc = await import("./_recipes.js");

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

const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

const DAY = 864e5;

async function seed() {
  await inv.saveIngredient("org1", { name: "Beef mince", stockUnit: "kg" });
  await inv.saveIngredient("org1", { name: "Burger bun", stockUnit: "ea" });
  await inv.saveIngredient("org1", { name: "Takeaway box", stockUnit: "ea", category: "Packaging" });
}

/* A priced delivery into b1. */
const receive = (ingredientId, qty, unit, unitCost, branchId = "b1") =>
  mv.recordMovement("org1", branchId, {
    ingredientId, type: "receive", qty, unit, unitCost, actor: "storeman",
  });

/* Beef at 40/kg then 60/kg — last cost 60, weighted average 50. */
async function twoDeliveries() {
  await receive("beef-mince", 10, "kg", 40);
  await receive("beef-mince", 10, "kg", 60);
}

/* ------------------------- cost basis ---------------------------- */

await test("last cost and weighted average are both derived from the ledger", async () => {
  await seed();
  await twoDeliveries();
  const basis = await costing.costBasis("org1", ["b1"]);
  near(costing.costFrom(basis, "beef-mince", "last"), 60 / 1000);
  near(costing.costFrom(basis, "beef-mince", "wavg"), 50 / 1000);
  assert.strictEqual(costing.evidenceFor(basis, "beef-mince").receipts, 2);
});

await test("weighted average weights by quantity, not by delivery", async () => {
  await seed();
  await receive("beef-mince", 30, "kg", 40);
  await receive("beef-mince", 10, "kg", 80);
  /* (30×40 + 10×80) / 40 = 50, not the 60 a plain mean would give. */
  const basis = await costing.costBasis("org1", ["b1"]);
  near(costing.costFrom(basis, "beef-mince", "wavg"), 50 / 1000);
});

await test("an ingredient never received priced has no cost, not zero", async () => {
  await seed();
  const basis = await costing.costBasis("org1", ["b1"]);
  assert.strictEqual(costing.costFrom(basis, "beef-mince", "wavg"), null);
});

await test("issues and waste don't vote on cost, and reversals drop out", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);
  /* An issue carries an inherited cost; counting it would double the delivery. */
  await mv.recordMovement("org1", "b1", { ingredientId: "beef-mince", type: "issue", qty: 2, unit: "kg", unitCost: 999 });
  let basis = await costing.costBasis("org1", ["b1"]);
  near(costing.costFrom(basis, "beef-mince", "wavg"), 40 / 1000);

  const bad = await receive("beef-mince", 10, "kg", 900);
  await mv.reverseMovement("org1", "b1", bad.movement.id, { actor: "boss", reason: "keying error" });
  basis = await costing.costBasis("org1", ["b1"]);
  near(costing.costFrom(basis, "beef-mince", "wavg"), 40 / 1000, 1e-9);
});

await test("a cost basis is bounded by the period asked for", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);
  const basis = await costing.costBasis("org1", ["b1"], { to: Date.now() - DAY });
  assert.strictEqual(costing.costFrom(basis, "beef-mince", "wavg"), null,
    "a delivery that hadn't happened yet can't price last month");
});

await test("cost is local to the branches asked about", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40, "b1");
  await receive("beef-mince", 10, "kg", 90, "b2");
  near(costing.costFrom(await costing.costBasis("org1", ["b1"]), "beef-mince", "wavg"), 40 / 1000);
  near(costing.costFrom(await costing.costBasis("org1", ["b2"]), "beef-mince", "wavg"), 90 / 1000);
  /* An owner looking at both sees them pooled. */
  near(costing.costFrom(await costing.costBasis("org1", ["b1", "b2"]), "beef-mince", "wavg"), 65 / 1000);
});

/* --------------------------- versions ---------------------------- */

const burger = (over = {}) => ({
  menuItem: "Cheeseburger", portions: 1, yieldPct: 100, sellPrice: 30, actor: "chef",
  lines: [
    { ingredientId: "beef-mince", qty: 150, unit: "g" },
    { ingredientId: "burger-bun", qty: 1, unit: "ea" },
  ],
  packaging: [{ ingredientId: "takeaway-box", qty: 1, unit: "ea" }],
  ...over,
});

await test("saving a recipe twice appends a version instead of overwriting", async () => {
  await seed();
  const first = await rc.saveVersion("org1", burger());
  assert.strictEqual(first.created, true);
  const second = await rc.saveVersion("org1", burger({ portions: 2 }));
  assert.strictEqual(second.created, false);
  assert.strictEqual(second.recipe.versions.length, 2);
  assert.strictEqual(second.recipe.versions[0].portions, 1, "the first version is untouched");
});

await test("bad recipes are refused by field name", async () => {
  await seed();
  const bad = async (over) => (await rc.saveVersion("org1", burger(over))).error;
  assert.strictEqual(await bad({ menuItem: "" }), "menuItem");
  assert.strictEqual(await bad({ portions: 0 }), "portions");
  assert.strictEqual(await bad({ yieldPct: 0 }), "yieldPct");
  assert.strictEqual(await bad({ yieldPct: 140 }), "yieldPct");
  assert.strictEqual(await bad({ lines: [] }), "nolines");
  /* A line with no way to name an ingredient at all — no id that resolves and
     no name to create one from — is still refused. An unknown *name* is not:
     that is the decoupling, and it has its own test below. */
  assert.strictEqual(await bad({ lines: [{ qty: 1 }] }), "ingredientId");
  assert.strictEqual(await bad({ lines: [{ ingredientId: "beef-mince", qty: 0 }] }), "qty");
  assert.strictEqual(await bad({ lines: [{ ingredientId: "beef-mince", qty: 1, unit: "l" }] }), "unit");
  assert.strictEqual(await bad({
    lines: [{ ingredientId: "beef-mince", qty: 1 }, { ingredientId: "beef-mince", qty: 2 }],
  }), "duplicate");
});

await test("the effective version is the newest one already in force", async () => {
  await seed();
  const now = Date.now();
  await rc.saveVersion("org1", burger({ effectiveFrom: now - 30 * DAY, portions: 1 }));
  await rc.saveVersion("org1", burger({ effectiveFrom: now - 2 * DAY, portions: 4 }));
  await rc.saveVersion("org1", burger({ effectiveFrom: now + 30 * DAY, portions: 9 }));
  const recipe = await rc.getRecipe("org1", "cheeseburger");

  assert.strictEqual(rc.effectiveVersion(recipe, now).portions, 4);
  assert.strictEqual(rc.effectiveVersion(recipe, now - 10 * DAY).portions, 1);
  assert.strictEqual(rc.effectiveVersion(recipe, now + 40 * DAY).portions, 9);
  assert.strictEqual(rc.effectiveVersion(recipe, now - 60 * DAY), null,
    "before the first version there is no recipe to cost with");
});

await test("a back-dated version slots into history rather than on top of it", async () => {
  await seed();
  const now = Date.now();
  /* Explicit rather than defaulted. Leaving saveVersion to stamp its own
     `effectiveFrom` made this race the clock: if a millisecond passed between
     `now` above and the write, the new version was dated after `now` and the
     assertion below found the back-dated one instead. Failed roughly one run
     in three, which is the worst frequency — often enough to erode trust in
     the suite, rare enough to be dismissed as a fluke. */
  await rc.saveVersion("org1", burger({ effectiveFrom: now, portions: 4 }));
  await rc.saveVersion("org1", burger({ effectiveFrom: now - 10 * DAY, portions: 1 }));
  const recipe = await rc.getRecipe("org1", "cheeseburger");
  assert.strictEqual(rc.effectiveVersion(recipe, now).portions, 4);
  assert.strictEqual(rc.effectiveVersion(recipe, now - 5 * DAY).portions, 1);
});

/* -------------------------- recipe cost -------------------------- */

await test("a recipe costs its lines through unit conversion", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);   // 0.04 / g
  await receive("burger-bun", 100, "ea", 1);
  await rc.saveVersion("org1", burger());

  const out = await rc.costedRecipe("org1", "cheeseburger", ["b1"]);
  /* 150 g at 0.04 = 6, plus a bun at 1. */
  near(out.costing.perPortion.foodCost, 7);
  assert.strictEqual(out.costing.complete, false, "the box is still unpriced");
});

await test("preparation yield draws more from stock than the dish contains", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);
  await receive("burger-bun", 100, "ea", 1);
  /* 75% yield: 150 g of cooked patty needs 200 g of raw mince. */
  await rc.saveVersion("org1", burger({ yieldPct: 75 }));

  const out = await rc.costedRecipe("org1", "cheeseburger", ["b1"]);
  const beef = out.costing.lines.find((l) => l.ingredientId === "beef-mince");
  near(beef.drawBase, 200);
  near(beef.cost, 8);
  /* The bun is drawn at yield too — it is a food line in this recipe. */
  near(out.costing.perPortion.foodCost, 8 + 1 / 0.75, 1e-3);
});

await test("packaging is costed but kept out of food cost, and ignores yield", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);
  await receive("burger-bun", 100, "ea", 1);
  await receive("takeaway-box", 100, "ea", 0.5);
  await rc.saveVersion("org1", burger({ yieldPct: 50 }));

  const out = await rc.costedRecipe("org1", "cheeseburger", ["b1"]);
  const box = out.costing.packaging[0];
  near(box.drawBase, 1, 1e-9);   // trimming beef doesn't waste boxes
  near(out.costing.perPortion.packagingCost, 0.5);
  near(out.costing.perPortion.foodCost, 12 + 2);
  near(out.costing.perPortion.total, 14.5);
  assert.strictEqual(out.costing.complete, true);
});

await test("a batch recipe divides by its portions", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);
  await receive("burger-bun", 100, "ea", 1);
  await receive("takeaway-box", 100, "ea", 0.5);
  await rc.saveVersion("org1", burger({
    portions: 10,
    lines: [{ ingredientId: "beef-mince", qty: 1.5, unit: "kg" }],
    packaging: [{ ingredientId: "takeaway-box", qty: 10, unit: "ea" }],
  }));

  const out = await rc.costedRecipe("org1", "cheeseburger", ["b1"]);
  near(out.costing.batch.foodCost, 60);
  near(out.costing.perPortion.foodCost, 6);
  near(out.costing.perPortion.packagingCost, 0.5);
});

await test("an unpriced ingredient is reported, not costed at zero", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);
  await rc.saveVersion("org1", burger());

  const out = await rc.costedRecipe("org1", "cheeseburger", ["b1"]);
  assert.strictEqual(out.costing.complete, false);
  near(out.costing.coverage, 1 / 3, 1e-3);
  assert.deepStrictEqual(out.costing.unpriced.map((u) => u.ingredientId), ["burger-bun", "takeaway-box"]);
  /* The beef is still costed — a partial cost is a lower bound, and saying so is
     more useful than refusing to answer. */
  near(out.costing.perPortion.foodCost, 6);
});

await test("the cost method changes the answer and is stated with it", async () => {
  await seed();
  await twoDeliveries();
  await rc.saveVersion("org1", burger({ lines: [{ ingredientId: "beef-mince", qty: 100, unit: "g" }] }));

  const wavg = await rc.costedRecipe("org1", "cheeseburger", ["b1"], { method: "wavg" });
  const last = await rc.costedRecipe("org1", "cheeseburger", ["b1"], { method: "last" });
  near(wavg.costing.perPortion.foodCost, 5);
  near(last.costing.perPortion.foodCost, 6);
  assert.strictEqual(wavg.costing.method, "wavg");
  assert.strictEqual(last.costing.method, "last");
});

await test("a dated sale is costed with the recipe and prices of its own period", async () => {
  await seed();
  const now = Date.now();
  await receive("beef-mince", 10, "kg", 40);
  await rc.saveVersion("org1", burger({
    effectiveFrom: now - 10 * DAY,
    lines: [{ ingredientId: "beef-mince", qty: 100, unit: "g" }],
    packaging: [],
  }));
  /* The chef doubles the portion today; last week's cost must not move. */
  await rc.saveVersion("org1", burger({
    lines: [{ ingredientId: "beef-mince", qty: 200, unit: "g" }],
    packaging: [],
  }));

  const today = await rc.costedRecipe("org1", "cheeseburger", ["b1"]);
  const lastWeek = await rc.costedRecipe("org1", "cheeseburger", ["b1"], { at: now - 5 * DAY });
  /* Today's version draws 200 g; the version in force last week drew 100 g, and
     asking about last week must not apply today's portion to it. */
  near(today.costing.lines[0].drawBase, 200);
  near(lastWeek.costing.lines[0].drawBase, 100);
  near(today.costing.perPortion.foodCost, 8);
  /* Last week's cost basis has no delivery behind it yet, and says so rather
     than borrowing today's price. */
  assert.strictEqual(lastWeek.costing.complete, false);
});

await test("margin is measured against the selling price, or reported as unknown", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);
  await receive("burger-bun", 100, "ea", 1);
  await receive("takeaway-box", 100, "ea", 0.5);
  await rc.saveVersion("org1", burger({ sellPrice: 30 }));

  const out = await rc.costedRecipe("org1", "cheeseburger", ["b1"]);
  near(out.margin.cost, 7.5);
  near(out.margin.profit, 22.5);
  near(out.margin.costPct, 25);
  near(out.margin.marginPct, 75);

  assert.strictEqual(rc.marginFor(0, 7.5), null);
  assert.strictEqual(rc.marginFor(30, null), null);
});

/* ---------------------------- listing ---------------------------- */

await test("the list costs every recipe and carries its data quality", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);
  await receive("burger-bun", 100, "ea", 1);
  await rc.saveVersion("org1", burger({ packaging: [] }));
  await rc.saveVersion("org1", {
    menuItem: "Bun on its own", portions: 1, yieldPct: 100,
    lines: [{ ingredientId: "burger-bun", qty: 1, unit: "ea" }],
  });

  const list = await rc.costedList("org1", ["b1"]);
  assert.deepStrictEqual(list.map((r) => r.menuItem), ["Bun on its own", "Cheeseburger"]);
  const bun = list.find((r) => r.id === "bun-on-its-own");
  assert.strictEqual(bun.complete, true);
  assert.strictEqual(list.find((r) => r.id === "cheeseburger").complete, true);
});

await test("archived recipes leave the list but stay resolvable", async () => {
  await seed();
  await rc.saveVersion("org1", burger());
  await rc.archiveRecipe("org1", "cheeseburger");

  assert.strictEqual((await rc.costedList("org1", ["b1"])).length, 0);
  assert.strictEqual((await rc.costedList("org1", ["b1"], { includeArchived: true })).length, 1);
  assert.ok(await rc.getRecipe("org1", "cheeseburger"), "past sales were costed with this");
});

await test("one organization's recipes are unreachable from another", async () => {
  await seed();
  await rc.saveVersion("org1", burger());
  assert.strictEqual(await rc.getRecipe("org2", "cheeseburger"), null);
  assert.deepStrictEqual(await rc.costedList("org2", ["b1"]), []);
});

/* -------------------------- simulation --------------------------- */

await test("a price simulation shows the effect and writes nothing", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);
  await rc.saveVersion("org1", burger({
    lines: [{ ingredientId: "beef-mince", qty: 100, unit: "g" }], packaging: [], sellPrice: 20,
  }));

  /* Beef goes from 40/kg to 60/kg. */
  const out = await rc.simulate("org1", "cheeseburger", ["b1"], {
    costOverrides: { "beef-mince": 60 / 1000 },
  });
  near(out.before.perPortion.total, 4);
  near(out.after.perPortion.total, 6);
  near(out.delta.perPortion, 2);
  near(out.before.margin.marginPct, 80);
  near(out.after.margin.marginPct, 70);
  near(out.delta.marginPct, -10);

  /* And the real figure is untouched. */
  near((await rc.costedRecipe("org1", "cheeseburger", ["b1"])).costing.perPortion.total, 4);
});

await test("a portion change and a price change can be modelled together", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);
  await rc.saveVersion("org1", burger({
    lines: [{ ingredientId: "beef-mince", qty: 100, unit: "g" }], packaging: [], sellPrice: 20,
  }));

  const out = await rc.simulate("org1", "cheeseburger", ["b1"], {
    qtyOverrides: { "beef-mince": 150 },
    sellPrice: 25,
  });
  near(out.after.perPortion.total, 6);
  near(out.after.margin.marginPct, 76);
});

await test("a batch simulation can change the number of portions", async () => {
  await seed();
  await receive("beef-mince", 10, "kg", 40);
  await rc.saveVersion("org1", burger({
    portions: 10, lines: [{ ingredientId: "beef-mince", qty: 1, unit: "kg" }], packaging: [],
  }));

  const out = await rc.simulate("org1", "cheeseburger", ["b1"], { portions: 8 });
  near(out.before.perPortion.total, 4);
  near(out.after.perPortion.total, 5);
});

await test("a simulation on a recipe with no effective version says nothing rather than guessing", async () => {
  await seed();
  await rc.saveVersion("org1", burger({ effectiveFrom: Date.now() + 10 * DAY }));
  assert.strictEqual(await rc.simulate("org1", "cheeseburger", ["b1"]), null);
  assert.strictEqual(await rc.simulate("org1", "ghost", ["b1"]), null);
});

/* ------------- recipes decoupled from the item master ------------ */

/* The whole point of the decoupling: a chef writes down a dish naming things
   the store has never received, and it saves. Before this, every one of these
   lines came back `{ error: "ingredientId" }` and the screen said the item was
   not in inventory — so the recipe could not be written until the inventory
   had been done, which is backwards from how a menu is planned. */

await test("a recipe naming ingredients that do not exist creates them and saves", async () => {
  const out = await rc.saveVersion("org1", {
    menuItem: "Shawarma wrap", portions: 1, yieldPct: 100, sellPrice: 22,
    lines: [
      { name: "Chicken thigh", qty: 180, unit: "g", estimatedCost: 0.0228 },
      { name: "Flatbread", qty: 1, unit: "ea", estimatedCost: 1.2 },
      { name: "Garlic sauce", qty: 30, unit: "ml", estimatedCost: 0.014 },
    ],
  });

  assert.strictEqual(out.error, undefined);
  assert.strictEqual(out.recipe.versions.length, 1);
  assert.deepStrictEqual(
    out.newIngredients.map((i) => i.id).sort(),
    ["chicken-thigh", "flatbread", "garlic-sauce"],
  );

  /* Created for real, in the unit the recipe stated — not a placeholder the
     rest of the app has to know about. */
  const chicken = await inv.getIngredient("org1", "chicken-thigh");
  assert.strictEqual(chicken.stockUnit, "g");
  assert.strictEqual(chicken.dimension, "mass");
  const sauce = await inv.getIngredient("org1", "garlic-sauce");
  assert.strictEqual(sauce.stockUnit, "ml");
  assert.strictEqual(sauce.dimension, "volume");
});

await test("the same ingredient named twice across recipes is one ingredient", async () => {
  await rc.saveVersion("org1", {
    menuItem: "Wrap", portions: 1, yieldPct: 100,
    lines: [{ name: "Olive oil", qty: 10, unit: "ml", estimatedCost: 0.02 }],
  });
  const second = await rc.saveVersion("org1", {
    menuItem: "Salad", portions: 1, yieldPct: 100,
    lines: [{ name: "OLIVE OIL", qty: 5, unit: "ml" }],
  });

  assert.deepStrictEqual(second.newIngredients, []);
  assert.strictEqual((await inv.listIngredients("org1")).length, 1);
  assert.strictEqual(second.version.lines[0].ingredientId, "olive-oil");
});

await test("a chef's estimate costs the recipe until a real delivery replaces it", async () => {
  /* 22.80 a kilo, stated per gram because that is the base unit. */
  await rc.saveVersion("org1", {
    menuItem: "Steak", portions: 1, yieldPct: 100, sellPrice: 90,
    lines: [{ name: "Sirloin", qty: 200, unit: "g", estimatedCost: 0.0228 }],
  });

  const onEstimate = await rc.costedRecipe("org1", "steak", ["b1"]);
  near(onEstimate.costing.perPortion.total, 4.56);
  /* Complete — but complete on an estimate, and it says so. Conflating the two
     would let a menu decision rest on a number nobody has paid. */
  assert.strictEqual(onEstimate.costing.complete, true);
  assert.strictEqual(onEstimate.costing.estimatedCount, 1);
  assert.strictEqual(onEstimate.costing.lines[0].estimated, true);

  /* One real invoice at 30/kg, and the estimate stops mattering — with nobody
     having to go and clear it out. */
  await receive("sirloin", 5, "kg", 30);
  const onInvoice = await rc.costedRecipe("org1", "steak", ["b1"]);
  near(onInvoice.costing.perPortion.total, 6);
  assert.strictEqual(onInvoice.costing.estimatedCount, 0);
  assert.strictEqual(onInvoice.costing.lines[0].estimated, false);
});

await test("an ingredient with neither an estimate nor a delivery is still an honest gap", async () => {
  /* The decoupling must not become a licence to invent numbers. No estimate
     given, no delivery received: the cost is null and the recipe is incomplete,
     exactly as before. */
  await rc.saveVersion("org1", {
    menuItem: "Mystery", portions: 1, yieldPct: 100,
    lines: [{ name: "Saffron", qty: 1, unit: "g" }],
  });

  const out = await rc.costedRecipe("org1", "mystery", ["b1"]);
  assert.strictEqual(out.costing.complete, false);
  assert.strictEqual(out.costing.lines[0].cost, null);
  assert.deepStrictEqual(out.costing.unpriced.map((u) => u.id ?? u.ingredientId), ["saffron"]);
});

await test("a recipe reviving an archived ingredient does not duplicate it", async () => {
  await inv.saveIngredient("org1", { name: "Butter", stockUnit: "g" });
  await inv.archiveIngredient("org1", "butter");

  const out = await rc.saveVersion("org1", {
    menuItem: "Croissant", portions: 1, yieldPct: 100,
    lines: [{ name: "Butter", qty: 40, unit: "g" }],
  });

  assert.deepStrictEqual(out.newIngredients, []);
  const butter = await inv.getIngredient("org1", "butter");
  assert.strictEqual(butter.archived, false);
  assert.strictEqual((await inv.listIngredients("org1", { includeArchived: true })).length, 1);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
