/* What one of something is, for one ingredient — and the lines that used to
   stop on it.

   Two documents a kitchen actually sends: a delivery note selling tahini by
   the jar and oil by the tin, and a recipe card asking for two lemons from a
   shelf kept in kilograms. Each was a unit short of being saved, and the
   screen handed the gap to whoever was scanning. These check that the
   reader's conversion closes it, that an estimate stays labelled as one, that
   plain arithmetic is never overruled by a conversion, and that what a saved
   document taught is remembered for the next one. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const { readConversion, toShelf, mergeConversions } = await import("./_conversions.js");
const inv = await import("./_inventory.js");
const { buildPurchase } = await import("./_purchase.js");
const rc = await import("./_recipes.js");

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
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);
const ORG = "org-conv";

/* ── Reading a conversion ── */

await test("a conversion is restated in the shelf's own unit", async () => {
  const c = readConversion({ from: "pcs", qty: 100, unit: "g" }, "kg");
  assert.equal(c.from, "ea");
  assert.equal(c.unit, "kg");
  near(c.qty, 0.1);
});

await test("a conversion inside one kind of measure is refused — that is arithmetic", async () => {
  assert.equal(readConversion({ from: "kg", qty: 900, unit: "g" }, "g"), null);
});

await test("a conversion into the wrong kind of measure for the shelf is refused", async () => {
  assert.equal(readConversion({ from: "tin", qty: 18, unit: "l" }, "kg"), null);
});

await test("a conversion is an estimate unless it says it was printed", async () => {
  assert.equal(readConversion({ from: "tin", qty: 18, unit: "l" }, "l").estimated, true);
  assert.equal(readConversion({ from: "tin", qty: 18, unit: "l", estimated: false }, "l").estimated, false);
});

/* ── Applying one ── */

await test("plain arithmetic is never overruled by a conversion", async () => {
  const wrong = readConversion({ from: "pcs", qty: 5, unit: "kg" }, "kg");
  const out = toShelf(3, "kg", { stockUnit: "g" }, [wrong]);
  assert.equal(out.via, "unit");
  near(out.qty, 3000);
});

await test("two lemons reach a shelf kept in kilograms", async () => {
  const out = toShelf(2, "pcs", { stockUnit: "kg" }, [readConversion({ from: "pcs", qty: 0.1, unit: "kg" }, "kg")]);
  near(out.qty, 0.2);
  assert.equal(out.unit, "kg");
  assert.equal(out.estimated, true);
});

await test("a package word converts by what one holds", async () => {
  const out = toShelf(2, "Tin", { stockUnit: "l" }, [readConversion({ from: "tin", qty: 18, unit: "L", estimated: false }, "l")]);
  near(out.qty, 36);
  assert.equal(out.estimated, false);
});

await test("what the paper printed beats what is kept, and what is kept beats a guess", async () => {
  const kept = { stockUnit: "l", conversions: [{ from: "tin", qty: 17, unit: "l", estimated: false }] };
  const printed = readConversion({ from: "tin", qty: 18, unit: "l", estimated: false }, "l");
  const guessed = readConversion({ from: "tin", qty: 20, unit: "l" }, "l");
  near(toShelf(1, "tin", kept, [printed]).qty, 18);
  near(toShelf(1, "tin", kept, [guessed]).qty, 17);
});

await test("with nothing to say what one is, it is still the person's question", async () => {
  assert.equal(toShelf(2, "pcs", { stockUnit: "kg" }, []), null);
  assert.equal(toShelf(1, "tin", { stockUnit: "l" }, []), null);
});

await test("a printed conversion replaces an estimate, and never the other way", async () => {
  const est = { from: "tin", kind: "word", qty: 20, unit: "l", estimated: true };
  const printed = { from: "tin", kind: "word", qty: 18, unit: "l", estimated: false };
  assert.equal(mergeConversions([est], [printed])[0].qty, 18);
  assert.equal(mergeConversions([printed], [est])[0].qty, 18);
});

/* ── A delivery note ── */

const invoice = (lines) => ({ lines });

