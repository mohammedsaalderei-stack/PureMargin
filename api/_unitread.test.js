/* Reading a unit somebody wrote, rather than matching it letter for letter.

   ── The bug ──────────────────────────────────────────────────────────────

   "The unit of one of the lines does not suit that ingredient." One sentence,
   shown for three unrelated problems, naming neither the line nor the fix.

   The commonest of the three was not a problem at all. The ledger keys on
   "kg", "l" and "ea"; the routes compared what arrived against that set
   literally; and what arrives is either a word a scanner read off somebody's
   paperwork or a word somebody typed. "Kg" was refused. So were "L", "Pcs",
   "كجم" and "piraso" — every one of them a spelling `_unitwords.js` has known
   since it was written, because the scanners already normalise before they
   propose. Nothing normalised at the commit.

   ── What is checked here ─────────────────────────────────────────────────

   That the reading happens, that it is spelling and never arithmetic, and that
   the two failures a person does have to answer stay separate from each other
   and from the one the app can settle alone. */

import assert from "node:assert/strict";
import { resolveUnit, normaliseUnit, isPackaging } from "./_unitwords.js";
import { convert, sameDimension } from "./_units.js";

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

test("the spellings that were being refused now read", () => {
  /* Straight off the document that prompted this: a stock sheet printing
     "kg", "L" and "Pcs" down one column. Two of those three were refused. */
  assert.equal(resolveUnit("kg").unit, "kg");
  assert.equal(resolveUnit("Kg").unit, "kg");
  assert.equal(resolveUnit("KG").unit, "kg");
  assert.equal(resolveUnit("L").unit, "l");
  assert.equal(resolveUnit("Pcs").unit, "ea");
  assert.equal(resolveUnit("PCS").unit, "ea");
  assert.equal(resolveUnit("Ltr").unit, "l");
});

test("and so do the ones written in the languages this app is used in", () => {
  assert.equal(resolveUnit("كجم").unit, "kg");
  assert.equal(resolveUnit("كيلو").unit, "kg");
  assert.equal(resolveUnit("لتر").unit, "l");
  assert.equal(resolveUnit("حبة").unit, "ea");
  assert.equal(resolveUnit("किलो").unit, "kg");
  assert.equal(resolveUnit("piraso").unit, "ea");
});

test("reading a unit is spelling, never arithmetic", () => {
  /* The reason this is safe to do at a commit boundary. A line's unit cost was
     quoted against its quantity, and if reading the word could change the
     number the two would come apart — 12.50 a kilo silently becoming 12.50 a
     gram. Nothing here touches a quantity: it maps a word to a key, and the
     key means exactly what the word did. */
  for (const [written, key] of [["Kg", "kg"], ["L", "l"], ["Pcs", "ea"], ["كجم", "kg"]]) {
    assert.equal(convert(1, key, key), 1, `${written} keeps its scale`);
    assert.equal(resolveUnit(written).unit, normaliseUnit(written));
  }
});

test("reading the word never decides whether it fits the ingredient", () => {
  /* Kept apart on purpose. If this returned a resolved unit beside a dimension
     error, every caller writing the natural `resolveUnit(x).unit || x` would
     accept pieces against a shelf kept in kilograms — the one refusal that
     must survive, because the weight of a piece is a fact nobody supplied and
     guessing it puts a number in the ledger no scale produced.

     So the word is read here and the fit is judged where the ingredient is:
     `validateMovement`, `buildLines`, and the three paths in _purchasing.js.
     Composed, that is still a refusal. */
  const asWritten = resolveUnit("Pcs").unit;
  assert.equal(asWritten, "ea", "the word is read");
  assert.equal(sameDimension(asWritten, "kg"), false, "and then refused against the shelf");
  assert.equal(sameDimension(resolveUnit("L").unit, "kg"), false, "a litre of oil is not a kilo of it");
});

test("the same units in the same dimension pass, whatever their spelling", () => {
  /* The point of the whole change: these were all refused before, and every
     one of them is an ordinary way to write a unit the shelf already keeps. */
  for (const [written, stock] of [["Kg", "g"], ["Ltr", "ml"], ["Pcs", "ea"], ["كجم", "kg"]]) {
    const read = resolveUnit(written).unit;
    assert.ok(read, `${written} is read`);
    assert.equal(sameDimension(read, stock), true, `${written} against a shelf in ${stock}`);
  }
});

test("a pack is told apart from a unit, because it is a different question", () => {
  /* "3 SACK" is not an unrecognised word — it is a quantity of packaging, and
     what is missing is how much one holds. Answering "that unit doesn't suit
     the ingredient" invites somebody to change the unit, which is the one
     thing that will not help. */
  for (const word of ["sack", "SACK", "box", "carton", "كيس", "علبة", "kahon"]) {
    const out = resolveUnit(word);
    assert.equal(out.error, "packaging", word);
    assert.equal(out.printed, word, "the word comes back so the screen can quote it");
  }
});

