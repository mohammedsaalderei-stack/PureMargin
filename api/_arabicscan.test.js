/* Does a scan work in Arabic? It did not, and nothing said so.

   ── The bug ──────────────────────────────────────────────────────────────

   `tokens()` in _purchase.js split a description on `[^a-z0-9]+`. That does
   not merely ignore Arabic — it deletes it. Every Arabic line tokenised to the
   empty set, `score()` returned 0 for all of them, and `bestMatch` was dead in
   the language most of this app's users read.

   Nothing failed loudly. An Arabic invoice still matched when the model named
   the ingredient exactly, or when somebody had committed that wording before
   and taught the alias table — so it looked as though it worked. What was gone
   was the fallback underneath those two, which is the one that catches a
   supplier's first delivery and their abbreviations. Those lines arrived
   unmatched and the screen asked a person, every time, in Arabic only.

   ── What is checked ──────────────────────────────────────────────────────

   The three things a scan has to do with a language: read its units, match its
   words, and refuse the same things it would refuse in English. */

import assert from "node:assert/strict";
import { bestMatch, buildPurchase, proposeItem } from "./_purchase.js";
import { normaliseUnit, isPackaging } from "./_unitwords.js";

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

const SHELF = [
  { id: "lahm", name: "لحم مفروم", stockUnit: "kg", purchaseUnit: "kg", packSize: 1 },
  { id: "zayt", name: "زيت زيتون", stockUnit: "ml", purchaseUnit: "ml", packSize: 1 },
  { id: "khubz", name: "خبز برجر", stockUnit: "ea", purchaseUnit: "ea", packSize: 1 },
  { id: "tamatim", name: "طماطم", stockUnit: "kg", purchaseUnit: "kg", packSize: 1 },
];

test("an Arabic description matches an Arabic ingredient", () => {
  /* Every one of these returned nothing at all. */
  const cases = [
    ["لحم مفروم طازج ٥ كجم", "لحم مفروم"],
    ["زيت زيتون بكر ممتاز ٥ لتر", "زيت زيتون"],
    ["خبز برجر بريوش ٦٠ حبة", "خبز برجر"],
    ["طماطم حمراء درجة أولى", "طماطم"],
  ];
  for (const [text, expected] of cases) {
    const hit = bestMatch(text, SHELF);
    assert.ok(hit, `no match for ${text}`);
    assert.equal(hit.ingredient.name, expected, text);
  }
});

test("the definite article does not hide the word", () => {
  /* Arabic writes "the" as a prefix, so a supplier's "اللحم المفروم" and a
     shelf's "لحم مفروم" share no token until it comes off — the same failure
     the English plural rules already existed for. */
  assert.equal(bestMatch("اللحم المفروم بقري", SHELF)?.ingredient.name, "لحم مفروم");
  assert.equal(bestMatch("زيت الزيتون البكر", SHELF)?.ingredient.name, "زيت زيتون");
});

test("spelling variations a supplier's printer introduces are folded", () => {
  /* أ إ آ are all typed ا by somebody in a hurry, and ة/ه and ى/ي are the same
     word ending written two ways. A shelf label and an invoice rarely agree. */
  const shelf = [{ id: "asmak", name: "أسماك طازجة", stockUnit: "kg" }];
  assert.ok(bestMatch("اسماك طازجه مبردة", shelf), "alef and ta-marbuta folded");
});

test("it still refuses what is genuinely not on the list", () => {
  /* The point of a fallback matcher is that it fails honestly. A matcher that
     started saying yes to everything in Arabic would be worse than one that
     said no to everything. */
  assert.equal(bestMatch("منظفات وصابون", SHELF), null);
  assert.equal(bestMatch("رسوم توصيل", SHELF), null);
});

test("English still matches exactly as before", () => {
  const shelf = [...SHELF, { id: "mince", name: "Beef mince", stockUnit: "kg" }];
  assert.equal(bestMatch("BEEF MINCE PREMIUM 5KG", shelf)?.ingredient.name, "Beef mince");
  /* The plural fold, which the script change must not have broken. */
  assert.equal(bestMatch("TOMATO RED GRADE A 5KG BOX", [{ id: "t", name: "Tomatoes", stockUnit: "kg" }])
    ?.ingredient.name, "Tomatoes");
});

test("Arabic units read into the ones the ledger keeps", () => {
  assert.equal(normaliseUnit("كجم"), "kg");
  assert.equal(normaliseUnit("كيلو"), "kg");
  assert.equal(normaliseUnit("لتر"), "l");
  assert.equal(normaliseUnit("مل"), "ml");
  assert.equal(normaliseUnit("حبة"), "ea");
  assert.equal(normaliseUnit("جم"), "g");
});

test("an Arabic ingredient proposal is read, not defaulted", () => {
  /* The model is asked for one of kg|g|l|ml|ea and, reading an Arabic note,
     sometimes answers in the document's own words. "كجم" reaching the default
     branch happened to land on "kg" by luck; "لتر" would have landed on
     kilograms, and a litre of oil recorded as a mass is wrong in every recipe
     built on it. */
  assert.equal(proposeItem({ newItem: { name: "دقيق", stockUnit: "كجم" } }, "دقيق", "كيس").stockUnit, "kg");
  assert.equal(proposeItem({ newItem: { name: "زيت", stockUnit: "لتر" } }, "زيت", "كرتون").stockUnit, "l");
  assert.equal(proposeItem({ newItem: { name: "بيض", stockUnit: "حبة" } }, "بيض", "طبق").stockUnit, "ea");
});

