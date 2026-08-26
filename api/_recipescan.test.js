/* Reading a recipe card.

   What these protect: fractions written the way kitchens write them are read
   rather than discarded; ingredients are matched against the real master and
   never named by the model; a missing portion count defaults to one and says
   so; yield is never guessed from a photograph; and a unit that differs from
   the shelf's is carried through so the screen can flag it. */

import assert from "node:assert/strict";
import { buildRecipe, parseQty } from "./_recipescan.js";

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

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