test("a word nothing can place is its own answer, not a dimension problem", () => {
  const out = resolveUnit("blorp");
  assert.equal(out.error, "unitword");
  assert.notEqual(out.error, "dimension");
});

test("nothing at all is refused rather than defaulted", () => {
  /* A blank unit silently becoming grams is how a stock balance ends up a
     thousand times too big. */
  assert.equal(resolveUnit("").error, "unitword");
  assert.equal(resolveUnit(null).error, "unitword");
  assert.equal(resolveUnit(undefined).error, "unitword");
});

/* ── Through the parts a commit actually goes through ────────────────────

   The reading above is only worth anything if the writers use it. These run
   against the memory store, so they exercise the real functions rather than
   asserting that a string appears somewhere in a source file. */

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const { saveIngredient, listIngredients } = await import("./_inventory.js");
const { recordMovement, balances } = await import("./_movements.js");

await asyncTest("an ingredient proposed in the units a scan prints is created", async () => {
  /* This is where lines were being lost silently. The invoice handler creates
     any ingredient a line names, and skips the line when the master refuses —
     so "Fresh Brioche Burger Buns, Pcs" was refused for its unit and its whole
     line went unreceived, with nothing on screen saying so. */
  const out = await saveIngredient("org-u", { name: "Brioche buns", stockUnit: "Pcs" });
  assert.equal(out.error, undefined, "Pcs is a unit this app knows");
  assert.equal(out.ingredient.stockUnit, "ea", "stored as the ledger's own key");

  const litres = await saveIngredient("org-u", { name: "Olive oil", stockUnit: "L" });
  assert.equal(litres.error, undefined);
  assert.equal(litres.ingredient.stockUnit, "l");

  const arabic = await saveIngredient("org-u", { name: "Beef mince", stockUnit: "كجم" });
  assert.equal(arabic.error, undefined);
  assert.equal(arabic.ingredient.stockUnit, "kg");
});

await asyncTest("a purchase unit is read the same way as a stock unit", async () => {
  const out = await saveIngredient("org-u", {
    name: "Tinned tomatoes", stockUnit: "Kg", purchaseUnit: "KG", packSize: 6,
  });
  assert.equal(out.error, undefined);
  assert.equal(out.ingredient.stockUnit, "kg");
  assert.equal(out.ingredient.purchaseUnit, "kg");
});

await asyncTest("a word that is not a unit is still refused, by name", async () => {
  /* The reading is spelling, not permission. "sack" stays refused, because a
     sack is a pack size nobody has stated. */
  const out = await saveIngredient("org-u", { name: "Flour", stockUnit: "sack" });
  assert.equal(out.error, "stockUnit");
});

await asyncTest("a delivery written in the supplier's spelling is received", async () => {
  /* The whole point, end to end: 2 kg received against a shelf kept in
     kilograms, written the way a supplier writes it. */
  const kg = await recordMovement("org-u", "b1", {
    ingredientId: "beef-mince", type: "receive", qty: 2, unit: "kg", unitCost: 30,
  });
  assert.equal(kg.error, undefined);

  const rows = await balances("org-u", ["b1"], { ingredients: await listIngredients("org-u") });
  const beef = rows.find((r) => r.ingredientId === "beef-mince");
  assert.equal(beef.qty, 2, "two kilos on the shelf");
  assert.equal(beef.stockUnit, "kg", "counted in what the shelf keeps");
});

await asyncTest("a refusal now names the ingredient and the unit it is kept in", async () => {
  /* Without these the screen could only ever say "one of the lines", which on
     a forty-eight-line delivery is not an error message, it is a puzzle. */
  const out = await recordMovement("org-u", "b1", {
    ingredientId: "beef-mince", type: "receive", qty: 3, unit: "ea",
  });
  assert.equal(out.error, "unit", "pieces against a shelf kept in kilograms");
  assert.equal(out.ingredientName, "Beef mince", "which ingredient");
  assert.equal(out.stockUnit, "kg", "and what it is actually kept in");
});

await asyncTest("a missing ingredient still refuses without inventing a name", async () => {
  const out = await recordMovement("org-u", "b1", {
    ingredientId: "nothing-here", type: "receive", qty: 1, unit: "kg",
  });
  assert.equal(out.error, "ingredientId");
  assert.equal(out.ingredientName, "", "nothing to name, and nothing invented");
});

/* ── The alias table, as a specification ─────────────────────────────────

   Written out rather than sampled, because the point of a vocabulary is that
   every word in it works and there is no way to tell from the code which ones
   were tried. */

