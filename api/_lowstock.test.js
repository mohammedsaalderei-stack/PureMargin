/* What counts as running low (`lowStock` in `_movements.js`, `GET
   /api/stock?what=low`).

   The warning has to be right in both directions: an item nobody set a level
   for must still be noticed when it is nearly gone, and a well-stocked shelf
   must not cry wolf. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");

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
const move = (branch, ingredientId, type, qty, unit = "kg") => mv.recordMovement("org1", branch, { ingredientId, type, qty, unit, unitCost: type === "receive" ? 10 : undefined });
const low = async (branches = ["b1"]) => mv.lowStock("org1", branches, { ingredients: await inv.listIngredients("org1") });

await test("under its reorder level is low; above it is not", async () => {
  await inv.saveIngredient("org1", { name: "Flour", stockUnit: "kg", reorderPoint: 5 });
  await move("b1", "flour", "receive", 20);
  assert.deepEqual(await low(), []);
  await move("b1", "flour", "consume", 16);
  const [row] = await low();
  assert.equal(row.state, "low");
  assert.equal(row.qty, 4);
  assert.equal(row.threshold, 5);
  assert.equal(row.basis, "reorder");
});

await test("with no level set, under a fifth of the last delivery is low", async () => {
  await inv.saveIngredient("org1", { name: "Chicken", stockUnit: "kg" });
  await move("b1", "chicken", "receive", 10);
  await move("b1", "chicken", "consume", 7);
  assert.deepEqual(await low(), [], "3 of 10 left is not yet low");
  await move("b1", "chicken", "consume", 1.5);
  const [row] = await low();
  assert.equal(row.state, "low");
  assert.equal(row.qty, 1.5);
  assert.equal(row.threshold, 2);
  assert.equal(row.basis, "delivery");
});

await test("nothing left is out, and comes first", async () => {
  await inv.saveIngredient("org1", { name: "Flour", stockUnit: "kg", reorderPoint: 5 });
  await inv.saveIngredient("org1", { name: "Chicken", stockUnit: "kg" });
  await move("b1", "flour", "receive", 6);
  await move("b1", "flour", "consume", 2);
  await move("b1", "chicken", "receive", 5);
  await move("b1", "chicken", "consume", 5);
  const rows = await low();
  assert.deepEqual(rows.map((r) => [r.name, r.state]), [["Chicken", "out"], ["Flour", "low"]]);
});

await test("each branch is judged on its own shelf", async () => {
  await inv.saveIngredient("org1", { name: "Chicken", stockUnit: "kg", reorderPoint: 2 });
  await move("b1", "chicken", "receive", 50);
  await move("b2", "chicken", "receive", 5);
  await move("b2", "chicken", "consume", 4);
  const rows = await low(["b1", "b2"]);
  assert.deepEqual(rows.map((r) => r.branchId), ["b2"], "plenty at one site does nothing for the other");
  assert.deepEqual(await low(["b1"]), []);
});

await test("an archived item, or one never stocked, is not warned about", async () => {
  await inv.saveIngredient("org1", { name: "Chicken", stockUnit: "kg" });
  await inv.saveIngredient("org1", { name: "Saffron", stockUnit: "g" });
  await move("b1", "chicken", "receive", 5);
  await move("b1", "chicken", "consume", 5);
  await inv.archiveIngredient("org1", "chicken");
  assert.deepEqual(await low(), []);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