await test("a new item sold by a jar of stated size is received in kilos, not flagged", async () => {
  const [line] = buildPurchase(invoice([{
    text: "Tahini, 2 kg jar", qty: 2, unit: "jar", amount: 56,
    pack: { count: 1, size: 2, unit: "kg" },
    newItem: { name: "Tahini", stockUnit: "kg", purchaseUnit: "jar", packSize: 2 },
  }]), []).lines;
  assert.equal(line.trouble, null);
  assert.equal(line.receiveUnit, "kg");
  near(line.receiveQty, 4);
  near(line.unitCost, 14);
  assert.equal(line.estimated, false);
  /* And the row can show the arithmetic against the paper: one jar of 2 kg. */
  assert.ok(line.pack, "the jar's contents travel to the row");
  near(line.pack.qty, 2);
});

await test("a tin with no size printed is received at the reader's estimate, marked as one", async () => {
  const [line] = buildPurchase(invoice([{
    text: "Sunflower oil tin", qty: 1, unit: "tin", amount: 95,
    pack: { count: 1, size: 18, unit: "L", estimated: true },
    newItem: { name: "Sunflower oil", stockUnit: "l", purchaseUnit: "tin" },
  }]), []).lines;
  assert.equal(line.trouble, null);
  near(line.receiveQty, 18);
  assert.equal(line.receiveUnit, "l");
  assert.equal(line.estimated, true);
  assert.equal(line.learn.from, "tin");
});

await test("a new item's pack size of 1 by default is not taken as an answer", async () => {
  const [line] = buildPurchase(invoice([{
    text: "Pickles jar", qty: 1, unit: "jar", amount: 18,
    newItem: { name: "Pickles", stockUnit: "kg", purchaseUnit: "jar" },
  }]), []).lines;
  assert.equal(line.trouble, "packaging");
});

await test("lemons kept by the piece take a delivery in kilos through the reader's conversion", async () => {
  const { ingredient } = await inv.saveIngredient(ORG, { name: "Lemon", stockUnit: "ea" });
  const [line] = buildPurchase(invoice([{
    text: "Lemon", qty: 3, unit: "kg", amount: 19.5, ingredient: "Lemon",
    convert: { from: "kg", qty: 10, unit: "pcs" },
  }]), [ingredient]).lines;
  assert.equal(line.trouble, null);
  near(line.receiveQty, 30);
  assert.equal(line.receiveUnit, "ea");
  near(line.unitCost, 0.65);
});

await test("a package learned from one delivery converts the next with nothing printed", async () => {
  const { ingredient } = await inv.saveIngredient(ORG, { name: "Sunflower oil", stockUnit: "l" });
  await inv.learnConversions(ORG, ingredient.id, [{ from: "Tin", qty: 18, unit: "l", estimated: true }]);
  const [line] = buildPurchase(invoice([{
    text: "Sunflower oil", qty: 2, unit: "tin", amount: 190, ingredient: "Sunflower oil",
  }]), await inv.listIngredients(ORG)).lines;
  near(line.receiveQty, 36);
  assert.equal(line.trouble, null);
});

/* ── A recipe card ── */

await test("two lemons save against a shelf kept in kilograms, and the lemon is remembered", async () => {
  await inv.saveIngredient(ORG, { name: "Lemon", stockUnit: "kg" });
  const out = await rc.saveVersion(ORG, {
    menuItem: "Mint lemonade",
    lines: [{ name: "Lemon", qty: 2, unit: "pcs", convert: { from: "pcs", qty: 100, unit: "g" } }],
  });
  assert.equal(out.error, undefined, JSON.stringify(out));
  const [line] = out.version.lines;
  near(line.qtyBase, 200);
  assert.equal(line.via.estimated, true);

  const again = await rc.saveVersion(ORG, { menuItem: "Lemon water", lines: [{ name: "Lemon", qty: 3, unit: "pcs" }] });
  near(again.version.lines[0].qtyBase, 300);
});

