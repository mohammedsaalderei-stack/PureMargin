/* Stage 4, phase 1: units, conversions, and the ingredient/supplier master.

   The document is explicit that production acceptance must verify rounding and
   unit conversions, because a wrong conversion doesn't fail — it produces a
   plausible food cost that is out by a factor of a thousand. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const { convert, toBase, fromBase, costPerBase, sameDimension, isUnit } = await import("./_units.js");
const inv = await import("./_inventory.js");

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

/* ----------------------------- units ----------------------------- */

await test("mass conversions are exact where they should be", async () => {
  near(convert(1, "kg", "g"), 1000);
  near(convert(2500, "g", "kg"), 2.5);
  near(convert(1, "lb", "g"), 453.59237);
  near(convert(16, "oz", "lb"), 1);
});

await test("volume conversions are exact where they should be", async () => {
  near(convert(1, "l", "ml"), 1000);
  near(convert(1, "gal", "l"), 3.785411784, 1e-9);
  near(convert(3, "tsp", "tbsp"), 1, 1e-12);
});

await test("a conversion across dimensions returns null, never a number", async () => {
  // A litre of oil is not a kilogram of oil; the density belongs to the item.
  assert.strictEqual(convert(1, "l", "kg"), null);
  assert.strictEqual(convert(1, "ea", "g"), null);
  assert.strictEqual(sameDimension("l", "kg"), false);
});

await test("an unknown unit is refused rather than assumed", async () => {
  assert.strictEqual(isUnit("handful"), false);
  assert.strictEqual(convert(1, "handful", "g"), null);
  assert.strictEqual(toBase(1, "handful"), null);
});

await test("a round trip through the base unit preserves the quantity", async () => {
  for (const unit of ["kg", "lb", "oz", "cup", "floz", "dozen"]) {
    near(fromBase(toBase(7.25, unit), unit), 7.25, 1e-12);
  }
});

await test("cost per base unit handles a real purchase pack", async () => {
  // A case of 12 × 1L bottles for 90 → per millilitre.
  const perMl = costPerBase({ price: 90, packSize: 12, packUnit: "l" });
  near(perMl, 90 / 12000);
  // And the cost of a 250ml portion follows from it.
  near(perMl * 250, 1.875);
});

await test("cost per base unit refuses a degenerate pack instead of returning zero", async () => {
  // "free" and "unknown" must not look the same downstream.
  assert.strictEqual(costPerBase({ price: 90, packSize: 0, packUnit: "l" }), null);
  assert.strictEqual(costPerBase({ price: 90, packSize: 12, packUnit: "nope" }), null);
  assert.strictEqual(costPerBase({ price: -1, packSize: 1, packUnit: "l" }), null);
});

/* -------------------------- ingredients -------------------------- */

const flour = { name: "Plain Flour", stockUnit: "g", purchaseUnit: "kg", packSize: 25, category: "Dry goods" };

await test("an ingredient is stored with its dimension resolved", async () => {
  const { ingredient, created } = await inv.saveIngredient("org1", flour);
  assert.strictEqual(created, true);
  assert.strictEqual(ingredient.id, "plain-flour");
  assert.strictEqual(ingredient.dimension, "mass");
  assert.strictEqual(ingredient.packSize, 25);
});

await test("saving the same name updates rather than duplicating", async () => {
  await inv.saveIngredient("org1", flour);
  const { created } = await inv.saveIngredient("org1", { ...flour, category: "Bakery" });
  assert.strictEqual(created, false);
  const list = await inv.listIngredients("org1");
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].category, "Bakery");
});

await test("a purchase unit must measure the same kind of thing as the stock unit", async () => {
  const { error } = await inv.saveIngredient("org1", { name: "Olive Oil", stockUnit: "kg", purchaseUnit: "l" });
  assert.strictEqual(error, "purchaseUnit");
});

await test("an ingredient without a valid unit is refused", async () => {
  assert.strictEqual((await inv.saveIngredient("org1", { name: "Salt" })).error, "stockUnit");
  assert.strictEqual((await inv.saveIngredient("org1", { name: "  ", stockUnit: "g" })).error, "name");
});

