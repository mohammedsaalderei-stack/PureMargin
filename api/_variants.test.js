/* Item variants and stock on products with no recipe.

   What this protects: a variant sets the price and is required when an item
   has them; the receipt names it; a variant written as its own recipe draws
   that recipe, and one drawn at a scale draws the plain recipe that many
   times over — at the till and in the variance report alike; and a product
   sold as it comes takes its linked stock item off the shelf. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const { buildSale } = await import("../shared/tillprice.js");
const till = await import("./_till.js");
const setup = await import("./_tillsetup.js");
const { saveVersion, listRecipes } = await import("./_recipes.js");
const { saveIngredient } = await import("./_inventory.js");
const { indexRecipes, consumptionOf } = await import("./_salesdepletion.js");
const { theoreticalUsage } = await import("./_variance.js");

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);
const ORG = "org1";
const sell = (catalogue, lines) => buildSale(
  { orderType: "takeaway", lines, payments: [{ type: "cash" }] },
  { catalogue, vatPct: 0, paymentTypes: [{ id: "cash", name: "Cash", kind: "cash" }] },
);

await test("variants are checked: named, priced, scaled within reason, ids kept", async () => {
  assert.equal(till.readVariants([{ name: "", price: 5 }]).error, "name");
  assert.equal(till.readVariants([{ name: "Large", price: 0 }]).error, "price");
  assert.equal(till.readVariants([{ name: "Large", price: 5, scale: 50 }]).error, "scale");
  const out = till.readVariants([{ name: "Large", price: 12, scale: 1.5 }, { name: "Large", price: 14 }, { id: "v-keep", name: "Small", price: 8 }]);
  assert.deepEqual(out.variants.map((v) => v.id), ["v-large", "v-large-2", "v-keep"]);
  assert.equal(out.variants[1].scale, 1, "scale defaults to one portion");
});

await test("an item with variants is sold as one of them, at its price", async () => {
  const cat = [{ id: "fries", kind: "recipe", name: "Fries", price: 9, addons: [], variants: [
    { id: "v-regular", name: "Regular", price: 9, scale: 1 }, { id: "v-large", name: "Large", price: 12, scale: 1.5 },
  ] }];
  assert.equal(sell(cat, [{ itemId: "fries", qty: 1 }]).error, "variant");
  assert.equal(sell(cat, [{ itemId: "fries", qty: 1, variantId: "v-huge" }]).error, "variant");
  const r = sell(cat, [{ itemId: "fries", qty: 2, variantId: "v-large" }]).receipt;
  near(r.total_money, 24);
  assert.equal(r.line_items[0].variant_name, "Large");
  assert.equal(r.line_items[0].variant_id, "v-large");
  assert.equal(r.line_items[0].variant_scale, 1.5);
  assert.equal(sell(cat, [{ itemId: "fries", qty: 1, variantId: "v-regular" }]).receipt.line_items[0].variant_scale, undefined);
});

await test("recipes sharing a dish name are one item, its variants each their own recipe", async () => {
  await saveVersion(ORG, { id: "latte", menuItem: "Latte", sellPrice: 14, lines: [{ name: "Milk", qty: 200, unit: "ml" }] });
  await saveVersion(ORG, { id: "latte-large", menuItem: "Latte", variant: "Large", sellPrice: 18, lines: [{ name: "Milk", qty: 300, unit: "ml" }] });
  await saveVersion(ORG, { id: "tea", menuItem: "Tea", sellPrice: 4, lines: [{ name: "Milk", qty: 50, unit: "ml" }] });
  const items = till.catalogueOf(await listRecipes(ORG), await till.getSettings(ORG));
  const latte = items.find((i) => i.name === "Latte");
  assert.equal(items.filter((i) => i.name === "Latte").length, 1);
  assert.deepEqual(latte.variants.map((v) => [v.name, v.price, v.recipeId]), [["", 14, "latte"], ["Large", 18, "latte-large"]]);
  assert.equal(latte.price, 14, "an item with sizes shows its cheapest");
  assert.deepEqual(items.find((i) => i.name === "Tea").variants, []);

  const line = sell(items, [{ itemId: latte.id, qty: 1, variantId: "r-latte-large" }]).receipt.line_items[0];
  assert.equal(line.item_id, "recipe:latte-large", "the sale names the variant's own recipe");
});

await test("a variant of its own recipe draws that recipe; a scaled one draws the plain recipe scaled", async () => {
  await saveVersion(ORG, { id: "latte", menuItem: "Latte", sellPrice: 14, lines: [{ name: "Milk", qty: 200, unit: "ml" }] });
  await saveVersion(ORG, { id: "latte-large", menuItem: "Latte", variant: "Large", sellPrice: 18, lines: [{ name: "Milk", qty: 300, unit: "ml" }] });
  await saveVersion(ORG, { id: "fries", menuItem: "Fries", sellPrice: 9, lines: [{ name: "Potato", qty: 200, unit: "g" }] });
  const index = indexRecipes(await listRecipes(ORG));
  const used = (lines) => Object.fromEntries(consumptionOf({ lines }, index, Date.now()).movements.map((m) => [m.ingredientId, m.qty]));

  near(used([{ itemId: "recipe:latte-large", name: "Latte", variant: "Large", qty: 2 }]).milk, 600);
  near(used([{ itemId: "recipe:fries", name: "Fries", variant: "Large", variantId: "v-large", scale: 1.5, qty: 2 }]).potato, 600);
  near(used([{ itemId: "recipe:fries", name: "Fries", qty: 2 }]).potato, 400);
  /* By name too, the way a receipt without the register's ids reads. */
  near(used([{ name: "Latte", variant: "Large", qty: 1 }]).milk, 300);
  near(used([{ name: "Latte", qty: 1 }]).milk, 200);
});