test("a whole Arabic delivery note comes out as stock", () => {
  const out = buildPurchase({
    supplier: "شركة الخليج للأغذية",
    invoiceNo: "ف-4471",
    lines: [
      { text: "لحم مفروم طازج ٥ كجم", qty: 5, unit: "كجم", amount: 100 },
      { text: "زيت زيتون كرتون", qty: 1, unit: "كرتون",
        pack: { count: 12, size: 1, unit: "لتر" }, amount: 240 },
      { text: "خبز برجر ٦٠ حبة", qty: 60, unit: "حبة", amount: 90 },
    ],
  }, SHELF);

  const [meat, oil, bread] = out.lines;

  assert.equal(meat.ingredientName, "لحم مفروم");
  assert.equal(meat.receiveQty, 5);
  assert.equal(meat.receiveUnit, "kg");
  assert.equal(meat.unitCost, 20);
  assert.equal(meat.trouble, null);

  /* A carton described in Arabic, read apart the same way an English one is. */
  assert.equal(oil.ingredientName, "زيت زيتون");
  assert.equal(oil.receiveQty, 12000);
  assert.equal(oil.receiveUnit, "ml");
  assert.equal(oil.unitCost, 0.02);
  assert.equal(oil.trouble, null);

  assert.equal(bread.ingredientName, "خبز برجر");
  assert.equal(bread.receiveQty, 60);
  assert.equal(bread.receiveUnit, "ea");

  assert.equal(out.matchedCount, 3, "matched without the model naming any of them");
  assert.equal(out.complete, true);
});

test("an Arabic line the shelf cannot take is flagged like any other", () => {
  const out = buildPurchase({
    lines: [{ text: "خبز برجر ٢ كجم", qty: 2, unit: "كجم", amount: 30 }],
  }, SHELF);
  assert.equal(out.lines[0].trouble, "unit", "bread is counted, not weighed");
  assert.equal(out.lines[0].stocksIn, "ea");
});

test("a unit printed in both languages at once is one unit, not an unreadable one", () => {
  /* Paperwork written for a bilingual kitchen prints both spellings in the
     same cell — "كجم (kg)", "حبة (pcs)", "لتر (L)". Reading only the whole
     phrase refused every line on such a document, and the refusal it produced
     contradicted itself: "Ground beef is kept in kg, and the line is written
     in كجم (kg). Change one of the two." They were already the same unit. */
  assert.equal(normaliseUnit("كجم (kg)"), "kg");
  assert.equal(normaliseUnit("Kg (كجم)"), "kg");
  assert.equal(normaliseUnit("لتر (L)"), "l");
  assert.equal(normaliseUnit("حبة (pcs)"), "ea");
  assert.equal(normaliseUnit("قطعة (piece)"), "ea");
  assert.equal(normaliseUnit("gm (جم)"), "g");
});

test("a phrase naming two different units is still refused", () => {
  /* Agreement is the whole test. Taking the first of "kg / L" would be
     guessing, and a wrong unit multiplies a stock balance by the size of the
     mistake. */
  assert.equal(normaliseUnit("kg / L"), null);
  assert.equal(normaliseUnit("كجم / لتر"), null);
});

test("a unit whose own name is two words is not read as its second half", () => {
  /* The whole phrase is tried before its words, or "fl oz" would come back as
     ounces and "ملعقة صغيرة" as nothing at all. */
  assert.equal(normaliseUnit("fl oz"), "floz");
  assert.equal(normaliseUnit("ملعقة صغيرة"), "tsp");
  assert.equal(normaliseUnit("ملعقة صغيرة (tsp)"), "tsp");
});

test("a package named in both languages still asks how much one holds", () => {
  assert.equal(isPackaging("كيس (sack)"), true);
  assert.equal(isPackaging("box (12)"), true);
  /* But not where the phrase names a real unit: "1 box of 12 kg" has already
     said what the amount is, and asking would be asking twice. */
  assert.equal(isPackaging("1 box of 12 kg"), false);
  assert.equal(normaliseUnit("1 box of 12 kg"), "kg");
});

test("a shared adjective does not file one ingredient as another", () => {
  /* From a real scan: a line reading "ثوم مفروم طازج (Fresh Garlic)" was
     received against "Tomatoes fresh". The word they share is "fresh", which
     is half of that ingredient's two words and so met the old floor exactly.
     So did parsley, and so did fish. The word saying what the thing actually
     was counted for nothing. */
  const shelf = [
    { id: "tomatoes-fresh", name: "Tomatoes fresh" },
    { id: "ground-beef", name: "Ground beef" },
  ];
  for (const text of [
    "ثوم مفروم طازج (Fresh Garlic)",
    "بقدونس طازج (Fresh Parsley)",
    "سمك طازج (Fresh Fish)",
  ]) {
    assert.equal(bestMatch(text, shelf), null, text);
  }

  /* The line that really is the tomatoes still matches. */
  assert.equal(bestMatch("طماطم طازجة (Fresh Tomatoes)", shelf)?.ingredient.name, "Tomatoes fresh");
  /* And a genuine partial — two words of three — is still a match. */
  assert.equal(
    bestMatch("MIXED SAUTEED VEG BOX", [{ id: "v", name: "Mixed sauteed veggies" }])?.ingredient.name,
    "Mixed sauteed veggies",
  );
});

test("an Arabic packaging word asks how much one holds", () => {
  const out = buildPurchase({
    lines: [{ text: "دقيق ٣ أكياس", qty: 3, unit: "كيس", amount: 60,
      newItem: { name: "دقيق", stockUnit: "كجم" } }],
  }, SHELF);
  assert.equal(out.lines[0].trouble, "packaging");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
