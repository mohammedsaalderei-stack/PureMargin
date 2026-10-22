/* Recipe sheets brought to the invoice scanner.

   Read as an invoice, a report with a dish to a page became a delivery of
   dishes into stock. The reader now answers {"notAPurchase": "recipe"} for
   those, and the route refuses with somewhere better to go. What decides it
   is checked here, because a false positive refuses a real invoice. */

import assert from "node:assert/strict";
import { notAPurchase } from "./_purchase.js";

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

test("the answer the reader was told to give is recognised", () => {
  assert.equal(notAPurchase({ notAPurchase: "recipe" }), true);
});

test("an ordinary invoice is a purchase", () => {
  assert.equal(notAPurchase({ supplier: "Al Ain Fresh", lines: [{ text: "TOMATO 5KG" }] }), false);
});

test("a reading with purchased lines is a purchase, whatever else it says", () => {
  /* A model that half-follows the instruction must not cost somebody a real
     delivery: lines win. */
  assert.equal(notAPurchase({ notAPurchase: "recipe", lines: [{ text: "TOMATO 5KG" }] }), false);
});

test("only the exact answer counts", () => {
  assert.equal(notAPurchase({ notAPurchase: true }), false);
  assert.equal(notAPurchase({ notAPurchase: "menu" }), false);
  assert.equal(notAPurchase(null), false);
  assert.equal(notAPurchase(undefined), false);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
