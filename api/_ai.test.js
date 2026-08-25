/* Bill pricing.

   What these protect: money is computed here and never taken from the model;
   a line only gets a cost when it matched a menu item with a real cost; an
   invented menu name is discarded; a partial total is reported as unknown
   rather than as a smaller number; and nothing the model returns can crash
   the endpoint. */

import assert from "node:assert/strict";

const { priceBill } = await import("./ai.js");

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

const MENU = [
  { name: "Chicken Shawarma", cost: 4.5 },
  { name: "Mint Lemonade", cost: 2 },
  { name: "Baklava", cost: 0 },      // cost never entered by the owner
];

test("cost and profit are computed from the menu, not from the model", () => {
  const out = priceBill({
    lines: [{ text: "SHAWARMA x2", qty: 2, amount: 24, menuItem: "Chicken Shawarma",
              cost: 999, profit: 999 }],
    total: 24,
  }, MENU);
  assert.equal(out.lines[0].cost, 9, "2 x 4.50");
  assert.equal(out.lines[0].profit, 15, "24 - 9");
});

test("a menu item with no recorded cost yields no cost or profit", () => {
  const out = priceBill({
    lines: [{ text: "BAKLAVA", qty: 1, amount: 12, menuItem: "Baklava" }],
    total: 12,
  }, MENU);
  assert.equal(out.lines[0].cost, null, "a zero cost is unknown, not free");
  assert.equal(out.lines[0].profit, null);
});

test("a menu name the model invented is discarded", () => {
  const out = priceBill({
    lines: [{ text: "MYSTERY", qty: 1, amount: 30, menuItem: "Wagyu Platter" }],
    total: 30,
  }, MENU);
  assert.equal(out.lines[0].menuItem, null, "only names on the real menu count");
  assert.equal(out.lines[0].cost, null);
  assert.deepEqual(out.unmatched, ["MYSTERY"]);
});

test("an unreadable quantity does not become a guess", () => {
  const out = priceBill({
    lines: [{ text: "SHAWARMA", qty: null, amount: 12, menuItem: "Chicken Shawarma" }],
    total: 12,
  }, MENU);
  assert.equal(out.lines[0].cost, null);
});

test("one unpriced line makes the whole total unknown", () => {
  const out = priceBill({
    lines: [
      { text: "SHAWARMA x2", qty: 2, amount: 24, menuItem: "Chicken Shawarma" },
      { text: "BAKLAVA", qty: 1, amount: 12, menuItem: "Baklava" },
    ],
    total: 36,
  }, MENU);
  assert.equal(out.totalCost, null, "a partial sum shown as the total reads as complete");
  assert.equal(out.totalProfit, null);
});

test("a fully matched bill totals correctly", () => {
  const out = priceBill({
    lines: [
      { text: "SHAWARMA x2", qty: 2, amount: 24, menuItem: "Chicken Shawarma" },
      { text: "LEMONADE x3", qty: 3, amount: 21, menuItem: "Mint Lemonade" },
    ],
    total: 45,
  }, MENU);
  assert.equal(out.totalCost, 15, "9 + 6");
  assert.equal(out.totalProfit, 30, "45 - 15");
});

test("the printed total is used, not a sum of lines", () => {
  const out = priceBill({
    lines: [{ text: "SHAWARMA", qty: 1, amount: 12, menuItem: "Chicken Shawarma" }],
    total: 15,   // service charge on the paper
  }, MENU);
  assert.equal(out.total, 15, "what the customer paid is what the bill says");
});

test("non-numeric junk is treated as unknown", () => {
  const out = priceBill({
    lines: [{ text: "X", qty: "two", amount: "AED 12", menuItem: "Chicken Shawarma" }],
    total: "lots",
  }, MENU);
  assert.equal(out.lines[0].qty, null);
  assert.equal(out.lines[0].amount, null);
  assert.equal(out.total, null);
});

test("a response with no lines does not crash", () => {
  const out = priceBill({}, MENU);
  assert.deepEqual(out.lines, []);
  assert.equal(out.totalCost, null);
  assert.equal(out.summary, "");
});

test("an empty menu prices nothing and matches nothing", () => {
  const out = priceBill({
    lines: [{ text: "SHAWARMA", qty: 1, amount: 12, menuItem: "Chicken Shawarma" }],
    total: 12,
  }, []);
  assert.equal(out.lines[0].menuItem, null);
  assert.equal(out.lines[0].cost, null);
});

test("fractional costs do not accumulate floating-point noise", () => {
  const out = priceBill({
    lines: [{ text: "L x3", qty: 3, amount: 21, menuItem: "Mint Lemonade" }],
    total: 21,
  }, [{ name: "Mint Lemonade", cost: 2.1 }]);
  assert.equal(out.lines[0].cost, 6.3, "6.300000000000001 is not a price");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
