/* Stage 4, phase 2: the stock-movement ledger.

   What these tests are really protecting is the claim that a balance is derived.
   Anything that lets a quantity be edited, deleted or double-counted breaks the
   promise that every number can be explained by the entries beneath it — so the
   assertions here are about summation across units, reversal instead of
   deletion, transfers balancing across two branches, and the negative-stock
   policy actually holding. */

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
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const near = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

/* Two ingredients, one held in kg and one counted, which is enough to exercise
   both a scaled dimension and a trivial one. */
async function seed() {
  await inv.saveIngredient("org1", { name: "Plain flour", stockUnit: "kg", reorderPoint: 5 });
  await inv.saveIngredient("org1", { name: "Burger box", stockUnit: "ea" });
  return inv.listIngredients("org1", { includeArchived: true });
}

const receive = (branch, ingredientId, qty, unit, extra = {}) =>
  mv.recordMovement("org1", branch, { ingredientId, type: "receive", qty, unit, ...extra });

/* --------------------------- recording --------------------------- */

await test("a movement is stored as entered and in base units", async () => {
  await seed();
  const { movement } = await receive("b1", "plain-flour", 2, "kg");
  assert.strictEqual(movement.qty, 2);
  assert.strictEqual(movement.unit, "kg");
  near(movement.qtyBase, 2000);
  assert.strictEqual(movement.baseUnit, "g");
});

await test("issues and waste are negative regardless of how the quantity is typed", async () => {
  await seed();
  await receive("b1", "plain-flour", 10, "kg");
  const waste = await mv.recordMovement("org1", "b1", {
    ingredientId: "plain-flour", type: "waste", qty: 500, unit: "g",
  });
  near(waste.movement.qtyBase, -500);
  assert.ok(waste.movement.qty < 0);
});

await test("entries in different units sum to one correct balance", async () => {
  const ingredients = await seed();
  await receive("b1", "plain-flour", 2, "kg");
  await receive("b1", "plain-flour", 750, "g");
  await mv.recordMovement("org1", "b1", { ingredientId: "plain-flour", type: "consume", qty: 1, unit: "kg" });

  const [row] = await mv.balances("org1", ["b1"], { ingredients });
  near(row.qty, 1.75);
  assert.strictEqual(row.stockUnit, "kg");
});

await test("a unit from another dimension is refused, never converted", async () => {
  await seed();
  const out = await receive("b1", "plain-flour", 1, "l");
  assert.strictEqual(out.error, "unit");
});

await test("an unknown ingredient, an archived one, and a zero quantity are all refused", async () => {
  await seed();
  assert.strictEqual((await receive("b1", "nope", 1, "kg")).error, "ingredientId");
  assert.strictEqual((await receive("b1", "plain-flour", 0, "kg")).error, "qty");
  assert.strictEqual((await receive("b1", "plain-flour", -1, "kg")).error, "qty");
  await inv.archiveIngredient("org1", "plain-flour");
  assert.strictEqual((await receive("b1", "plain-flour", 1, "kg")).error, "archived");
});

await test("an adjustment is the only signed type", async () => {
  await seed();
  await receive("b1", "burger-box", 100, "ea");
  const down = await mv.recordMovement("org1", "b1", {
    ingredientId: "burger-box", type: "adjust", qty: -4, unit: "ea",
  });
  near(down.movement.qtyBase, -4);
  const up = await mv.recordMovement("org1", "b1", {
    ingredientId: "burger-box", type: "adjust", qty: 4, unit: "ea",
  });
  near(up.movement.qtyBase, 4);
  assert.strictEqual((await mv.recordMovement("org1", "b1", {
    ingredientId: "burger-box", type: "adjust", qty: 0, unit: "ea",
  })).error, "qty");
});

await test("recording keeps when it happened apart from when it was typed", async () => {
  await seed();
  const backdated = Date.now() - 86400_000;
  const { movement } = await receive("b1", "plain-flour", 1, "kg", { at: backdated });
  assert.strictEqual(movement.at, backdated);
  assert.ok(movement.recordedAt > backdated);
});

/* ----------------------- negative-stock policy ------------------- */

await test("stock cannot be driven negative by default, and the shortfall is reported", async () => {
  await seed();
  await receive("b1", "plain-flour", 1, "kg");
  const out = await mv.recordMovement("org1", "b1", {
    ingredientId: "plain-flour", type: "consume", qty: 1500, unit: "g",
  });
  assert.strictEqual(out.error, "negative");
  near(out.onHand, 1);
  near(out.short, 0.5);
});

await test("the policy can allow negative stock, and then the balance goes negative", async () => {
  const ingredients = await seed();
  await mv.savePolicy("org1", { allowNegative: true });
  await mv.recordMovement("org1", "b1", { ingredientId: "plain-flour", type: "consume", qty: 2, unit: "kg" });
  const [row] = await mv.balances("org1", ["b1"], { ingredients });
  near(row.qty, -2);
  assert.strictEqual(row.negative, true);
});

await test("an incoming movement is never blocked by the policy", async () => {
  await seed();
  await mv.savePolicy("org1", { allowNegative: false });
  assert.ok((await receive("b1", "plain-flour", 5, "kg")).movement);
});

/* --------------------------- reversal ---------------------------- */

