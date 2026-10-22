/* A long document read in parts and joined back together.

   The failure this guards is quiet: a joined invoice that looks complete and
   is not, or one whose total comes from a different page than its subtotal.
   Both reach a stock balance without anybody noticing. */

import assert from "node:assert/strict";
import { joinParts, readPrevious, PART_KINDS, MAX_PARTS } from "./_parts.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const pageOne = {
  supplier: "Al Ain Fresh",
  invoiceNo: "INV-204",
  date: "20/10/2026",
  lines: [{ text: "TOMATO 5KG" }, { text: "ONION 10KG" }],
  subtotal: null, tax: null, total: null,
};
const pageTwo = {
  supplier: null,
  invoiceNo: "INV-204",
  date: null,
  lines: [{ text: "OLIVE OIL 5L" }],
  subtotal: null, tax: null, total: null,
};
const pageThree = {
  supplier: "AL AIN FRESH FOODS LLC",
  invoiceNo: null,
  date: null,
  lines: [{ text: "SALT 1KG" }],
  subtotal: 400, tax: 20, total: 420,
};

test("the lines of every part are kept, in page order", () => {
  const joined = joinParts("supplier", [pageOne, pageTwo, pageThree]);
  assert.deepEqual(joined.lines.map((l) => l.text), ["TOMATO 5KG", "ONION 10KG", "OLIVE OIL 5L", "SALT 1KG"]);
});

test("the header comes from the first part that states it", () => {
  /* Page three restates the supplier in a footer, in full legal form. The
     invoice named itself at the top, and that is the name matched against. */
  const joined = joinParts("supplier", [pageOne, pageTwo, pageThree]);
  assert.equal(joined.supplier, "Al Ain Fresh");
  assert.equal(joined.invoiceNo, "INV-204");
  assert.equal(joined.date, "20/10/2026");
});

test("a header field missing on page one is filled from a later page", () => {
  const joined = joinParts("supplier", [{ ...pageOne, date: null }, { ...pageTwo, date: "21/10/2026" }]);
  assert.equal(joined.date, "21/10/2026");
});

test("the totals come from the end of the invoice, as a set", () => {
  const joined = joinParts("supplier", [pageOne, pageTwo, pageThree]);
  assert.equal(joined.subtotal, 400);
  assert.equal(joined.tax, 20);
  assert.equal(joined.total, 420);
});

test("a page subtotal earlier on is not paired with the final total", () => {
  /* Page one carries a carried-forward subtotal; the last page prints only the
     total. Mixing the two would make the invoice disagree with itself. */
  const joined = joinParts("supplier", [
    { ...pageOne, subtotal: 150 },
    { ...pageThree, subtotal: null, tax: null, total: 420 },
  ]);
  assert.equal(joined.total, 420);
  assert.equal(joined.subtotal, null);
  assert.equal(joined.tax, null);
});

test("no totals anywhere stay null rather than being invented", () => {
  const joined = joinParts("supplier", [pageOne, pageTwo]);
  assert.equal(joined.subtotal, null);
  assert.equal(joined.total, null);
});

test("a recipe keeps its ingredients and its packaging from every part", () => {
  const joined = joinParts("recipe", [
    { menuItem: "Shawarma wrap", portions: 1, lines: [{ text: "chicken 150 g" }], packaging: [{ text: "foil" }] },
    { menuItem: null, portions: null, lines: [{ text: "garlic sauce 30 g" }], packaging: [{ text: "bag" }] },
  ]);
  assert.equal(joined.menuItem, "Shawarma wrap");
  assert.equal(joined.lines.length, 2);
  assert.deepEqual(joined.packaging.map((p) => p.text), ["foil", "bag"]);
});

test("a stock sheet keeps the items of every part", () => {
  const joined = joinParts("inventory", [{ items: [{ name: "rice" }] }, { items: [{ name: "flour" }, { name: "sugar" }] }]);
  assert.deepEqual(joined.items.map((i) => i.name), ["rice", "flour", "sugar"]);
});

test("one part is passed through untouched", () => {
  assert.equal(joinParts("supplier", [pageOne]), pageOne);
});

test("the parts themselves are not modified", () => {
  const first = { lines: [{ text: "a" }] };
  joinParts("supplier", [first, { lines: [{ text: "b" }] }]);
  assert.equal(first.lines.length, 1);
});

test("no previous readings means a document read in one go", () => {
  assert.deepEqual(readPrevious("supplier", undefined), { parts: [] });
  assert.deepEqual(readPrevious("supplier", []), { parts: [] });
});

test("previous readings must be a list of objects", () => {
  assert.equal(readPrevious("supplier", "nope").error, "previous");
  assert.equal(readPrevious("supplier", [{}, "nope"]).error, "previous");
  assert.equal(readPrevious("supplier", [null]).error, "previous");
});

test("only the scanners that match a document can be read in parts", () => {
  /* Sorting a document is one decision about the whole of it; joining two
     verdicts would be meaningless. */
  assert.equal(readPrevious("classify", [{}]).error, "kind");
  assert.equal(readPrevious("auto", [{}]).error, "kind");
  for (const kind of PART_KINDS) assert.deepEqual(readPrevious(kind, [{}]), { parts: [{}] });
});

test("a hand-made payload of endless parts is refused", () => {
  const many = Array.from({ length: MAX_PARTS }, () => ({}));
  assert.equal(readPrevious("supplier", many).error, "toomany");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