await test("an ingredient is archived, never deleted", async () => {
  await inv.saveIngredient("org1", flour);
  await inv.archiveIngredient("org1", "plain-flour");

  // Gone from the working list...
  assert.deepStrictEqual(await inv.listIngredients("org1"), []);
  // ...but still resolvable, because past movements and recipes reference it.
  assert.strictEqual((await inv.getIngredient("org1", "plain-flour")).archived, true);
  assert.strictEqual((await inv.listIngredients("org1", { includeArchived: true })).length, 1);

  await inv.restoreIngredient("org1", "plain-flour");
  assert.strictEqual((await inv.listIngredients("org1")).length, 1);
});

await test("one organization's item master is invisible to another", async () => {
  await inv.saveIngredient("org1", flour);
  await inv.saveIngredient("org2", { name: "Saffron", stockUnit: "g" });

  assert.deepStrictEqual((await inv.listIngredients("org1")).map((i) => i.id), ["plain-flour"]);
  assert.deepStrictEqual((await inv.listIngredients("org2")).map((i) => i.id), ["saffron"]);
  // Not reachable by id either — the key itself is scoped.
  assert.strictEqual(await inv.getIngredient("org2", "plain-flour"), null);
});

await test("a branch override applies over the organization definition", async () => {
  const { ingredient } = await inv.saveIngredient("org1", {
    ...flour,
    branchOverrides: { b2: { supplierId: "local-mill", packSize: 10 } },
  });

  // The organization default is untouched...
  assert.strictEqual(inv.forBranch(ingredient, "b1").packSize, 25);
  // ...and the branch that differs gets its own values, still the same item.
  const b2 = inv.forBranch(ingredient, "b2");
  assert.strictEqual(b2.packSize, 10);
  assert.strictEqual(b2.supplierId, "local-mill");
  assert.strictEqual(b2.id, "plain-flour");
  assert.strictEqual(b2.overridden, true);
});

/* --------------------------- suppliers --------------------------- */

await test("a supplier in use cannot be removed out from under its ingredients", async () => {
  await inv.saveSupplier("org1", { name: "Gulf Foods" });
  await inv.saveIngredient("org1", { ...flour, supplierId: "gulf-foods" });

  const { error, count } = await inv.removeSupplier("org1", "gulf-foods");
  assert.strictEqual(error, "inuse");
  assert.strictEqual(count, 1);
  assert.strictEqual((await inv.listSuppliers("org1")).length, 1);
});

await test("a supplier still referenced by an archived ingredient is still in use", async () => {
  await inv.saveSupplier("org1", { name: "Gulf Foods" });
  await inv.saveIngredient("org1", { ...flour, supplierId: "gulf-foods" });
  await inv.archiveIngredient("org1", "plain-flour");

  assert.strictEqual((await inv.removeSupplier("org1", "gulf-foods")).error, "inuse");
});

await test("an unused supplier is removed", async () => {
  await inv.saveSupplier("org1", { name: "Gulf Foods" });
  assert.strictEqual((await inv.removeSupplier("org1", "gulf-foods")).ok, true);
  assert.deepStrictEqual(await inv.listSuppliers("org1"), []);
});

/* ----------------------------- meta ------------------------------ */

await test("categories are de-duplicated and sorted, so reports group cleanly", async () => {
  const meta = await inv.saveMeta("org1", {
    categories: [" Dairy ", "dry goods", "Dairy", ""],
    locations: ["Walk-in", "Dry store"],
  });
  assert.deepStrictEqual(meta.categories, ["Dairy", "dry goods"]);
  assert.deepStrictEqual(meta.locations, ["Dry store", "Walk-in"]);
});

await test("saving one meta list leaves the other intact", async () => {
  await inv.saveMeta("org1", { categories: ["Dairy"], locations: ["Walk-in"] });
  const meta = await inv.saveMeta("org1", { categories: ["Dairy", "Meat"] });
  assert.deepStrictEqual(meta.locations, ["Walk-in"]);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
