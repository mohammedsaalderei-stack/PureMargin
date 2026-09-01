/* The whole loop, end to end: a recipe written before anything was bought, an
   invoice that stocks it, a sale that draws it down, and the cost that comes
   out the other side.

   Every other test file here checks one module. This one exists because the
   faults that actually reach people live between them — a unit that is right
   in `_units.js` and applied to the wrong figure in `_salesdepletion.js`, a
   cost that is correct per gram and displayed per kilo. The arithmetic in this
   file is deliberately arithmetic somebody can check on paper:

     buy   5 kg of chicken for 114.00      → 22.80 a kilo
     sell  1 wrap containing 150 g          → 4.85 kg left, 3.42 of cost

   Those are the figures in the specification this was built against, and they
   are here so that a refactor that breaks the chain fails loudly rather than
   producing a plausible number that is out by a thousand. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");
const rc = await import("./_recipes.js");
const sd = await import("./_salesdepletion.js");
const al = await import("./_aliases.js");
const pur = await import("./_purchase.js");
const costing = await import("./_costing.js");

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

const onHand = async (ingredientId) => {
  const rows = await mv.balances("org1", ["b1"], {
    ingredients: await inv.listIngredients("org1", { includeArchived: true }),
  });
  return rows.find((r) => r.ingredientId === ingredientId) || null;
};

/* The invoice as the scanner hands it over, before anything is committed. */
const invoice = (text, qty, unit, amount) => ({
  supplier: "Gulf Fresh", invoiceNo: "INV-2026-0817",
  subtotal: 1250, tax: 62.5, total: 1312.5,
  lines: [{ text, qty, unit, amount }],
});

/* ---------------------------------------------------------------- */

await test("a recipe written before anything is bought, then stocked, then sold", async () => {
  /* 1. The chef writes the dish. Nothing is in the store; nothing about that
        is an obstacle. Chicken is estimated at 22.80 a kilo — 0.0228 a gram,
        which is the unit the estimate is held in. */
  const written = await rc.saveVersion("org1", {
    menuItem: "Shawarma wrap", portions: 1, yieldPct: 100, sellPrice: 22,
    lines: [{ name: "Chicken", qty: 150, unit: "g", estimatedCost: 0.0228 }],
  });
  assert.strictEqual(written.error, undefined);
  assert.deepStrictEqual(written.newIngredients.map((i) => i.id), ["chicken"]);

  /* Costable immediately, on the estimate, and saying so. */
  const early = await rc.costedRecipe("org1", "shawarma-wrap", ["b1"]);
  near(early.costing.perPortion.total, 3.42);
  assert.strictEqual(early.costing.estimatedCount, 1);

  /* 2. An invoice arrives. The supplier's wording is nothing like "Chicken",
        so this is exactly the line the matcher gets wrong and the alias table
        exists to fix — but the model named the ingredient, so it lands. */
  const parsed = await pur.matchPurchase("org1",
    { ...invoice("FRSH CHKN THIGH BNLS 5KG", 5, "kg", 114), lines: [
      { text: "FRSH CHKN THIGH BNLS 5KG", qty: 5, unit: "kg", amount: 114, ingredient: "Chicken" },
    ] });

  assert.strictEqual(parsed.lines[0].ingredientId, "chicken");

  /* The shelf is kept in grams, because that is the unit the recipe stated
     when it created the ingredient. So the invoice's "5 kg for 114" is
     restated into 5000 g at 0.0228 each — and the quantity and the cost are
     emitted as a matching pair. Sending the printed quantity with this cost is
     the factor-of-1000 error `receiveQty`/`receiveUnit` exist to prevent. */
  near(parsed.lines[0].unitCost, 0.0228);
  assert.strictEqual(parsed.lines[0].receiveUnit, "g");
  near(parsed.lines[0].receiveQty, 5000);

  /* 3. Receiving it, on the pair the parser guaranteed. */
  const received = await mv.recordMovement("org1", "b1", {
    ingredientId: "chicken", type: "receive",
    qty: parsed.lines[0].receiveQty, unit: parsed.lines[0].receiveUnit,
    unitCost: parsed.lines[0].unitCost, actor: "storeman",
  });
  assert.strictEqual(received.error, undefined);
  near((await onHand("chicken")).qty, 5000, 1e-6); // held in grams, the stated unit

  /* The estimate stops mattering the moment a real price exists. */
  const stocked = await rc.costedRecipe("org1", "shawarma-wrap", ["b1"]);
  assert.strictEqual(stocked.costing.estimatedCount, 0);
  near(stocked.costing.perPortion.total, 3.42); // the estimate happened to be right

  /* 4. A sale. One wrap, 150 g of chicken, out of 5 kg. */
  const out = await sd.depleteFromSales("org1", "b1", [
    { id: "receipt-1", at: Date.now(), lines: [{ name: "Shawarma wrap", qty: 1 }] },
  ]);
  assert.strictEqual(out.posted, 1);
  assert.strictEqual(out.movements, 1);

  /* The figure from the specification: 150 g off a 5 kg balance leaves
     4.85 kg. Held in grams, so 4850 — and the conversion is the point. */
  near((await onHand("chicken")).qty, 4850, 1e-6);

  /* 5. And the money. Gross margin on a 22.00 wrap costing 3.42. */
  assert.strictEqual(stocked.margin.sellPrice, 22);
  near(stocked.margin.cost, 3.42);
  near(stocked.margin.profit, 18.58);
  near(stocked.margin.costPct, 15.55, 0.01);
});

