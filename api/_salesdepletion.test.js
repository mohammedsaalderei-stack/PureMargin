/* Taking stock out as sales come in.

   What these protect: a sale draws its ingredients at gross rather than net; a
   receipt is never posted twice however often it is re-read; a dish with no
   recipe does not stall the receipt behind it; and the movements written carry
   the flag that keeps variance from comparing a number with itself. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const sd = await import("./_salesdepletion.js");

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

const recipe = (menuItem, lines, { portions = 1, yieldPct = 100 } = {}) => ({
  menuItem, archived: false,
  versions: [{ effectiveFrom: 0, portions, yieldPct, lines }],
});

const CHICKEN = { ingredientId: "chicken", name: "Chicken", qtyBase: 200, baseUnit: "g" };
const index = (...rs) => sd.indexRecipes(rs);

const receipt = (id, lines, at = Date.now()) => ({ id, branchId: "b1", at, lines });

await test("a sale draws its ingredients", () => {
  const out = sd.consumptionOf(
    receipt("r1", [{ name: "Shawarma", qty: 3 }]),
    index(recipe("Shawarma", [CHICKEN])), Date.now());
  assert.equal(out.movements[0].qty, 600, "3 × 200g");
  assert.equal(out.movements[0].unit, "g");
});

await test("yield is applied, so trim leaves the store too", () => {
  const out = sd.consumptionOf(
    receipt("r1", [{ name: "Salad", qty: 1 }]),
    index(recipe("Salad", [{ ingredientId: "carrot", qtyBase: 80, baseUnit: "g" }], { yieldPct: 80 })),
    Date.now());
  assert.equal(out.movements[0].qty, 100, "80g on the plate came from 100g in the store");
});

await test("a batch recipe divides by its portions", () => {
  const out = sd.consumptionOf(
    receipt("r1", [{ name: "Soup", qty: 2 }]),
    index(recipe("Soup", [{ ingredientId: "stock", qtyBase: 5000, baseUnit: "ml" }], { portions: 10 })),
    Date.now());
  assert.equal(out.movements[0].qty, 1000);
});

await test("a variant recipe is preferred over the plain name", () => {
  const idx = index(recipe("Latte", [{ ingredientId: "milk", qtyBase: 150, baseUnit: "ml" }]),
                    recipe("Latte Large", [{ ingredientId: "milk", qtyBase: 250, baseUnit: "ml" }]));
  const out = sd.consumptionOf(
    receipt("r1", [{ name: "Latte", variant: "Large", qty: 1 }]), idx, Date.now());
  assert.equal(out.movements[0].qty, 250, "a large latte is not a regular one");
});

await test("the same ingredient across two lines is summed once", () => {
  const out = sd.consumptionOf(
    receipt("r1", [{ name: "Shawarma", qty: 1 }, { name: "Wrap", qty: 2 }]),
    index(recipe("Shawarma", [CHICKEN]), recipe("Wrap", [CHICKEN])), Date.now());
  assert.equal(out.movements.length, 1);
  assert.equal(out.movements[0].qty, 600);
});

await test("a dish with no recipe is named, not silently dropped", () => {
  const out = sd.consumptionOf(
    receipt("r1", [{ name: "Mystery", qty: 1 }]),
    index(recipe("Shawarma", [CHICKEN])), Date.now());
  assert.deepEqual(out.movements, []);
  assert.deepEqual(out.unmatched, ["Mystery"]);
});

await test("a zero or unreadable quantity consumes nothing", () => {
  for (const qty of [0, -2, null, "two"]) {
    const out = sd.consumptionOf(receipt("r", [{ name: "Shawarma", qty }]),
      index(recipe("Shawarma", [CHICKEN])), Date.now());
    assert.deepEqual(out.movements, [], `qty ${JSON.stringify(qty)} must move nothing`);
  }
});

await test("an archived recipe is not used", () => {
  const r = recipe("Shawarma", [CHICKEN]); r.archived = true;
  const out = sd.consumptionOf(receipt("r1", [{ name: "Shawarma", qty: 1 }]),
    sd.indexRecipes([r]), Date.now());
  assert.deepEqual(out.unmatched, ["Shawarma"]);
});

await test("matching a dish name ignores case and spacing", () => {
  const out = sd.consumptionOf(
    receipt("r1", [{ name: "  chicken   SHAWARMA " }, ].map((l) => ({ ...l, qty: 1 }))),
    index(recipe("Chicken Shawarma", [CHICKEN])), Date.now());
  assert.equal(out.movements.length, 1);
});

await test("a receipt already posted is not posted again", async () => {
  const seen = await sd.postedIds("org1", "b1");
  assert.equal(seen.size, 0, "nothing posted yet");
});

await test("nothing to post reports nothing done", async () => {
  const out = await sd.depleteFromSales("org1", "b1", []);
  assert.equal(out.posted, 0);
  assert.equal(out.movements, 0);
});

await test("a missing org or branch is refused rather than guessed", async () => {
  assert.equal((await sd.depleteFromSales(null, "b1", [receipt("r1", [])])).posted, 0);
  assert.equal((await sd.depleteFromSales("org1", null, [receipt("r1", [])])).posted, 0);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
