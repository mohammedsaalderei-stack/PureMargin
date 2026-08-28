/* The monthly scan allowance, and reading a supplier invoice.

   What these protect: an allowance is claimed before the model runs and given
   back only when the model never answered; the count is per organization and
   per calendar month; a supplier line is matched against the real ingredient
   list rather than by the model; unit cost is derived from the total rather
   than read; and a near-miss is left unmatched instead of guessed. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const q = await import("./_scanquota.js");
const { buildPurchase, bestMatch } = await import("./_purchase.js");

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

/* ---- the allowance ---- */

await test("a fresh organization has the whole allowance", async () => {
  const u = await q.scanUsage("org1");
  assert.equal(u.used, 0);
  assert.equal(u.left, u.limit);
  assert.equal(u.limit, 100);
});

await test("claiming spends one", async () => {
  const c = await q.claimScan("org1");
  assert.equal(c.allowed, true);
  assert.equal(c.used, 1);
  assert.equal(c.left, 99);
});

await test("the allowance runs out at the limit, not past it", async () => {
  for (let i = 0; i < 100; i += 1) {
    const c = await q.claimScan("org1");
    assert.equal(c.allowed, true, `scan ${i + 1} should be allowed`);
  }
  const over = await q.claimScan("org1");
  assert.equal(over.allowed, false, "the 101st must be refused");
  assert.equal(over.left, 0);
  assert.equal((await q.scanUsage("org1")).used, 100, "a refusal must not count");
});

await test("a refund returns a scan", async () => {
  await q.claimScan("org1");
  await q.claimScan("org1");
  await q.refundScan("org1");
  assert.equal((await q.scanUsage("org1")).used, 1);
});

await test("a refund cannot push the count below zero", async () => {
  await q.refundScan("org1");
  assert.equal((await q.scanUsage("org1")).used, 0);
});

await test("one organization's scans are not another's", async () => {
  await q.claimScan("org1");
  assert.equal((await q.scanUsage("org2")).used, 0);
});

await test("a new month starts clean", async () => {
  const jan = Date.UTC(2026, 0, 20);
  const feb = Date.UTC(2026, 1, 3);
  for (let i = 0; i < 100; i += 1) await q.claimScan("org1", jan);
  assert.equal((await q.claimScan("org1", jan)).allowed, false, "January is spent");
  assert.equal((await q.claimScan("org1", feb)).allowed, true, "February is not");
});

await test("the reset date is the first of the next month", () => {
  const at = Date.UTC(2026, 0, 20);
  assert.equal(q.resetsAt(at), Date.UTC(2026, 1, 1));
  assert.equal(q.resetsAt(Date.UTC(2026, 11, 31)), Date.UTC(2027, 0, 1),
    "December must roll into the next year");
});

/* ---- the supplier invoice ---- */

const STOCK = [
  { id: "tomatoes", name: "Tomatoes", stockUnit: "kg" },
  { id: "chicken-breast", name: "Chicken breast", stockUnit: "kg" },
  { id: "olive-oil", name: "Olive oil", stockUnit: "l" },
];

await test("a supplier description matches the ingredient it names", () => {
  const hit = bestMatch("TOMATO RED 5KG BOX", STOCK);
  assert.equal(hit?.ingredient.id, "tomatoes");
});

await test("a near-miss is left unmatched rather than guessed", () => {
  assert.equal(bestMatch("POTATOES WASHED 10KG", STOCK), null,
    "a plausible wrong match is worse than none");
  assert.equal(bestMatch("MYSTERY CRATE", STOCK), null);
});

await test("a multi-word ingredient needs its words, not one of them", () => {
  const hit = bestMatch("CHICKEN BREAST SKINLESS 2KG", STOCK);
  assert.equal(hit?.ingredient.id, "chicken-breast");
});

await test("unit cost is derived from the total, not read from the page", () => {
  const out = buildPurchase({
    lines: [{ text: "TOMATO RED", qty: 5, unit: "kg", amount: 45, unitPrice: 999 }],
  }, STOCK);
  assert.equal(out.lines[0].unitCost, 9, "45 over 5");
});

await test("a line missing a quantity yields no unit cost", () => {
  const out = buildPurchase({ lines: [{ text: "TOMATO RED", amount: 45 }] }, STOCK);
  assert.equal(out.lines[0].unitCost, null);
});

