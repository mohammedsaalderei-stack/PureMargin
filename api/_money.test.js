/* Money that survives being divided.

   ── The bug this file is aimed at ────────────────────────────────────────

   Splitting 100.00 across three lines in doubles gives 33.333333333333336
   three times. Each rounds to 33.33. They sum to 99.99, and a fils has gone.
   It goes again on the next order, and the next, and it surfaces months later
   as a reconciliation that is always off by a little.

   §6 asks for order-level discounts allocated proportionally to lines and for
   rounding residuals allocated deterministically. Those are the same problem,
   and `allocate` is the answer to both — so most of what follows is the
   property that matters more than any individual case: **the parts always add
   back to the whole.**

   Nothing here is about quantities. A recipe line of 0.375 kg is a
   measurement, `_units.js` already keeps those on one scale, and forcing a
   measurement through minor units is the factor-of-1000 error that file
   exists to prevent. */

import assert from "node:assert/strict";
import {
  toMinor, toDecimalString, fromDb, toDb, placesFor,
  add, subtract, multiply, allocate, MoneyError,
} from "./_money.js";

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

/* ── Reading a written figure ───────────────────────────────────────────── */

test("a price becomes an exact count of fils", () => {
  assert.equal(toMinor("24.50"), 2450);
  assert.equal(toMinor(24.5), 2450);
  assert.equal(toMinor("0.05"), 5);
  assert.equal(toMinor("1000"), 100000);
  assert.equal(toMinor("-12.75"), -1275);
  assert.equal(toMinor(""), 0);
  assert.equal(toMinor(null), 0);
});

test("the values binary floating point gets wrong", () => {
  /* 1.005 * 100 is 100.49999999999999 in a double, so `Math.round` of it is
     100 — a fils lost on a number a person typed exactly. The decimal path
     does not have the problem to begin with. */
  assert.equal(toMinor("1.005"), 101);
  assert.equal(toMinor("8.165"), 817);
  assert.equal(toMinor("1.015"), 102);
  /* And the classic: 0.1 + 0.2 is not 0.3. */
  assert.equal(add(toMinor("0.1"), toMinor("0.2")), toMinor("0.3"));
});

test("rounding goes away from zero, the way a receipt does", () => {
  assert.equal(toMinor("0.004"), 0);
  assert.equal(toMinor("0.005"), 1);
  assert.equal(toMinor("0.006"), 1);
  assert.equal(toMinor("-0.005"), -1, "and symmetrically for a refund");
});

test("more decimals than the currency has are not silently kept", () => {
  assert.equal(toMinor("1.9999"), 200);
  assert.equal(toMinor("1.0001"), 100);
});

test("something that is not a number is refused, not coerced", () => {
  /* `Number("12 AED")` is NaN and `Number("")` is 0 — both would become a
     silent zero on a line somebody typed a price into. */
  for (const bad of ["12 AED", "abc", "1.2.3", "--5", ".", "-", "1e5"]) {
    assert.throws(() => toMinor(bad), MoneyError, `accepted ${bad}`);
  }
});

test("a currency with three decimal places is not assumed to have two", () => {
  /* A Gulf product that hard-codes two is wrong in Kuwait, Bahrain and Oman. */
  assert.equal(placesFor("KWD"), 3);
  assert.equal(toMinor("1.234", "KWD"), 1234);
  assert.equal(toDecimalString(1234, "KWD"), "1.234");
  assert.equal(placesFor("JPY"), 0);
  assert.equal(toMinor("1250", "JPY"), 1250);
  assert.equal(toDecimalString(1250, "JPY"), "1250");
  assert.equal(placesFor("ZZZ"), 2, "an unknown currency falls back to two");
});

/* ── Writing one back ───────────────────────────────────────────────────── */

test("a response carries a decimal string, not a double", () => {
  /* §7: JSON monetary values are decimal strings. A number here would invite
     the client to do arithmetic on it, which is the thing this file exists to
     stop. */
  assert.equal(toDecimalString(2450), "24.50");
  assert.equal(toDecimalString(5), "0.05");
  assert.equal(toDecimalString(0), "0.00");
  assert.equal(toDecimalString(-1275), "-12.75");
  assert.equal(toDecimalString(100000), "1000.00");
});

test("a round trip changes nothing", () => {
  for (const written of ["0.00", "0.01", "24.50", "1999.99", "-3.33", "1000000.00"]) {
    assert.equal(toDecimalString(toMinor(written)), written);
  }
});

test("NUMERIC comes back from pg as a string, and is read as one", () => {
  /* The driver returns NUMERIC as text on purpose — it cannot know the scale
     fits a double, so it refuses to guess. This is the doorway. */
  assert.equal(fromDb("24.50"), 2450);
  assert.equal(fromDb("24.500000"), 2450, "NUMERIC(20,6) pads the scale");
  assert.equal(fromDb(null), null);
  assert.equal(toDb(2450), "24.50");
});

/* ── Arithmetic ─────────────────────────────────────────────────────────── */

