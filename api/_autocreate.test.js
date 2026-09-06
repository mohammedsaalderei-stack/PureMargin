/* Creating the ingredients an invoice names, without damaging the ones it hits.

   ── The two ways a line was still being dropped ──────────────────────────

   Auto-creation has been in the invoice route from the start: a line matching
   nothing carries what to create, and the route creates it before receiving
   anything. So "the system drops items not previously registered" was not what
   was happening. What was happening was narrower and worse.

   1. **The purchase unit sank the record.** The scanner proposes whatever the
      invoice printed, and for a supplier selling by the carton that is
      "Carton". `validateIngredient` refuses that as a purchase unit — rightly,
      it is not a unit — and the refusal took the whole ingredient with it. No
      ingredient meant no line, so a delivery reported "47 of 48 recorded"
      about a line with nothing wrong in it.

   2. **Creation overwrote.** It called `saveIngredient`, which writes a whole
      record. The matcher can fail on a description whose name then slugs to an
      ingredient that already exists — and when it did, that ingredient came
      back with its category, reorder point, par level, location and shelf life
      blanked, and its shelf relabelled from kilograms to grams. */

import assert from "node:assert/strict";

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const { saveIngredient, ensureIngredient, listIngredients } = await import("./_inventory.js");

await test("a packaging purchase unit no longer sinks the ingredient", async () => {
  /* Every one of these was refused, and its invoice line silently dropped. */
  const cases = [
    ["Truffle sauce", "l", "bottle", 6],
    ["Flour", "kg", "كيس", 25],
    ["Sliced cheese", "ea", "box", 12],
    ["Tinned tomatoes", "kg", "carton", 6],
  ];
  for (const [name, unit, purchaseUnit, packSize] of cases) {
    const out = await ensureIngredient("org-a", { name, unit, purchaseUnit, packSize });
    assert.equal(out.error, undefined, `${name} bought by the ${purchaseUnit}`);
    assert.equal(out.ingredient.stockUnit, unit, "kept in what the line measured");
    /* The word is dropped, not kept as a broken unit: how many go in one
       package is packSize, and that is the part that means anything. */
    assert.equal(out.ingredient.purchaseUnit, unit);
  }
});

await test("a real purchase unit is still kept, with its pack size", async () => {
  const out = await ensureIngredient("org-b", {
    name: "Beef mince", unit: "kg", purchaseUnit: "g", packSize: 1000,
  });
  assert.equal(out.ingredient.purchaseUnit, "g");
  assert.equal(out.ingredient.packSize, 1000);
});

await test("a purchase unit measuring the wrong thing is dropped, not refused", async () => {
  /* Litres of something counted in kilograms needs a density nobody supplied.
     Refusing the field would be right; refusing the ingredient would not. */
  const out = await ensureIngredient("org-c", {
    name: "Brioche buns", unit: "ea", purchaseUnit: "kg", packSize: 1,
  });
  assert.equal(out.error, undefined);
  assert.equal(out.ingredient.stockUnit, "ea");
  assert.equal(out.ingredient.purchaseUnit, "ea");
});

await test("creating over an existing ingredient changes nothing about it", async () => {
  /* The damage this could do, in the order it happened: somebody sets an
     ingredient up, a later scan fails to match its description, the name slugs
     to the same id, and the record is rewritten from the scan's blanks. */
  const set = await saveIngredient("org-d", {
    name: "Grilling butter", stockUnit: "kg", category: "dairy",
    reorderPoint: 5, parLevel: 20, supplierId: "gulf", location: "Chiller 2",
    aliases: ["زبدة الشوي"], shelfLifeDays: 30,
  });

  const again = await ensureIngredient("org-d", {
    name: "  GRILLING BUTTER  ", unit: "g", purchaseUnit: "g", packSize: 1,
  });

  assert.equal(again.created, false, "recognised as one that already exists");
  assert.equal(again.ingredient.id, set.ingredient.id, "trimmed and case-folded to one id");

  const kept = again.ingredient;
  assert.equal(kept.stockUnit, "kg", "the shelf is not relabelled by a scan");
  assert.equal(kept.category, "dairy");
  assert.equal(kept.reorderPoint, 5);
  assert.equal(kept.parLevel, 20);
  assert.equal(kept.location, "Chiller 2");
  assert.equal(kept.supplierId, "gulf");
  assert.equal(kept.shelfLifeDays, 30);
  assert.deepEqual(kept.aliases, ["زبدة الشوي"]);

  assert.equal((await listIngredients("org-d")).length, 1, "and no twin was made");
});

await test("but a blank the scan can fill is filled", async () => {
  /* Weaker evidence still beats no evidence. A category nobody set is not a
     decision being overridden. */
  await saveIngredient("org-e", { name: "Olive oil", stockUnit: "l" });
  const out = await ensureIngredient("org-e", { name: "Olive oil", unit: "l", category: "oil" });
  assert.equal(out.ingredient.category, "oil");

  /* And a category somebody chose is not replaced. */
  const again = await ensureIngredient("org-e", { name: "Olive oil", unit: "l", category: "dry" });
  assert.equal(again.ingredient.category, "oil");
});

await test("an archived ingredient comes back rather than being duplicated", async () => {
  await saveIngredient("org-f", { name: "Saffron", stockUnit: "g", archived: true });
  const out = await ensureIngredient("org-f", { name: "saffron", unit: "g" });
  assert.equal(out.ingredient.archived, false, "receiving it again means it is in use");
  assert.equal((await listIngredients("org-f")).length, 1);
});

await test("names differing only by case or spacing are one ingredient", async () => {
  /* The matching rule the requirement asks for, at the point it decides
     whether to create. */
  for (const name of ["Ground beef", "  ground beef", "GROUND BEEF  ", "Ground  beef"]) {
    await ensureIngredient("org-g", { name, unit: "kg" });
  }
  assert.equal((await listIngredients("org-g")).length, 1);
});

await test("a nameless line still cannot create anything", async () => {
  assert.equal((await ensureIngredient("org-h", { name: "   ", unit: "kg" })).error, "name");
  assert.equal((await ensureIngredient("org-h", { name: "", unit: "kg" })).error, "name");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