await test("with no conversion from anywhere, the line is still refused by name", async () => {
  await inv.saveIngredient(ORG, { name: "Lemon", stockUnit: "kg" });
  const out = await rc.saveVersion(ORG, { menuItem: "Mint lemonade", lines: [{ name: "Lemon", qty: 2, unit: "pcs" }] });
  assert.equal(out.error, "unit");
  assert.equal(out.name, "Lemon");
});

await test("a kitchen word on a new ingredient saves in the unit its conversion lands in", async () => {
  const out = await rc.saveVersion(ORG, {
    menuItem: "Toum",
    lines: [{ name: "Garlic", qty: 2, unit: "cloves", convert: { from: "clove", qty: 0.005, unit: "kg" } }],
  });
  assert.equal(out.error, undefined, JSON.stringify(out));
  near(out.version.lines[0].qtyBase, 10);
  /* Kilograms because that is what the clove was said to be in — not grams
     because grams is the default for a unit nobody named. */
  assert.equal((await inv.getIngredient(ORG, "garlic")).stockUnit, "kg");
});

await test("editing an item on the form keeps what scans taught it", async () => {
  const { ingredient } = await inv.saveIngredient(ORG, { name: "Lemon", stockUnit: "kg" });
  await inv.learnConversions(ORG, ingredient.id, [{ from: "pcs", qty: 0.1, unit: "kg" }]);
  await inv.saveIngredient(ORG, { id: ingredient.id, name: "Lemon", stockUnit: "kg", category: "produce" });
  assert.equal((await inv.getIngredient(ORG, ingredient.id)).conversions.length, 1);
});

await test("a simulated quantity on a converted line keeps the rate it was saved at", async () => {
  /* 6 a kilo, so two lemons of 100 g cost 1.20 and four cost 2.40. */
  await inv.saveIngredient(ORG, { name: "Lemon", stockUnit: "kg", estimatedCostPerBase: 0.006 });
  const out = await rc.saveVersion(ORG, {
    menuItem: "Mint lemonade",
    lines: [{ name: "Lemon", qty: 2, unit: "pcs", convert: { from: "pcs", qty: 0.1, unit: "kg" } }],
  });
  const sim = await rc.simulate(ORG, out.recipe.id, [], { qtyOverrides: { lemon: 4 } });
  near(sim.before.perPortion.total, 1.2, 1e-4);
  near(sim.after.perPortion.total, 2.4, 1e-4);
});

/* ── Through the route a delivery is saved by ── */

delete process.env.POS_ACCESS_TOKEN;
delete process.env.LOYVERSE_ACCESS_TOKEN;
const { createAccount, getAccount } = await import("./_accounts.js");
const { issueToken } = await import("./_auth.js");
const { orgFor } = await import("./_org.js");
const mv = await import("./_movements.js");
const stock = (await import("./stock.js")).default;

function fakeRes() {
  const r = {
    code: null, body: null, headers: {},
    setHeader(k, v) { r.headers[k] = v; return r; },
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}

await test("saving the delivery receives the tin at its estimate and remembers what a tin holds", async () => {
  await createAccount({ username: "owner1", password: "Conv-test-9x" });
  const account = await getAccount("owner1");
  const org = await orgFor(account);
  const token = issueToken("owner1", account.tokenVersion || 0);

  const { lines } = buildPurchase(invoice([{
    text: "Sunflower oil tin", qty: 1, unit: "tin", amount: 95,
    pack: { count: 1, size: 18, unit: "L", estimated: true },
    newItem: { name: "Sunflower oil", stockUnit: "l", purchaseUnit: "tin" },
  }]), []);
  const res = fakeRes();
  await stock({
    method: "POST", headers: { authorization: `Bearer ${token}` },
    query: { what: "invoice" }, body: { branchId: "register", lines },
  }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));

  const [moved] = await mv.listMovements(org.id, "register", { ingredientId: "sunflower-oil" });
  near(moved.qtyBase, 18000);
  const oil = await inv.getIngredient(org.id, "sunflower-oil");
  assert.equal(oil.conversions[0].from, "tin");
  near(oil.conversions[0].qty, 18);
  assert.equal(oil.conversions[0].estimated, true);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