await test("the same sale twice draws stock once", async () => {
  await rc.saveVersion("org1", {
    menuItem: "Wrap", portions: 1, yieldPct: 100,
    lines: [{ name: "Chicken", qty: 150, unit: "g" }],
  });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "chicken", type: "receive", qty: 5, unit: "kg", unitCost: 22.8,
  });

  const sale = [{ id: "receipt-1", at: Date.now(), lines: [{ name: "Wrap", qty: 1 }] }];
  await sd.depleteFromSales("org1", "b1", sale);
  const again = await sd.depleteFromSales("org1", "b1", sale);

  assert.strictEqual(again.posted, 0);
  assert.strictEqual(again.movements, 0);
  near((await onHand("chicken")).qty, 4850, 1e-6);
});

await test("a shelf in kilos and a recipe in grams do not disagree by a thousand", async () => {
  /* The failure this whole base-unit scheme exists to prevent. The ingredient
     is kept in kilos, the recipe calls for grams, the invoice prices per kilo,
     and every one of those has to land on the same number. */
  await inv.saveIngredient("org1", { name: "Rice", stockUnit: "kg" });
  await rc.saveVersion("org1", {
    menuItem: "Biryani", portions: 4, yieldPct: 100,
    lines: [{ ingredientId: "rice", qty: 600, unit: "g" }],
  });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "rice", type: "receive", qty: 20, unit: "kg", unitCost: 5.2,
  });

  near((await onHand("rice")).qty, 20);

  /* Four portions sold: one batch, 600 g. */
  await sd.depleteFromSales("org1", "b1", [
    { id: "r1", at: Date.now(), lines: [{ name: "Biryani", qty: 4 }] },
  ]);
  near((await onHand("rice")).qty, 19.4, 1e-9);

  /* And the cost per portion: 600 g at 5.20 a kilo is 3.12 a batch, 0.78 each. */
  const costed = await rc.costedRecipe("org1", "biryani", ["b1"]);
  near(costed.costing.perPortion.total, 0.78);
});

await test("a second invoice from the same supplier needs no matching at all", async () => {
  await inv.saveIngredient("org1", { name: "Tomatoes", stockUnit: "kg" });

  const description = "RD PLM TOM 5K CS GRD-A";
  /* Nothing in that description overlaps "Tomatoes" — the first invoice would
     be a line somebody has to resolve. */
  const first = await pur.matchPurchase("org1", invoice(description, 4, "kg", 96));
  assert.strictEqual(first.lines[0].ingredientId, null);

  /* Committing it against the tomatoes teaches the table. */
  await al.learnAliases("org1", [{ text: description, ingredientId: "tomatoes" }]);

  /* Next month's invoice resolves on its own. */
  const second = await pur.matchPurchase("org1", invoice(description, 6, "kg", 150));
  assert.strictEqual(second.lines[0].ingredientId, "tomatoes");
  assert.strictEqual(second.lines[0].viaAlias, true);
  assert.strictEqual(second.complete, true);
  near(second.lines[0].unitCost, 25);
});

await test("an invoice in kilos into a shelf kept in grams costs the right amount", async () => {
  /* The regression this pair exists for, stated on its own so it fails for one
     reason. Chicken kept in grams; invoice priced per kilo. Receiving the
     printed quantity with the restated cost recorded 0.0228 a kilo instead of
     22.80 — food cost a thousandth of the truth, and nothing downstream
     contradicting it. */
  await inv.saveIngredient("org1", { name: "Chicken", stockUnit: "g" });

  const parsed = await pur.matchPurchase("org1", {
    lines: [{ text: "CHICKEN 5KG", qty: 5, unit: "kg", amount: 114, ingredient: "Chicken" }],
  });
  const line = parsed.lines[0];

  await mv.recordMovement("org1", "b1", {
    ingredientId: "chicken", type: "receive",
    qty: line.receiveQty, unit: line.receiveUnit, unitCost: line.unitCost,
  });

  const basis = await costing.costBasis("org1", ["b1"]);
  /* 22.80 a kilo is 0.0228 a gram. The base unit is the gram, so this is the
     figure every recipe cost is multiplied by. */
  near(costing.costFrom(basis, "chicken", "last"), 0.0228, 1e-9);
  near((await onHand("chicken")).qty, 5000);
});

await test("stock value follows the weighted average of what was actually paid", async () => {
  await inv.saveIngredient("org1", { name: "Oil", stockUnit: "l" });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "oil", type: "receive", qty: 10, unit: "l", unitCost: 6,
  });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "oil", type: "receive", qty: 10, unit: "l", unitCost: 8,
  });

  const basis = await costing.costBasis("org1", ["b1"]);
  /* Per millilitre, because that is the base unit — 7 a litre is 0.007 a ml. */
  near(costing.costFrom(basis, "oil", "wavg"), 0.007);
  near(costing.costFrom(basis, "oil", "last"), 0.008);
  assert.strictEqual(costing.evidenceFor(basis, "oil").estimated, false);
  assert.strictEqual(costing.evidenceFor(basis, "oil").receipts, 2);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
