/* Working in a language other than English.

   ── What was wrong ───────────────────────────────────────────────────────

   Two things, and the second was hiding behind the first.

   Text was folded in two different places with two different rules. The unit
   reader knew that "حبة" and "حبه" are one word; the ingredient matcher did
   not, so "زبده" failed to find "زبدة" on the shelf. Copies drift.

   Underneath that, `words()` split on `[^\p{L}\p{N}]+`, which treats a
   combining mark as punctuation. Devanagari writes its vowels as marks — the
   ي in क़ीमा is one — so every Hindi word came apart into single consonants,
   each too short to survive the length filter. Hindi matched nothing at all,
   silently, exactly as Arabic had before the split was widened past ASCII.

   And no amount of folding can know that "لحم مفروم" and "Ground beef" are the
   same thing: they share no letters. That is what the alias list is for. */

import assert from "node:assert/strict";
import { normaliseText, words } from "./_text.js";
import { bestMatch } from "./_purchase.js";
import { normaliseUnit } from "./_unitwords.js";
import { cleanAliases } from "./_inventory.js";

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

/* ── One normaliser, every script ───────────────────────────────────────── */

test("spellings of the same word fold together in every language", () => {
  const same = [
    ["زبدة غير مملحة", "زبده غير مملحه", "Arabic: ta marbuta typed as ha"],
    ["أسماك طازجة", "اسماك طازجه", "Arabic: alef with and without hamza"],
    ["مصطفى", "مصطفي", "Arabic: alef maqsura for ya"],
    ["٥ كجم", "5 كجم", "Arabic-Indic digits"],
    ["۵ کلو", "5 کلو", "Urdu-Persian digits"],
    ["کِلو", "کلو", "Urdu: optional vowel mark"],
    ["دودھ", "دودھ", "Urdu, unchanged"],
    ["ज़ीरा", "जीरा", "Devanagari: nukta written and not"],
    ["Sauté", "saute", "Latin accent"],
    ["Tomatoes  Fresh", "tomatoes fresh", "case and doubled space"],
  ];
  for (const [a, b, why] of same) {
    assert.equal(normaliseText(a), normaliseText(b), why);
  }
});

test("words that are genuinely different stay different", () => {
  /* Folding is for spelling, never for meaning. A normaliser that collapsed
     two real words would match a delivery of one against the other. */
  assert.notEqual(normaliseText("لحم"), normaliseText("شحم"));
  assert.notEqual(normaliseText("दूध"), normaliseText("दही"));
  assert.notEqual(normaliseText("beef"), normaliseText("veal"));
});

test("a Hindi word survives being split into words", () => {
  /* The bug that made Hindi match nothing: vowel signs are combining marks,
     and a splitter that treats them as boundaries returns consonants. */
  assert.deepEqual(words("क़ीमा 5 किलो"), ["कीमा", "5", "किलो"]);
  assert.deepEqual(words("दूध 12 लीटर"), ["दूध", "12", "लीटर"]);
  for (const w of words("क़ीमा 5 किलो")) {
    assert.ok(w.length >= 1, "no empty fragments");
  }
});

test("words come out whole in every script", () => {
  assert.deepEqual(words("لحم مفروم طازج"), ["لحم", "مفروم", "طازج"]);
  assert.deepEqual(words("giniling na baka"), ["giniling", "na", "baka"]);
  assert.deepEqual(words("قیمہ تازہ"), ["قيمہ", "تازہ"]);
  /* A bilingual line yields both halves, which is how a document printing
     "لحم مفروم (Ground Beef)" matches either name. */
  assert.deepEqual(words("لحم مفروم (Ground Beef)"), ["لحم", "مفروم", "ground", "beef"]);
});

/* ── Aliases ────────────────────────────────────────────────────────────── */

const BEEF = {
  id: "ground-beef", name: "Ground beef", stockUnit: "kg",
  aliases: ["لحم مفروم", "لحم بقر مفروم", "giniling na baka", "क़ीमा", "قیمہ"],
};
const MILK = {
  id: "whole-milk", name: "Whole milk", stockUnit: "ml",
  aliases: ["حليب كامل الدسم", "दूध", "gatas"],
};
const SHELF = [BEEF, MILK, { id: "buns", name: "Brioche buns", stockUnit: "ea" }];