await test("the stock unit comes along so a unit mismatch is visible", () => {
  const out = buildPurchase({
    lines: [{ text: "OLIVE OIL 4 BOX", qty: 4, unit: "box", amount: 200 }],
  }, STOCK);
  assert.equal(out.lines[0].unit, "box");
  assert.equal(out.lines[0].stockUnit, "l", "the shelf counts litres; the invoice counts boxes");
});

await test("unmatched lines are named and counted", () => {
  const out = buildPurchase({
    lines: [
      { text: "TOMATO RED 5KG", qty: 5, unit: "kg", amount: 45 },
      { text: "BLUE WIDGETS", qty: 1, unit: "pcs", amount: 10 },
    ],
  }, STOCK);
  assert.equal(out.matchedCount, 1);
  assert.deepEqual(out.unmatched, ["BLUE WIDGETS"]);
  assert.equal(out.complete, false);
});

await test("a fully matched invoice reports itself complete", () => {
  const out = buildPurchase({
    lines: [{ text: "TOMATO RED 5KG", qty: 5, unit: "kg", amount: 45 }],
  }, STOCK);
  assert.equal(out.complete, true);
});

await test("an empty invoice is not complete", () => {
  const out = buildPurchase({ lines: [] }, STOCK);
  assert.equal(out.complete, false, "nothing to receive is not a finished job");
});

await test("no ingredients on file means nothing matches, and nothing crashes", () => {
  const out = buildPurchase({ lines: [{ text: "TOMATO", qty: 1, amount: 5 }] }, []);
  assert.equal(out.matchedCount, 0);
  assert.equal(out.lines[0].ingredientId, null);
});

await test("junk quantities and amounts read as unknown", () => {
  const out = buildPurchase({
    lines: [{ text: "TOMATO RED", qty: "five", amount: "AED 45" }],
  }, STOCK);
  assert.equal(out.lines[0].qty, null);
  assert.equal(out.lines[0].amount, null);
  assert.equal(out.lines[0].unitCost, null);
});

await test("the header fields survive", () => {
  const out = buildPurchase({
    supplier: "Al Ain Farms", invoiceNo: "INV-8821", date: "2026-08-24", total: 145,
    lines: [{ text: "TOMATO RED 5KG", qty: 5, unit: "kg", amount: 45 }],
  }, STOCK);
  assert.equal(out.supplier, "Al Ain Farms");
  assert.equal(out.invoiceNo, "INV-8821");
  assert.equal(out.total, 145);
});


await test("a name the model picked from the list wins over token matching", () => {
  const out = buildPurchase({
    lines: [{ text: "TOM RED GRD A 5KG BX", qty: 5, unit: "kg", amount: 45,
              ingredient: "Tomatoes" }],
  }, STOCK);
  assert.equal(out.lines[0].ingredientId, "tomatoes",
    "the model sees the whole line in context; token overlap cannot");
  assert.equal(out.lines[0].confidence, 1);
});

await test("a name the model invented is discarded, not trusted", () => {
  const out = buildPurchase({
    lines: [{ text: "BLUE WIDGETS", qty: 1, unit: "ea", amount: 10,
              ingredient: "Wagyu Platter" }],
  }, STOCK);
  assert.equal(out.lines[0].ingredientId, null,
    "only a name really on the list may be used");
});

await test("a near-miss name from the model still falls back to tokens", () => {
  const out = buildPurchase({
    lines: [{ text: "TOMATOES RED", qty: 1, unit: "kg", amount: 9,
              ingredient: "tomatoe" }],
  }, STOCK);
  assert.equal(out.lines[0].ingredientId, "tomatoes",
    "the model's spelling was off, so token matching caught it");
});

await test("the model declining leaves token matching to try", () => {
  const out = buildPurchase({
    lines: [{ text: "OLIVE OIL 5L", qty: 1, unit: "l", amount: 68, ingredient: null }],
  }, STOCK);
  assert.equal(out.lines[0].ingredientId, "olive-oil");
});

await test("matching is case-insensitive on the model's answer", () => {
  const out = buildPurchase({
    lines: [{ text: "X", qty: 1, unit: "kg", amount: 5, ingredient: "  TOMATOES  " }],
  }, STOCK);
  assert.equal(out.lines[0].ingredientId, "tomatoes");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
