/* Turning a scanned bill into stock movements.

   What these protect: quantities scale by how many were sold; yield puts the
   trimmings back so a dish never looks cheaper to make than it is; the same
   ingredient across two dishes is summed once; a dish with no recipe is named
   rather than skipped silently; and an unreadable quantity is never assumed
   to be one. */

import assert from "node:assert/strict";
import { planFromLines, scaleLine } from "./_depletion.js";

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

const recipe = (menuItem, lines, { portions = 1, yieldPct = 100 } = {}) => ({
  menuItem,
  archived: false,
  versions: [{ effectiveFrom: 0, portions, yieldPct, lines }],
});

const CHICKEN = { ingredientId: "chicken", name: "Chicken", qtyBase: 200, baseUnit: "g" };
const BREAD = { ingredientId: "bread", name: "Bread", qtyBase: 1, baseUnit: "pcs" };

function menu(...recipes) {
  return new Map(recipes.map((r) => [r.menuItem, r]));
}

test("a portion's ingredients scale by how many were sold", () => {
  const out = planFromLines(
    [{ menuItem: "Shawarma", qty: 3, text: "SHAWARMA x3" }],
    menu(recipe("Shawarma", [CHICKEN, BREAD])),
  );
  const chicken = out.movements.find((m) => m.ingredientId === "chicken");
  assert.equal(chicken.qty, 600, "3 x 200g");
  assert.equal(chicken.unit, "g");
  assert.equal(out.movements.find((m) => m.ingredientId === "bread").qty, 3);
});

test("yield puts the trimmings back", () => {
  const out = planFromLines(
    [{ menuItem: "Salad", qty: 1 }],
    menu(recipe("Salad", [{ ingredientId: "carrot", name: "Carrot", qtyBase: 80, baseUnit: "g" }],
      { yieldPct: 80 })),
  );
  assert.equal(out.movements[0].qty, 100,
    "80g on the plate at 80% yield means 100g left the store");
});

test("scaleLine leaves a full-yield recipe alone", () => {
  assert.equal(scaleLine(200, 100), 200);
  assert.equal(scaleLine(200, 0), 200, "a missing yield must not divide by zero");
});

test("a batch recipe divides by its portions", () => {
  const out = planFromLines(
    [{ menuItem: "Soup", qty: 2 }],
    menu(recipe("Soup", [{ ingredientId: "stock", name: "Stock", qtyBase: 5000, baseUnit: "ml" }],
      { portions: 10 })),
  );
  assert.equal(out.movements[0].qty, 1000, "2 bowls out of a 10-portion batch");
});

test("the same ingredient in two dishes is summed once", () => {
  const out = planFromLines(
    [{ menuItem: "Shawarma", qty: 2 }, { menuItem: "Wrap", qty: 1 }],
    menu(recipe("Shawarma", [CHICKEN]), recipe("Wrap", [CHICKEN])),
  );
  assert.equal(out.movements.length, 1, "one ingredient, one movement");
  assert.equal(out.movements[0].qty, 600, "400 + 200");
  assert.deepEqual(out.movements[0].from.sort(), ["Shawarma", "Wrap"]);
});

test("a dish with no recipe is named, not skipped", () => {
  const out = planFromLines(
    [{ menuItem: "Shawarma", qty: 1 }, { menuItem: "Mystery Special", qty: 1 }],
    menu(recipe("Shawarma", [CHICKEN])),
  );
  assert.equal(out.movements.length, 1);
  assert.deepEqual(out.noRecipe, [{ menuItem: "Mystery Special", reason: "recipe" }]);
  assert.equal(out.complete, false, "a partial plan must not claim to be whole");
});

test("an unreadable quantity is reported, never assumed to be one", () => {
  const out = planFromLines(
    [{ menuItem: "Shawarma", qty: null }],
    menu(recipe("Shawarma", [CHICKEN])),
  );
  assert.equal(out.movements.length, 0);
  assert.deepEqual(out.noRecipe, [{ menuItem: "Shawarma", reason: "qty" }]);
});

test("an unmatched line is carried through so the screen can say so", () => {
  const out = planFromLines(
    [{ menuItem: null, text: "SMUDGED LINE" }],
    menu(recipe("Shawarma", [CHICKEN])),
  );
  assert.deepEqual(out.unmatched, ["SMUDGED LINE"]);
  assert.equal(out.complete, false);
});

test("a fully matched bill reports itself complete", () => {
  const out = planFromLines(
    [{ menuItem: "Shawarma", qty: 2 }],
    menu(recipe("Shawarma", [CHICKEN])),
  );
  assert.equal(out.complete, true);
});

test("an empty bill proposes nothing and is not complete", () => {
  const out = planFromLines([], menu(recipe("Shawarma", [CHICKEN])));
  assert.deepEqual(out.movements, []);
  assert.equal(out.complete, false, "nothing to do is not a finished job");
});

test("a recipe with no lines yields no movements", () => {
  const out = planFromLines(
    [{ menuItem: "Water", qty: 1 }],
    menu(recipe("Water", [])),
  );
  assert.equal(out.movements.length, 0);
  assert.equal(out.noRecipe[0].reason, "recipe");
});

test("units are never mixed within one movement", () => {
  const out = planFromLines(
    [{ menuItem: "Combo", qty: 1 }],
    menu(recipe("Combo", [
      { ingredientId: "x", name: "X", qtyBase: 100, baseUnit: "g" },
      { ingredientId: "x", name: "X", qtyBase: 2, baseUnit: "pcs" },
    ])),
  );
  assert.equal(out.movements.length, 2,
    "the same id in two units is two movements, not a nonsense sum");
});

test("fractional quantities do not accumulate floating-point noise", () => {
  const out = planFromLines(
    [{ menuItem: "Tea", qty: 3 }],
    menu(recipe("Tea", [{ ingredientId: "leaf", name: "Leaf", qtyBase: 0.1, baseUnit: "kg" }])),
  );
  assert.equal(out.movements[0].qty, 0.3, "0.30000000000000004 is not a quantity");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