const CANONICAL = [
  ["kg", ["kg", "Kg", "KG", "kgs", "kilo", "kilos", "kilogram", "kilograms",
          "كجم", "كغ", "كيلو", "كيلوغرام", "كيلوجرام", "كجم (kg)", "Kg (كجم)"]],
  ["g", ["g", "gm", "gr", "gram", "grams", "جم", "جرام", "غرام", "غ", "gm (جم)"]],
  ["mg", ["mg", "milligram", "milligrams", "مجم"]],
  ["l", ["l", "L", "lt", "ltr", "liter", "litre", "liters", "litres",
         "لتر", "ل", "لترات", "لتر (L)"]],
  ["ml", ["ml", "mls", "millilitre", "milliliter", "مل", "ملل", "مللتر", "مليلتر"]],
  ["ea", ["ea", "each", "pc", "pcs", "piece", "pieces", "unit", "units",
          "حبة", "حبه", "قطعة", "قطعه", "عدد", "وحدة", "حبة (pcs)", "Pcs (حبة)"]],
  ["gal", ["gal", "gallon", "gallons", "جالون"]],
  ["lb", ["lb", "lbs", "pound", "pounds", "رطل"]],
  ["dozen", ["dozen", "dz", "دزينة", "درزن"]],
];

test("every spelling in the vocabulary resolves to its canonical key", () => {
  for (const [key, words] of CANONICAL) {
    for (const word of words) {
      assert.equal(normaliseUnit(word), key, `${JSON.stringify(word)} should read as ${key}`);
    }
  }
});

test("a packaging word is never quietly turned into a piece", () => {
  /* Asked for twice, and refused twice, for one reason: a carton recorded as
     one piece is a stock balance wrong by however many things were in the
     carton, and it looks exactly like a correct one. What a package needs is
     its contents, which the invoice often prints — see `packContents` — and
     which the screen asks for when it does not. */
  for (const word of ["box", "carton", "case", "علبة", "علبه", "كرتون", "صندوق", "sack", "كيس"]) {
    assert.equal(normaliseUnit(word), null, `${word} is not a unit`);
    assert.equal(isPackaging(word), true, `${word} is a package`);
  }
});

await asyncTest("a unit written any way at all is converted, not blocked", async () => {
  /* The complaint, exactly: "Ground beef is kept in kg, and the line is
     written in كجم (kg)." The reading used to happen at each route, so a
     route that forgot — or a caller added later — was a route where this was
     refused. It happens in `validateMovement` now, which is the thing that
     actually decides. */
  await saveIngredient("org-c", { name: "Ground beef", stockUnit: "kg" });
  await saveIngredient("org-c", { name: "Olive oil", stockUnit: "ml" });

  const written = [
    ["ground-beef", 3, "كجم (kg)", 3000],
    ["ground-beef", 500, "g", 500],
    ["ground-beef", 2, "كيلو", 2000],
    ["ground-beef", 1, "Kg (كجم)", 1000],
    ["olive-oil", 2, "لتر (L)", 2000],
    ["olive-oil", 1, "gallon", 3785.411784],
  ];
  for (const [id, qty, unit, base] of written) {
    const out = await recordMovement("org-c", "b1", { ingredientId: id, type: "receive", qty, unit });
    assert.equal(out.error, undefined, `${qty} ${unit} should be accepted`);
    assert.ok(Math.abs(out.movement.qtyBase - base) < 1e-6,
      `${qty} ${unit} should be ${base} base units, was ${out.movement.qtyBase}`);
  }
});

await asyncTest("the canonical unit is what gets stored, not what was typed", async () => {
  /* Otherwise "كجم (kg)" and "kg" sit in the ledger as two different units
     for the same movement, and anything grouping by unit treats them as two
     different things. */
  await saveIngredient("org-d", { name: "Ground beef", stockUnit: "kg" });
  const out = await recordMovement("org-d", "b1", {
    ingredientId: "ground-beef", type: "receive", qty: 3, unit: "كجم (kg)",
  });
  assert.equal(out.movement.unit, "kg");
  assert.equal(out.movement.qty, 3, "the number is untouched — this is spelling, not arithmetic");
});

await asyncTest("what must still be refused, still is", async () => {
  await saveIngredient("org-e", { name: "Ground beef", stockUnit: "kg" });
  await saveIngredient("org-e", { name: "Buns", stockUnit: "ea" });

  /* A package, which needs its contents, not a unit. */
  const box = await recordMovement("org-e", "b1", {
    ingredientId: "ground-beef", type: "receive", qty: 3, unit: "علبة",
  });
  assert.equal(box.error, "unit");

  /* A count against a weight, which needs a weight per piece nobody supplied. */
  const wrong = await recordMovement("org-e", "b1", {
    ingredientId: "ground-beef", type: "receive", qty: 3, unit: "ea",
  });
  assert.equal(wrong.error, "unit");
  assert.equal(wrong.stockUnit, "kg", "and says what the shelf keeps, so the screen can explain");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
