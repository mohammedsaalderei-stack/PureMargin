/* The supplier-vocabulary cache, and the invoice matching that reads it.

   What these protect: a pairing confirmed once is not asked about again, an
   alias beats a fresh guess, an alias pointing at a deleted ingredient resolves
   to nothing rather than to a ghost, a correction replaces rather than
   accumulates, and one organization's vocabulary is unreachable from another's. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const al = await import("./_aliases.js");
const inv = await import("./_inventory.js");
const pur = await import("./_purchase.js");

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

const known = (...ids) => new Set(ids);

/* ------------------------ keying ---------------------------------- */

await test("case and spacing are one description, not several", async () => {
  assert.strictEqual(al.aliasKey("TOMATO RED  5KG"), al.aliasKey("Tomato Red 5kg"));
  assert.strictEqual(al.aliasKey("  spaced  out  "), "spaced out");
  assert.strictEqual(al.aliasKey(""), "");
  assert.strictEqual(al.aliasKey(null), "");
});

/* ------------------------ learning -------------------------------- */

await test("a pairing is remembered and resolves the next time", async () => {
  await al.learnAliases("org1", [{ text: "TOMATO RED 5KG BOX", ingredientId: "tomatoes" }]);

  const hit = await al.resolveAlias("org1", "tomato red 5kg box", known("tomatoes"));
  assert.strictEqual(hit.ingredientId, "tomatoes");
  assert.strictEqual(hit.hits, 1);
});

await test("re-confirming a pairing counts a hit rather than rewriting it", async () => {
  const pair = [{ text: "TOMATO RED 5KG BOX", ingredientId: "tomatoes" }];
  await al.learnAliases("org1", pair);
  await al.learnAliases("org1", pair);
  await al.learnAliases("org1", pair);

  const hit = await al.resolveAlias("org1", "TOMATO RED 5KG BOX", known("tomatoes"));
  assert.strictEqual(hit.hits, 3);
  assert.strictEqual((await al.listAliases("org1")).length, 1);
});

await test("a correction replaces the pairing instead of adding a second", async () => {
  await al.learnAliases("org1", [{ text: "POM 5KG", ingredientId: "potatoes" }]);
  await al.learnAliases("org1", [{ text: "POM 5KG", ingredientId: "tomatoes" }]);

  const list = await al.listAliases("org1");
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].ingredientId, "tomatoes");
  /* What it used to say is kept, so a table that has started matching the wrong
     thing can be read rather than only rebuilt. */
  assert.strictEqual(list[0].replaced, "potatoes");
});

await test("nothing is learned from an empty description or a missing ingredient", async () => {
  const out = await al.learnAliases("org1", [
    { text: "", ingredientId: "tomatoes" },
    { text: "SOMETHING", ingredientId: "" },
  ]);
  assert.strictEqual(out.learned, 0);
  assert.deepStrictEqual(await al.listAliases("org1"), []);
});

/* ------------------------ safety ---------------------------------- */

await test("an alias pointing at a deleted ingredient resolves to nothing", async () => {
  await al.learnAliases("org1", [{ text: "GHOST ITEM", ingredientId: "removed" }]);

  assert.strictEqual(await al.resolveAlias("org1", "GHOST ITEM", known("tomatoes")), null);
  /* Reading does not delete: the ingredient may be archived rather than gone,
     and a read path with write side effects is its own kind of bug. */
  assert.strictEqual((await al.listAliases("org1")).length, 1);
});

await test("pruning drops exactly the aliases whose ingredients are gone", async () => {
  await al.learnAliases("org1", [
    { text: "KEEP ME", ingredientId: "tomatoes" },
    { text: "DROP ME", ingredientId: "removed" },
  ]);

  const out = await al.pruneAliases("org1", known("tomatoes"));
  assert.strictEqual(out.dropped, 1);
  assert.deepStrictEqual((await al.listAliases("org1")).map((a) => a.text), ["keep me"]);
});

await test("one organization's vocabulary is unreachable from another", async () => {
  await al.learnAliases("org1", [{ text: "TOMATO RED 5KG", ingredientId: "tomatoes" }]);
  assert.strictEqual(await al.resolveAlias("org2", "TOMATO RED 5KG", known("tomatoes")), null);
});

/* ---------------- the matcher, reading the cache ------------------ */

const invoice = (text) => ({
  supplier: "Gulf Fresh", invoiceNo: "INV-1",
  lines: [{ text, qty: 4, unit: "kg", amount: 96 }],
});

await test("an alias resolves a line that token overlap would miss entirely", async () => {
  await inv.saveIngredient("org1", { name: "Tomatoes", stockUnit: "kg" });

  /* Nothing in "RD PLM 5K CS" overlaps with "Tomatoes" — this is the supplier
     code case, which is exactly what the matcher cannot do and the table can. */
  const cold = await pur.matchPurchase("org1", invoice("RD PLM 5K CS"));
  assert.strictEqual(cold.lines[0].ingredientId, null);

  await al.learnAliases("org1", [{ text: "RD PLM 5K CS", ingredientId: "tomatoes" }]);

  const warm = await pur.matchPurchase("org1", invoice("RD PLM 5K CS"));
  assert.strictEqual(warm.lines[0].ingredientId, "tomatoes");
  assert.strictEqual(warm.lines[0].confidence, 1);
  assert.strictEqual(warm.lines[0].viaAlias, true);
  /* Matched means nothing to create — the second invoice from this supplier
     asks for nothing at all. */
  assert.strictEqual(warm.lines[0].newItem, null);
  assert.strictEqual(warm.complete, true);
});

await test("an alias outranks a plausible wrong guess", async () => {
  await inv.saveIngredient("org1", { name: "Potatoes", stockUnit: "kg" });
  await inv.saveIngredient("org1", { name: "Tomatoes", stockUnit: "kg" });

  /* Left alone, "POTATO NEW 5KG" matches Potatoes. Somebody has since said this
     supplier's line is actually the tomatoes, and that decision has to win — it
     is evidence, and the guess is not. */
  const before = await pur.matchPurchase("org1", invoice("POTATO NEW 5KG"));
  assert.strictEqual(before.lines[0].ingredientId, "potatoes");

  await al.learnAliases("org1", [{ text: "POTATO NEW 5KG", ingredientId: "tomatoes" }]);

  const after = await pur.matchPurchase("org1", invoice("POTATO NEW 5KG"));
  assert.strictEqual(after.lines[0].ingredientId, "tomatoes");
  assert.strictEqual(after.lines[0].viaAlias, true);
});

await test("a stale alias does not resurrect a deleted ingredient on an invoice", async () => {
  await inv.saveIngredient("org1", { name: "Tomatoes", stockUnit: "kg" });
  await al.learnAliases("org1", [{ text: "RD PLM 5K CS", ingredientId: "tomatoes" }]);
  await inv.deleteIngredient("org1", "tomatoes", { hasHistory: false });

  const out = await pur.matchPurchase("org1", invoice("RD PLM 5K CS"));
  assert.strictEqual(out.lines[0].ingredientId, null);
  /* And it proposes creating one, which is the right offer — rather than
     writing a delivery against an id nothing resolves. */
  assert.ok(out.lines[0].newItem);
});

await test("clearing the store takes the learned vocabulary with it", async () => {
  await inv.saveIngredient("org1", { name: "Tomatoes", stockUnit: "kg" });
  await al.learnAliases("org1", [{ text: "RD PLM 5K CS", ingredientId: "tomatoes" }]);

  await inv.resetInventory("org1", ["b1"]);
  assert.deepStrictEqual(await al.listAliases("org1"), []);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
