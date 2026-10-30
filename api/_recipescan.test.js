/* Reading a recipe card.

   What these protect: fractions written the way kitchens write them are read
   rather than discarded; ingredients are matched against the real master and
   never named by the model; a missing portion count defaults to one and says
   so; yield is never guessed from a photograph; and a unit that differs from
   the shelf's is carried through so the screen can flag it. */

import assert from "node:assert/strict";
import { buildRecipe, buildRecipes, parseQty } from "./_recipescan.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const STOCK = [
  { id: "flour", name: "Flour", stockUnit: "kg" },
  { id: "olive-oil", name: "Olive oil", stockUnit: "l" },
  { id: "chicken-breast", name: "Chicken breast", stockUnit: "kg" },
];

test("a plain number is read", () => {
  assert.equal(parseQty("500"), 500);
  assert.equal(parseQty(2.5), 2.5);
});

test("a written fraction is read, not discarded", () => {
  assert.equal(parseQty("1/2"), 0.5);
  assert.equal(parseQty("3/4"), 0.75);
});

test("a mixed number is read", () => {
  assert.equal(parseQty("1 1/2"), 1.5);
  assert.equal(parseQty("2 3/4"), 2.75);
});

test("a vulgar fraction glyph is read", () => {
  assert.equal(parseQty("½"), 0.5);
  assert.equal(parseQty("1½"), 1.5);
  assert.equal(parseQty("¼"), 0.25);
});

test("a quantity with a unit stuck to it still reads", () => {
  assert.equal(parseQty("500g"), 500, "the unit is a separate field; the number still counts");
});

test("nothing readable is null, never zero", () => {
  for (const junk of ["", null, undefined, "a pinch", "to taste"]) {
    assert.equal(parseQty(junk), null, `${JSON.stringify(junk)} must not become a quantity`);
  }
});

test("a zero or negative quantity is refused", () => {
  assert.equal(parseQty("0"), null);
  assert.equal(parseQty("-3"), null);
});

test("ingredients are matched against the real master", () => {
  const out = buildRecipe({
    menuItem: "Flatbread",
    lines: [{ text: "Plain flour", qty: "500", unit: "g" }],
  }, STOCK);
  assert.equal(out.lines[0].ingredientId, "flour");
  assert.equal(out.lines[0].qty, 500);
});

test("a line the master does not have is left unmatched", () => {
  const out = buildRecipe({
    lines: [{ text: "Saffron threads", qty: "1", unit: "g" }],
  }, STOCK);
  assert.equal(out.lines[0].ingredientId, null);
  assert.deepEqual(out.unmatched, ["Saffron threads"]);
  assert.equal(out.complete, false);
});

test("a missing portion count defaults to one and admits it", () => {
  const out = buildRecipe({ menuItem: "Soup", lines: [] }, STOCK);
  assert.equal(out.portions, 1);
  assert.equal(out.portionsStated, false, "the screen has to be able to say this was assumed");
});

test("a stated portion count is kept and marked as stated", () => {
  const out = buildRecipe({ menuItem: "Soup", portions: 10, lines: [] }, STOCK);
  assert.equal(out.portions, 10);
  assert.equal(out.portionsStated, true);
});

test("yield is never guessed from a photograph", () => {
  const out = buildRecipe({ menuItem: "Stew", yieldPct: 60, lines: [] }, STOCK);
  assert.equal(out.yieldPct, 100, "trim and cooking loss are not visible on a card");
});

test("the stock unit is carried so a mismatch can be flagged", () => {
  const out = buildRecipe({
    lines: [{ text: "Olive oil", qty: "2", unit: "cup" }],
  }, STOCK);
  assert.equal(out.lines[0].unit, "cup");
  assert.equal(out.lines[0].stockUnit, "l", "the card says cups; the shelf counts litres");
});

test("a fully matched card reports itself complete", () => {
  const out = buildRecipe({
    menuItem: "Chicken flatbread",
    portions: 4,
    lines: [
      { text: "Plain flour", qty: "500", unit: "g" },
      { text: "Chicken breast", qty: "1/2", unit: "kg" },
    ],
  }, STOCK);
  assert.equal(out.matchedCount, 2);
  assert.equal(out.complete, true);
  assert.equal(out.lines[1].qty, 0.5);
});

test("an empty card is not complete", () => {
  assert.equal(buildRecipe({ menuItem: "Nothing", lines: [] }, STOCK).complete, false);
});

test("no ingredients on file matches nothing and does not crash", () => {
  const out = buildRecipe({ lines: [{ text: "Flour", qty: "1", unit: "kg" }] }, []);
  assert.equal(out.matchedCount, 0);
  assert.equal(out.lines[0].ingredientId, null);
});

test("a dish name is taken from either field the model might use", () => {
  assert.equal(buildRecipe({ title: "Mandi", lines: [] }, STOCK).menuItem, "Mandi");
  assert.equal(buildRecipe({ menuItem: "Mandi", lines: [] }, STOCK).menuItem, "Mandi");
});

/* A document with a dish to a page — the report that came back as one dish. */

const SHEETS = {
  recipes: [
    { menuItem: "Beef steak plate", portions: 1, lines: [{ text: "Beef", qty: "0.2", unit: "kg" }] },
    { menuItem: "Beef burgers", portions: 1, lines: [{ text: "Ground beef", qty: "0.15", unit: "kg" }, { text: "Brioche buns", qty: "1", unit: "pcs" }] },
    { menuItem: "Mini sliders", portions: 1, lines: [{ text: "Slider buns", qty: "3", unit: "pcs" }] },
  ],
};