await test("the variance report draws a scaled variant the same way the till does", async () => {
  await saveVersion(ORG, { id: "fries", menuItem: "Fries", sellPrice: 9, lines: [{ name: "Potato", qty: 200, unit: "g" }] });
  const out = theoreticalUsage([{ name: "Fries", variant: "Large", qty: 2, drawQty: 3, revenue: 24, branchId: "register" }], await listRecipes(ORG));
  near(out.byIngredient.get("potato").qtyBase, 600);
});

await test("a product with no recipe takes its stock item off the shelf", async () => {
  await saveIngredient(ORG, { name: "Soda can", stockUnit: "ea" });
  assert.equal((await setup.saveProduct(ORG, { name: "Soda", price: 3.5, stock: { ingredientId: "soda-can", qty: 1, unit: "kg" } })).error, "stockunit");
  assert.equal((await setup.saveProduct(ORG, { name: "Soda", price: 3.5, stock: { ingredientId: "nothing" } })).error, "stock");
  const saved = await setup.saveProduct(ORG, { name: "Soda", price: 3.5, stock: { ingredientId: "soda-can", qty: 1, unit: "ea" } });
  assert.ok(!saved.error, saved.error);
  await till.saveVariants(ORG, saved.id, [{ name: "Six-pack", price: 18, scale: 6 }]);

  const items = till.catalogueOf([], await till.getSettings(ORG));
  const soda = items.find((i) => i.name === "Soda");
  assert.deepEqual(soda.stock, { ingredientId: "soda-can", qty: 1, unit: "ea" });
  const receipt = sell(items, [{ itemId: soda.id, qty: 2, variantId: "v-six-pack" }]).receipt;
  assert.deepEqual(receipt.line_items[0].stock_draw, [{ ingredientId: "soda-can", qty: 6, unit: "ea" }]);

  const moved = consumptionOf(till.forDepletion({ id: "x", receipt_date: new Date().toISOString(), line_items: receipt.line_items }), indexRecipes([]), Date.now());
  assert.deepEqual(moved.movements, [{ ingredientId: "soda-can", unit: "ea", qty: 12 }]);
  assert.deepEqual(moved.unmatched, []);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