test("adding a long column of prices stays exact", () => {
  const line = toMinor("24.99");
  let total = 0;
  for (let i = 0; i < 10000; i += 1) total = add(total, line);
  assert.equal(total, 2499 * 10000, "10000 lines at 2499 fils");
  assert.equal(toDecimalString(total), "249900.00");

  /* The same column as doubles, for contrast. It drifts, and the drift is
     invisible until something divides by it or compares two of them. */
  let drifted = 0;
  for (let i = 0; i < 10000; i += 1) drifted += 24.99;
  assert.notEqual(drifted, 249900, "doubles do not survive this, which is the point");
});

test("a price times a quantity rounds once", () => {
  assert.equal(multiply(toMinor("24.99"), 3), 7497);
  /* A measurement, not money: 0.375 kg of something priced per kg. */
  assert.equal(multiply(toMinor("12.00"), 0.375), 450);
  assert.equal(multiply(toMinor("0.01"), 0.5), 1, "half a fils rounds up");
  assert.equal(multiply(toMinor("-10.00"), 3), -3000);
});

test("subtraction is exact both ways", () => {
  assert.equal(subtract(toMinor("100.00"), toMinor("33.33")), 6667);
  assert.equal(subtract(toMinor("0.10"), toMinor("0.30")), -20);
});

test("a figure too large to be exact is refused rather than rounded", () => {
  assert.throws(() => add(Number.MAX_SAFE_INTEGER, 1), MoneyError);
  assert.throws(() => toMinor("99999999999999999999"), MoneyError);
});

/* ── Allocation, which is the point ─────────────────────────────────────── */

test("the parts always add back to the whole", () => {
  /* The property that matters more than any single case. Every combination of
     amount and weights below is checked for the one thing that must never be
     false. */
  const amounts = [0, 1, 5, 99, 100, 10000, 33333, 1, 7];
  const weightSets = [
    [1, 1, 1], [1, 2, 3], [0, 0, 1], [5], [1, 1], [7, 11, 13, 17],
    [100, 1], [1, 1, 1, 1, 1, 1, 1],
  ];
  for (const amount of amounts) {
    for (const weights of weightSets) {
      const parts = allocate(amount, weights);
      assert.equal(
        parts.reduce((n, x) => n + x, 0), amount,
        `${amount} across ${JSON.stringify(weights)} lost money`);
      assert.equal(parts.length, weights.length);
    }
  }
});

test("a hundred split three ways keeps every fils", () => {
  /* The naive version returns 33.33 three times and loses one. */
  const parts = allocate(toMinor("100.00"), [1, 1, 1]);
  assert.deepEqual(parts.map((p) => toDecimalString(p)), ["33.34", "33.33", "33.33"]);
  assert.equal(add(...parts), toMinor("100.00"));
});

test("a discount lands in proportion to what the lines cost", () => {
  /* A ten dirham discount on an order of 30 and 70. */
  const parts = allocate(toMinor("10.00"), [toMinor("30.00"), toMinor("70.00")]);
  assert.deepEqual(parts.map((p) => toDecimalString(p)), ["3.00", "7.00"]);
});

test("the leftover goes to the line rounded down hardest", () => {
  /* One fils over three lines: the largest remainder takes it, and with equal
     remainders the first line does. Deterministic either way, which is what
     §6 asks for and what makes a reconciliation possible. */
  assert.deepEqual(allocate(1, [1, 1, 1]), [1, 0, 0]);
  assert.deepEqual(allocate(2, [1, 1, 1]), [1, 1, 0]);
  assert.deepEqual(allocate(1, [1, 5]), [0, 1], "the bigger line, not the first");
});

test("the same inputs allocate the same way every time", () => {
  const once = allocate(9999, [3, 1, 4, 1, 5, 9, 2, 6]);
  for (let i = 0; i < 50; i += 1) {
    assert.deepEqual(allocate(9999, [3, 1, 4, 1, 5, 9, 2, 6]), once);
  }
});

test("a refund allocates the same way a charge does", () => {
  const charge = allocate(toMinor("100.00"), [1, 1, 1]);
  const refund = allocate(toMinor("-100.00"), [1, 1, 1]);
  assert.deepEqual(refund, charge.map((x) => -x));
  assert.equal(add(...refund), toMinor("-100.00"));
});

test("everything free is spread evenly rather than dividing by zero", () => {
  const parts = allocate(300, [0, 0, 0]);
  assert.deepEqual(parts, [100, 100, 100]);
  assert.equal(add(...parts), 300);
});

test("no lines is no allocation, not a crash", () => {
  assert.deepEqual(allocate(500, []), []);
});

test("one line takes all of it", () => {
  assert.deepEqual(allocate(4999, [7]), [4999]);
});

test("more lines than fils leaves the rest at zero", () => {
  const parts = allocate(2, [1, 1, 1, 1, 1]);
  assert.equal(add(...parts), 2);
  assert.equal(parts.filter((x) => x > 0).length, 2);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
