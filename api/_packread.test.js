/* Reading the package a line prices, when the line says what is in it.

   ── What this is for ─────────────────────────────────────────────────────

   A delivery note says "1 Carton (12 x 1L Bottles) @ 24.00". "Carton" is not a
   unit, and the ledger is right to refuse to guess what one holds — a wrong
   pack size multiplies a stock balance by the size of the mistake. So the line
   could only be reconciled if somebody had already told the app that this
   ingredient is bought by the carton and that a carton holds twelve.

   The invoice said so itself, in brackets, on the line. Nothing read it.

   ── Where the arithmetic lives, and why ──────────────────────────────────

   The model reports three printed numbers — how many, how big, what unit — and
   the multiplication happens here. Asked instead for a finished quantity, it
   would put a computed figure in the same field as a transcribed one, and once
   stored nothing downstream can tell them apart: a misplaced decimal looks
   exactly like a large delivery. The same reason unit cost has always been
   derived rather than read off the invoice's own per-unit column. */

import assert from "node:assert/strict";
import { packContents, buildPurchase, proposeItem } from "./_purchase.js";

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

const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-6, `${why}: ${a} vs ${b}`);

test("a carton of bottles becomes what the shelf counts", () => {
  /* 12 × 1 L against a shelf kept in millilitres. */
  const out = packContents({ count: 12, size: 1, unit: "L" }, "ml");
  assert.equal(out.qty, 12000);
  assert.equal(out.unit, "ml");
  assert.equal(out.count, 12);
  assert.equal(out.each, 1000, "one bottle, in the shelf's unit");
});

test("and the same carton against a shelf kept in litres", () => {
  const out = packContents({ count: 12, size: 1, unit: "L" }, "l");
  assert.equal(out.qty, 12);
  assert.equal(out.each, 1);
});

test("a case of 24 × 330 ml", () => {
  const out = packContents({ count: 24, size: 330, unit: "ml" }, "ml");
  assert.equal(out.qty, 7920);
});

test("a bag stated as one lot of five kilos", () => {
  const out = packContents({ count: 1, size: 5, unit: "kg" }, "g");
  assert.equal(out.qty, 5000);
});

test("the supplier's spelling of the inner unit is read too", () => {
  /* The bracket is printed by the same supplier who writes "Kg" and "Ltr"
     everywhere else on the page. */
  assert.equal(packContents({ count: 12, size: 1, unit: "Ltr" }, "ml").qty, 12000);
  assert.equal(packContents({ count: 4, size: 2, unit: "Kg" }, "g").qty, 8000);
  assert.equal(packContents({ count: 6, size: 500, unit: "جم" }, "g").qty, 3000);
});

test("a pack that does not reconcile is refused, not guessed", () => {
  /* Every one of these could be turned into a number by assuming something,
     and every assumption would be written into a stock balance as though it
     had been measured. */
  assert.equal(packContents(null, "ml"), null, "no pack stated");
  assert.equal(packContents({ count: 12, size: 1, unit: "L" }, null), null, "no shelf unit");
  assert.equal(packContents({ count: 12, unit: "L" }, "ml"), null, "no size printed");
  assert.equal(packContents({ size: 1, unit: "L" }, "ml"), null, "no count printed");
  assert.equal(packContents({ count: 12, size: 1, unit: "bottle" }, "ml"), null,
    "a bottle is a package, not an amount");
  assert.equal(packContents({ count: 12, size: 1, unit: "L" }, "kg"), null,
    "twelve litres is not a weight");
  assert.equal(packContents({ count: 0, size: 1, unit: "L" }, "ml"), null);
  assert.equal(packContents({ count: 12, size: -1, unit: "L" }, "ml"), null);
});

/* ── Through the whole line ─────────────────────────────────────────────── */

const MILK = { id: "whole-milk", name: "Whole milk", stockUnit: "ml", purchaseUnit: "ml", packSize: 1 };