test("every dish in a document comes back as its own recipe, in order", () => {
  const out = buildRecipes(SHEETS, STOCK);
  assert.deepEqual(out.recipes.map((r) => r.menuItem), ["Beef steak plate", "Beef burgers", "Mini sliders"]);
});

test("each dish keeps its own ingredients, never another page's", () => {
  const out = buildRecipes(SHEETS, STOCK);
  assert.deepEqual(out.recipes.map((r) => r.lines.length), [1, 2, 1]);
});

test("the first dish is also at the top, for a copy of the app that reads only one", () => {
  const out = buildRecipes(SHEETS, STOCK);
  assert.equal(out.menuItem, "Beef steak plate");
  assert.equal(out.lines.length, 1);
});

test("an answer in the old one-dish shape is a list of one", () => {
  const out = buildRecipes({ menuItem: "Mandi", lines: [] }, STOCK);
  assert.equal(out.recipes.length, 1);
  assert.equal(out.recipes[0].menuItem, "Mandi");
  assert.equal(out.menuItem, "Mandi");
});

test("an empty list of dishes is read as the old shape, not as nothing", () => {
  const out = buildRecipes({ recipes: [], menuItem: "Mandi", lines: [] }, STOCK);
  assert.equal(out.recipes.length, 1);
  assert.equal(out.menuItem, "Mandi");
});

/* Sheets with two quantity columns: one portion, and the batch.

   The live model read "مخزون 1.pdf" as per-portion quantities under portions
   15, which divides every quantity by fifteen. The numbers below are that
   sheet's first dish. */

const beefPlate = (lines, extra = {}) => ({
  menuItem: "Beef Plate", portions: 15, foodCost: 258.75, foodCostBasis: "batch", lines, ...extra,
});

test("a sheet with both columns is costed per portion, with portions 1", () => {
  const out = buildRecipe(beefPlate([
    { text: "Beef", qtyPerPortion: "0.200", qtyBatch: "3.000", unit: "kg" },
    { text: "Unsalted butter", qtyPerPortion: "0.025", qtyBatch: "0.375", unit: "kg" },
  ]), STOCK);
  assert.deepEqual(out.lines.map((l) => l.qty), [0.2, 0.025]);
  assert.equal(out.portions, 1);
});

test("the sheet's batch cost becomes a cost per portion with it", () => {
  /* Left as a batch cost under portions 1, AED 258.75 for fifteen plates
     would read as the cost of one. */
  const out = buildRecipe(beefPlate([{ text: "Beef", qtyPerPortion: "0.200", qtyBatch: "3.000", unit: "kg" }]), STOCK);
  assert.equal(out.statedCost, 17.25);
  assert.equal(out.statedCostBasis, "portion");
});

test("a line with only the batch figure is divided by the batch's portions", () => {
  const out = buildRecipe(beefPlate([
    { text: "Beef", qtyPerPortion: "0.200", qtyBatch: "3.000", unit: "kg" },
    { text: "Rosemary", qtyBatch: "0.075", unit: "kg" },
  ]), STOCK);
  assert.equal(out.lines[1].qty, 0.005);
});

test("a qty that is already one portion of the batch is recognised as such", () => {
  /* The shape the live model actually produced, plus the batch column. */
  const out = buildRecipe(beefPlate([{ text: "Beef", qty: "0.2", qtyBatch: "3.000", unit: "kg" }]), STOCK);
  assert.equal(out.lines[0].qty, 0.2);
  assert.equal(out.portions, 1);
});

test("a qty that is the batch figure is divided like one", () => {
  const out = buildRecipe(beefPlate([{ text: "Beef", qty: "3.000", qtyBatch: "3.000", unit: "kg" }]), STOCK);
  assert.equal(out.lines[0].qty, 0.2);
});

test("packaging follows the same columns as the food", () => {
  const out = buildRecipe(beefPlate(
    [{ text: "Beef", qtyPerPortion: "0.200", qtyBatch: "3.000", unit: "kg" }],
    { packaging: [{ text: "Box", qtyPerPortion: "1", qtyBatch: "15", unit: "pcs" }] },
  ), STOCK);
  assert.equal(out.packaging[0].qty, 1);
});

test("an ordinary card with one column is untouched", () => {
  const out = buildRecipe({
    menuItem: "Hummus", portions: 4, foodCost: 12, foodCostBasis: "batch",
    lines: [{ text: "Chickpeas", qty: "400", unit: "g" }],
  }, STOCK);
  assert.equal(out.lines[0].qty, 400);
  assert.equal(out.portions, 4);
  assert.equal(out.statedCost, 12);
  assert.equal(out.statedCostBasis, "batch");
});

test("a batch figure with no stated portions is not passed off as one portion", () => {
  const out = buildRecipe({ menuItem: "Stew", lines: [{ text: "Lamb", qtyBatch: "3.000", unit: "kg" }] }, STOCK);
  assert.equal(out.lines[0].qty, null);
  assert.equal(out.portions, 1);
  assert.equal(out.portionsStated, false);
});

test("each dish on a multi-dish sheet is settled on its own", () => {
  const out = buildRecipes({ recipes: [
    beefPlate([{ text: "Beef", qtyPerPortion: "0.200", qtyBatch: "3.000", unit: "kg" }]),
    { menuItem: "Hummus", portions: 4, lines: [{ text: "Chickpeas", qty: "400", unit: "g" }] },
  ] }, STOCK);
  assert.deepEqual(out.recipes.map((r) => r.portions), [1, 4]);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
