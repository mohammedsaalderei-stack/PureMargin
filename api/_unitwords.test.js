/* Reading a unit off a page, in whatever language it was written.

   What these protect: a unit is recognised in every language the product
   supports and in the spellings suppliers actually use; a packaging word is
   identified as packaging rather than mistaken for a unit; a word nobody
   recognises stays null rather than becoming a guess; and a conversion is
   refused whenever the two units measure different things. */

import assert from "node:assert/strict";
import { normaliseUnit, isPackaging, toStockUnit } from "./_unitwords.js";

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

test("the canonical keys pass straight through", () => {
  for (const u of ["kg", "g", "l", "ml", "ea", "tsp", "tbsp", "cup", "lb", "oz"]) {
    assert.equal(normaliseUnit(u), u);
  }
});

test("case and trailing punctuation do not matter", () => {
  assert.equal(normaliseUnit("KG"), "kg");
  assert.equal(normaliseUnit(" Kg. "), "kg");
  assert.equal(normaliseUnit("LBS"), "lb");
});

test("English spellings suppliers actually use are recognised", () => {
  for (const [word, key] of [["kilos", "kg"], ["kilogramme", "kg"], ["gms", "g"],
                             ["ltr", "l"], ["pcs", "ea"], ["each", "ea"],
                             ["tablespoons", "tbsp"], ["dz", "dozen"]]) {
    assert.equal(normaliseUnit(word), key, `${word} should be ${key}`);
  }
});

test("Arabic units are recognised", () => {
  for (const [word, key] of [["كجم", "kg"], ["كيلو", "kg"], ["جرام", "g"], ["غرام", "g"],
                             ["لتر", "l"], ["مل", "ml"], ["حبة", "ea"], ["قطعة", "ea"],
                             ["كوب", "cup"], ["رطل", "lb"], ["ملعقة كبيرة", "tbsp"],
                             ["ملعقة صغيرة", "tsp"]]) {
    assert.equal(normaliseUnit(word), key, `${word} should be ${key}`);
  }
});

test("Hindi units are recognised", () => {
  for (const [word, key] of [["किलो", "kg"], ["ग्राम", "g"], ["लीटर", "l"],
                             ["मिली", "ml"], ["नग", "ea"], ["कप", "cup"]]) {
    assert.equal(normaliseUnit(word), key, `${word} should be ${key}`);
  }
});

test("Filipino units are recognised", () => {
  for (const [word, key] of [["kilo", "kg"], ["tasa", "cup"], ["kutsara", "tbsp"],
                             ["kutsarita", "tsp"], ["piraso", "ea"]]) {
    assert.equal(normaliseUnit(word), key, `${word} should be ${key}`);
  }
});

test("Arabic diacritics are ignored when matching", () => {
  assert.equal(normaliseUnit("حَبّة"), "ea");
});

test("a quantity stuck to its unit still resolves", () => {
  assert.equal(normaliseUnit("5kg"), "kg");
  assert.equal(normaliseUnit("500 g"), "g");
});

test("Arabic-Indic digits do not break the match", () => {
  assert.equal(normaliseUnit("٥ كجم"), "kg");
});

test("a packaging word is packaging, not a unit", () => {
  for (const word of ["sack", "box", "tin", "tub", "carton", "صندوق", "كيس", "बोरी", "sako"]) {
    assert.equal(normaliseUnit(word), null, `${word} must not read as a unit`);
    assert.equal(isPackaging(word), true, `${word} should be recognised as packaging`);
  }
});

test("an unknown word is null, never a guess", () => {
  for (const word of ["handful", "wibble", "", null, undefined, "splash"]) {
    assert.equal(normaliseUnit(word), null);
  }
  assert.equal(isPackaging("wibble"), false);
});

test("a conversion within one dimension is exact", () => {
  assert.deepEqual(toStockUnit(500, "g", "kg"), { qty: 0.5, unit: "kg", converted: true, from: "g" });
  assert.equal(toStockUnit(2, "l", "ml").qty, 2000);
});

test("a conversion works from a foreign spelling", () => {
  assert.equal(toStockUnit(500, "جرام", "kg").qty, 0.5);
  assert.equal(toStockUnit(1, "किलो", "g").qty, 1000);
});

test("imperial converts to metric", () => {
  const out = toStockUnit(2, "lb", "kg");
  assert.ok(Math.abs(out.qty - 0.907185) < 1e-6, "2 lb is 0.907185 kg");
});

test("the same unit is not reported as converted", () => {
  const out = toStockUnit(3, "kg", "kg");
  assert.equal(out.converted, false, "the screen should not claim a conversion that did not happen");
});

test("a count is never converted into a mass", () => {
  assert.equal(toStockUnit(3, "ea", "kg"), null, "a pack size is something a person supplies");
  assert.equal(toStockUnit(3, "حبة", "kg"), null);
  assert.equal(toStockUnit(2, "l", "kg"), null, "volume to mass needs a density nobody gave us");
});

test("an unreadable quantity yields no conversion", () => {
  assert.equal(toStockUnit("lots", "kg", "g"), null);
  assert.equal(toStockUnit(5, "wibble", "kg"), null);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
