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

/* ── Which line will be refused, said before the save ────────────────────

   A forty-eight line delivery was refused as a whole for one line the ledger
   would not take, and the message named neither the line nor the reason. The
   refusal is partial now and names the ingredient — but the review list is
   closed by default and forty-eight rows long, so being told "Brioche buns" is
   the start of a hunt rather than the end of one.

   Every fact needed to know this was already in hand when the scan was read.
   It just was not said. */

const SHELF = [
  { id: "brioche-buns", name: "Brioche buns", stockUnit: "ea", purchaseUnit: "ea", packSize: 1 },
  { id: "beef-mince", name: "Beef mince", stockUnit: "kg", purchaseUnit: "kg", packSize: 1 },
  { id: "whole-milk", name: "Whole milk", stockUnit: "ml", purchaseUnit: "ml", packSize: 1 },
];

const oneLine = (line) => buildPurchase({ lines: [line] }, SHELF).lines[0];

test("a line that will go in is not flagged", () => {
  for (const line of [
    { text: "BEEF MINCE 5KG", qty: 5, unit: "kg", amount: 100, ingredient: "Beef mince" },
    /* The supplier's own spelling, which af663d8 taught the commit to read. */
    { text: "BEEF MINCE 5KG", qty: 5, unit: "Kg", amount: 100, ingredient: "Beef mince" },
    { text: "BUNS x60", qty: 60, unit: "Pcs", amount: 90, ingredient: "Brioche buns" },
    /* Grams against a shelf kept in kilos still converts. */
    { text: "MINCE 500G", qty: 500, unit: "g", amount: 12, ingredient: "Beef mince" },
  ]) {
    assert.equal(oneLine(line).trouble, null, line.unit);
  }
});

test("a unit measuring the wrong kind of thing is flagged, with what the shelf keeps", () => {
  /* Buns are counted, not weighed. This is the line that held up forty-seven
     others and was described only as "one of the lines". */
  const l = oneLine({ text: "BRIOCHE BUNS 2KG", qty: 2, unit: "kg", amount: 30, ingredient: "Brioche buns" });
  assert.equal(l.trouble, "unit");
  assert.equal(l.stocksIn, "ea", "so the row can say what it is kept in");
  assert.equal(l.ingredientName, "Brioche buns", "and which row it is");
});

test("a package with nothing said about its contents asks that instead", () => {
  /* A different question with a different answer: not "change the unit" but
     "how much is in one". */
  const l = oneLine({ text: "MILK 1 CARTON", qty: 1, unit: "Carton", amount: 24, ingredient: "Whole milk" });
  assert.equal(l.trouble, "packaging");
  assert.equal(l.printedUnit, "Carton", "quoted back as the supplier wrote it");
});

test("a package the invoice described is not flagged at all", () => {
  /* The bracket answered the question, so nobody is asked it. */
  const l = oneLine({
    text: "MILK 1 CARTON (12x1L)", qty: 1, unit: "Carton",
    pack: { count: 12, size: 1, unit: "L" }, amount: 24, ingredient: "Whole milk",
  });
  assert.equal(l.trouble, null);
  assert.equal(l.receiveQty, 12000);
});

test("a line creating its own ingredient is judged against the unit it will get", () => {
  /* No ingredient exists yet, so there is nothing stored to compare with — but
     the delivery will create one, and it is that unit the line has to suit. */
  const flour = oneLine({
    text: "FLOUR 3 SACK", qty: 3, unit: "sack", amount: 60,
    ingredient: null, newItem: { name: "Flour", stockUnit: "kg" },
  });
  assert.equal(flour.trouble, "packaging", "a sack is still a package");
  assert.equal(flour.stocksIn, "kg", "against the unit it is about to be created in");

  const fine = oneLine({
    text: "FLOUR 25KG", qty: 25, unit: "kg", amount: 60,
    ingredient: null, newItem: { name: "Flour", stockUnit: "kg" },
  });
  assert.equal(fine.trouble, null);
});

test("one bad line among many is the only one flagged", () => {
  /* The shape of the actual complaint: forty-eight lines, one of them a
     problem, and no way to see which. */
  const many = buildPurchase({
    lines: [
      { text: "A", qty: 5, unit: "kg", amount: 100, ingredient: "Beef mince" },
      { text: "B", qty: 60, unit: "Pcs", amount: 90, ingredient: "Brioche buns" },
      { text: "C", qty: 2, unit: "kg", amount: 30, ingredient: "Brioche buns" },
      { text: "D", qty: 2, unit: "l", amount: 8, ingredient: "Whole milk" },
    ],
  }, SHELF);
  const flagged = many.lines.filter((l) => l.trouble);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].text, "C");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