test("an ingredient is found by any of the names it is known by", () => {
  /* No folding could have done this. "لحم مفروم" and "Ground beef" share no
     letters — somebody has to say once that they are the same thing. */
  const cases = [
    ["لحم مفروم طازج ٥ كجم", "Ground beef"],
    ["لحم بقر مفروم بلدي", "Ground beef"],
    ["GINILING NA BAKA 5KG", "Ground beef"],
    ["क़ीमा 5 किलो", "Ground beef"],
    ["कीमा 5 किलो", "Ground beef"],
    ["قیمہ ۵ کلو", "Ground beef"],
    ["GROUND BEEF PREMIUM 80/20", "Ground beef"],
    ["حليب كامل الدسم ١٢ لتر", "Whole milk"],
    ["दूध 12 लीटर", "Whole milk"],
    ["GATAS 12L", "Whole milk"],
  ];
  for (const [text, expected] of cases) {
    const hit = bestMatch(text, SHELF);
    assert.ok(hit, `no match for ${text}`);
    assert.equal(hit.ingredient.name, expected, text);
  }
});

test("aliases do not make the matcher say yes to everything", () => {
  /* A matcher that started matching in every language would be worse than one
     that matched in none: a wrong match is written into the ledger and nothing
     downstream contradicts it. */
  assert.equal(bestMatch("منظفات وصابون", SHELF), null);
  assert.equal(bestMatch("रसोई का सामान", SHELF), null);
  assert.equal(bestMatch("delivery charge", SHELF), null);
});

test("an alias is scored as its own name, not as extra words on the first", () => {
  /* Joined into one string, "Ground beef لحم مفروم" would be four words of
     which a line naming two scores 0.5 — below the floor — so adding an alias
     would have made the English name harder to match, not easier. */
  const hit = bestMatch("GROUND BEEF", SHELF);
  assert.equal(hit?.ingredient.name, "Ground beef");
  assert.equal(hit.confidence, 1, "the English name still scores as a whole name");
});

test("the alias list is tidied without being rewritten", () => {
  /* Shown back to whoever typed it, so the spelling they used is the spelling
     kept — folding is for comparing, not for storing. */
  const out = cleanAliases(["  لحم مفروم  ", "لحم مفروم", "لحم  مفروم", "", "  ", "Ground Beef"]);
  assert.deepEqual(out, ["لحم مفروم", "Ground Beef"], "trimmed, de-duplicated by meaning");
});

test("the alias list cannot grow without bound, and survives nonsense", () => {
  assert.equal(cleanAliases(Array(200).fill(0).map((_, i) => `name ${i}`)).length, 24);
  assert.deepEqual(cleanAliases(null), []);
  assert.deepEqual(cleanAliases("not an array"), []);
  /* Undefined means "not sent", which must not wipe what is stored. */
  assert.deepEqual(cleanAliases(undefined, ["kept"]), ["kept"]);
});

/* ── Units ──────────────────────────────────────────────────────────────── */

test("a unit written in any of the five languages reads as its canonical key", () => {
  const spec = [
    ["kg", ["kg", "kilogram", "كجم", "كيلو", "كيلوجرام", "كجم (kg)", "किलो", "किग्रा", "kilong", "کلو", "کلوگرام"]],
    ["g", ["g", "gram", "جم", "جرام", "غ", "ग्राम", "gramo", "گرام"]],
    ["l", ["l", "liter", "litre", "لتر", "ل", "लीटर", "litro", "لیٹر"]],
    ["ml", ["ml", "milliliter", "مل", "ملل", "مليلتر", "मिली", "mililitro", "ملی لیٹر"]],
    ["ea", ["pcs", "piece", "حبة", "حبه", "قطعة", "नग", "पीस", "piraso", "دانہ", "عدد"]],
  ];
  for (const [key, spellings] of spec) {
    for (const word of spellings) {
      assert.equal(normaliseUnit(word), key, `${word} should read as ${key}`);
    }
  }
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