test("the spec's own example, end to end", () => {
  /* "1 Carton (12 x 1L Bottles) @ $24" — 12,000 ml at 0.002 the millilitre. */
  const out = buildPurchase({
    lines: [{
      text: "1 Carton (12 x 1L Bottles)",
      qty: 1, unit: "Carton",
      pack: { count: 12, size: 1, unit: "L" },
      amount: 24, ingredient: "Whole milk",
    }],
  }, [MILK]);

  const [line] = out.lines;
  assert.equal(line.ingredientId, "whole-milk");
  assert.equal(line.receiveQty, 12000, "twelve litres, in millilitres");
  assert.equal(line.receiveUnit, "ml", "and stated in the unit the cost is per");
  near(line.unitCost, 0.002, "cost of one millilitre");
  assert.equal(line.viaStatedPack, true, "and the screen can say where that came from");
  assert.equal(line.pack.count, 12);
  assert.equal(line.pack.each, 1000);
});

test("the quantity and the cost it is paired with always agree", () => {
  /* The invariant that a factor-of-a-thousand bug once broke here: whatever
     `receiveQty` counts, `unitCost` is the price of one of those, and their
     product is the line total.

     Held to a fils, because a per-millilitre cost is a rounded figure and
     cannot be exact. It was held to eight tenths of a percent until this test
     was written: four decimal places were plenty while costs meant "per kilo"
     and far too few once they mean "per gram". */
  for (const pack of [
    { count: 12, size: 1, unit: "L" },
    { count: 24, size: 330, unit: "ml" },
    { count: 6, size: 750, unit: "ml" },
  ]) {
    const out = buildPurchase({
      lines: [{ text: "x", qty: 2, unit: "Carton", pack, amount: 100, ingredient: "Whole milk" }],
    }, [MILK]);
    const [line] = out.lines;
    const back = line.receiveQty * line.unitCost;
    assert.ok(
      Math.abs(back - 100) < 0.01,
      `${pack.count} x ${pack.size}${pack.unit}: ${back} should be 100.00`,
    );
  }
});

test("a line the invoice did not describe still asks rather than guesses", () => {
  const out = buildPurchase({
    lines: [{ text: "1 Carton", qty: 1, unit: "Carton", amount: 24, ingredient: "Whole milk" }],
  }, [MILK]);
  const [line] = out.lines;
  assert.equal(line.pack, null);
  assert.equal(line.viaStatedPack, false);
  assert.equal(line.costUnknown, true, "flagged, so the screen can ask how much one holds");
});

test("a stated pack outranks a pack size stored on the ingredient", () => {
  /* A supplier moves from twelve-bottle cartons to twenty-four and prints the
     new number on the note. The stored figure is then last month's answer. */
  const stored = { ...MILK, purchaseUnit: "carton", packSize: 12000 };
  const out = buildPurchase({
    lines: [{
      text: "1 Carton (24 x 1L)", qty: 1, unit: "carton",
      pack: { count: 24, size: 1, unit: "L" }, amount: 48, ingredient: "Whole milk",
    }],
  }, [stored]);
  assert.equal(out.lines[0].receiveQty, 24000, "what the note says, not what was stored");
});

test("an ingredient the line invents is described from the bracket", () => {
  /* Where the pack is worth most: nothing is stored, so the line is the only
     evidence there is. Without it the fallback for an unknown package word was
     kilograms — a carton of milk landing on the shelf as a mass. */
  const item = proposeItem(
    { newItem: { name: "Whole milk" }, pack: { count: 12, size: 1, unit: "L" } },
    "1 Carton (12 x 1L Bottles)",
    "Carton",
  );
  assert.equal(item.stockUnit, "l", "a liquid, kept in litres");
  assert.equal(item.purchaseUnit, "Carton", "bought by the carton");
  assert.equal(item.packSize, 12, "twelve litres to a carton");
});

test("a line with no bracket still proposes something creatable", () => {
  const item = proposeItem({ newItem: { name: "Beef mince", stockUnit: "kg" } }, "BEEF MINCE 5KG", "kg");
  assert.equal(item.stockUnit, "kg");
  assert.equal(item.packSize, 1);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
