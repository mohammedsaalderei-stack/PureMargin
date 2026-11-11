/* Register sales in the reports.

   The register is the only source of sales. It writes receipts in one shape
   so every report reads them through the same three functions: `getMetrics`,
   `salesLines`, `rawReceipts`. What is checked here is that a sale is counted
   once, lands in the store it was rung up in, and that the store names the
   business gave are the names the reports use. */

import assert from "node:assert/strict";

const data = await import("./_data.js");
const { buildSale } = await import("./_till.js");
const { registerOnlyRaw, getMetrics, salesLines, rawReceipts, NotConnected, REGISTER_BRANCH } = data;

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const NOW = Date.now();
const CAT = [{ id: "fries", name: "Fries", price: 12, addons: [] }, { id: "latte", name: "Latte", price: 18, addons: [] }];
const sold = (number, itemId, qty, { branchId = REGISTER_BRANCH.id, at = NOW - 3600e3 } = {}) => buildSale(
  { orderType: "takeaway", lines: [{ itemId, qty }], payment: { type: "card" } },
  { catalogue: CAT, vatPct: 5, branchId, at, number },
).receipt;

await test("register sales are counted once each", async () => {
  const raw = registerOnlyRaw([sold("PM-1", "fries", 2), sold("PM-2", "latte", 1)], NOW);
  assert.equal(raw.receipts.length, 2);
  assert.equal(raw.receiptCount, 2);
});

await test("a sale keeps the store it was rung up in, under the name the business gave it", async () => {
  const raw = registerOnlyRaw([sold("PM-1", "fries", 2, { branchId: "s-marina" })], NOW, { register: "Downtown", "s-marina": "Marina" });
  assert.deepEqual(raw.allBranches.sort(), ["register", "s-marina"]);
  assert.equal(raw.storeNames["s-marina"], "Marina");
  assert.equal(raw.storeNames.register, "Downtown");
});

await test("a store with no sales is still a branch of the business", async () => {
  const raw = registerOnlyRaw([], NOW, { register: "Downtown", "s-marina": "Marina" });
  assert.deepEqual(raw.allBranches.sort(), ["register", "s-marina"]);
});

await test("sales older than the window are left out", async () => {
  const raw = registerOnlyRaw([sold("PM-old", "fries", 1, { at: NOW - 90 * 864e5 }), sold("PM-1", "fries", 1)], NOW);
  assert.deepEqual(raw.receipts.map((r) => r.receipt_number), ["PM-1"]);
});

await test("figures come from the register's sales", async () => {
  const m = await getMetrics({ register: [sold("PM-1", "fries", 2), sold("PM-2", "latte", 1)] });
  const byName = Object.fromEntries((m.items || []).map((i) => [i.name, i]));
  assert.equal(byName.Fries.qty, 2);
  assert.equal(byName.Fries.revenue, 24);
  assert.equal(byName.Latte.qty, 1);
  assert.equal(m.source, "PureMargin");
});

await test("a store's figures are its own sales and nobody else's", async () => {
  const register = [sold("PM-1", "fries", 2), sold("PM-2", "latte", 1, { branchId: "s-marina" })];
  const m = await getMetrics({ register, branches: ["s-marina"], names: { register: "Downtown", "s-marina": "Marina" } });
  const names = (m.items || []).map((i) => i.name);
  assert.deepEqual(names, ["Latte"]);
});

await test("a store that has sold nothing is not shown the store that has", async () => {
  /* One store with sales, one permitted store without: equal in number, and
     not the same store. Counting them used to be mistaken for covering them. */
  const register = [sold("PM-1", "fries", 2)];
  const m = await getMetrics({ register, branches: ["s-marina"] });
  assert.equal(m.totals.sales, 0);
  assert.deepEqual(m.items || [], []);
  const all = await getMetrics({ register, branches: ["register", "s-marina"] });
  assert.equal(all.totals.receipts, 1);
});

await test("with no sales at all, there is nothing to show rather than invented figures", async () => {
  await assert.rejects(() => getMetrics({}), NotConnected);
  await assert.rejects(() => getMetrics({ register: [] }), NotConnected);
});

await test("the sales lines behind variance and the purchase plan are the register's", async () => {
  const out = await salesLines({ register: [sold("PM-1", "fries", 3)], from: NOW - 864e5, to: NOW });
  const fries = out.lines.find((l) => l.name === "Fries");
  assert.equal(fries.qty, 3);
  assert.equal(fries.branchId, REGISTER_BRANCH.id);
});

await test("the sales list reads register receipts", async () => {
  const out = await rawReceipts({ register: [sold("PM-1", "fries", 1)], days: 7 });
  assert.deepEqual(out.map((r) => r.receipt_number), ["PM-1"]);
});

await test("a register-only read covers the sixty days a period is compared with", async () => {
  const raw = registerOnlyRaw([sold("PM-1", "fries", 1)], NOW);
  assert.ok(raw.historyDays >= 60);
  assert.equal(raw.limitedHistory, false);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