await test("a reversal cancels the balance while both entries survive", async () => {
  const ingredients = await seed();
  const { movement } = await receive("b1", "plain-flour", 8, "kg");
  const out = await mv.reverseMovement("org1", "b1", movement.id, { actor: "amal", reason: "wrong item" });

  near(out.movement.qtyBase, -8000);
  assert.strictEqual(out.movement.reverses, movement.id);
  assert.strictEqual(out.original.reversedBy, out.movement.id);

  const ledger = await mv.listMovements("org1", "b1");
  assert.strictEqual(ledger.length, 2, "nothing is deleted");
  const rows = await mv.balances("org1", ["b1"], { ingredients });
  near(rows[0].qty, 0);
});

await test("the same entry cannot be reversed twice, and a reversal cannot be reversed", async () => {
  await seed();
  const { movement } = await receive("b1", "plain-flour", 8, "kg");
  const first = await mv.reverseMovement("org1", "b1", movement.id);
  assert.strictEqual((await mv.reverseMovement("org1", "b1", movement.id)).error, "reversed");
  assert.strictEqual((await mv.reverseMovement("org1", "b1", first.movement.id)).error, "isreversal");
});

await test("reversing an unknown entry is a not-found, not a silent no-op", async () => {
  await seed();
  assert.strictEqual((await mv.reverseMovement("org1", "b1", "nope")).error, "notfound");
});

/* --------------------------- transfers --------------------------- */

await test("a transfer writes both legs and leaves the group total unchanged", async () => {
  const ingredients = await seed();
  await receive("b1", "plain-flour", 10, "kg");

  const out = await mv.recordTransfer("org1", {
    fromBranchId: "b1", toBranchId: "b2", ingredientId: "plain-flour", qty: 4, unit: "kg",
  });
  assert.strictEqual(out.out.transferId, out.in.transferId);

  const [group] = await mv.balances("org1", ["b1", "b2"], { ingredients });
  near(group.qty, 10, 1e-9);
  near(group.byBranch.b1, 6);
  near(group.byBranch.b2, 4);
});

await test("a transfer to the same branch is refused", async () => {
  await seed();
  const out = await mv.recordTransfer("org1", {
    fromBranchId: "b1", toBranchId: "b1", ingredientId: "plain-flour", qty: 1, unit: "kg",
  });
  assert.strictEqual(out.error, "sameBranch");
});

await test("a transfer the source cannot cover is refused without moving anything", async () => {
  const ingredients = await seed();
  await receive("b1", "plain-flour", 1, "kg");
  const out = await mv.recordTransfer("org1", {
    fromBranchId: "b1", toBranchId: "b2", ingredientId: "plain-flour", qty: 4, unit: "kg",
  });
  assert.strictEqual(out.error, "negative");

  const rows = await mv.balances("org1", ["b1", "b2"], { ingredients });
  near(rows[0].qty, 1);
  assert.deepStrictEqual(Object.keys(rows[0].byBranch), ["b1"]);
});

await test("the receiving branch inherits the sending branch's cost", async () => {
  await seed();
  await receive("b1", "plain-flour", 10, "kg", { unitCost: 0.004 });
  const out = await mv.recordTransfer("org1", {
    fromBranchId: "b1", toBranchId: "b2", ingredientId: "plain-flour",
    qty: 2, unit: "kg", unitCost: 0.004,
  });
  assert.strictEqual(out.in.unitCost, out.out.unitCost);
});

/* -------------------------- scope and reads ---------------------- */

await test("balances are only summed over the branches asked for", async () => {
  const ingredients = await seed();
  await receive("b1", "plain-flour", 3, "kg");
  await receive("b2", "plain-flour", 7, "kg");

  const [one] = await mv.balances("org1", ["b2"], { ingredients });
  near(one.qty, 7);
  const [both] = await mv.balances("org1", ["b1", "b2"], { ingredients });
  near(both.qty, 10);
  assert.deepStrictEqual(await mv.balances("org1", [], { ingredients }), []);
});

await test("one organization's ledger is unreachable from another", async () => {
  await seed();
  await inv.saveIngredient("org2", { name: "Plain flour", stockUnit: "kg" });
  await receive("b1", "plain-flour", 9, "kg");

  const other = await mv.balances("org2", ["b1"], {
    ingredients: await inv.listIngredients("org2"),
  });
  assert.deepStrictEqual(other, []);
  assert.deepStrictEqual(await mv.listMovements("org2", "b1"), []);
});

await test("the ledger reads newest first and filters by ingredient and type", async () => {
  await seed();
  await receive("b1", "plain-flour", 1, "kg");
  await receive("b1", "burger-box", 50, "ea");
  await mv.recordMovement("org1", "b1", { ingredientId: "plain-flour", type: "waste", qty: 100, unit: "g" });

  const all = await mv.listMovements("org1", "b1");
  assert.strictEqual(all.length, 3);
  assert.strictEqual(all[0].type, "waste");
  assert.strictEqual((await mv.listMovements("org1", "b1", { ingredientId: "burger-box" })).length, 1);
  assert.strictEqual((await mv.listMovements("org1", "b1", { type: "receive" })).length, 2);
});

await test("a balance carries the reorder flag so one threshold serves every consumer", async () => {
  const ingredients = await seed();
  await receive("b1", "plain-flour", 4, "kg");
  const [row] = await mv.balances("org1", ["b1"], { ingredients });
  assert.strictEqual(row.belowReorder, true, "4kg is at or under the 5kg reorder point");

  await receive("b1", "plain-flour", 10, "kg");
  const [after] = await mv.balances("org1", ["b1"], { ingredients });
  assert.strictEqual(after.belowReorder, false);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
