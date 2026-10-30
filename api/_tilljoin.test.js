/* Register sales in the reports.

   The register writes receipts in the till's shape so every report reads them
   through the same three functions: `getMetrics`, `salesLines`, `rawReceipts`.
   What is checked here is the join: that a register sale is counted once,
   that the till's cached read is never changed by one organization's sales,
   and that an account with no till at all still gets figures. */

import assert from "node:assert/strict";

/* Never reach a real till from a test. */
delete process.env.POS_ACCESS_TOKEN;
delete process.env.LOYVERSE_ACCESS_TOKEN;

const data = await import("./_data.js");
const { buildSale } = await import("./_till.js");
const { withRegister, registerOnlyRaw, getMetrics, salesLines, rawReceipts, branchList, NotConnected, REGISTER_BRANCH } = data;

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

const tillRaw = () => ({
  now: NOW, fetchedAt: NOW, since: new Date(NOW - 30 * 864e5).toISOString(),
  receiptCount: 1,
  receipts: [{ receipt_number: "1-1001", receipt_type: "SALE", receipt_date: new Date(NOW - 7200e3).toISOString(), store_id: "b1", total_money: 18, line_items: [{ item_name: "Latte", quantity: 1, total_money: 18 }], payments: [{ name: "Cash", money_amount: 18 }] }],
  limitedHistory: false, historyDays: 30, catalogue: new Map(),
  storeNames: { b1: "Downtown" }, allBranches: ["b1"],
});

await test("register sales join the till's, each counted once", async () => {
  const raw = withRegister(tillRaw(), [sold("PM-1", "fries", 2, { branchId: "b1" })]);
  assert.equal(raw.receipts.length, 2);
  assert.equal(raw.receiptCount, 2);
  assert.equal(raw.registerCount, 1);
});

await test("the till's cached read is never changed by a join", async () => {
  const cached = tillRaw();
  withRegister(cached, [sold("PM-1", "fries", 2)]);
  assert.equal(cached.receipts.length, 1);
  assert.deepEqual(cached.allBranches, ["b1"]);
});

await test("a sale rung up in a till's branch keeps that branch", async () => {
  const raw = withRegister(tillRaw(), [sold("PM-1", "fries", 2, { branchId: "b1" })]);
  assert.deepEqual(raw.allBranches, ["b1"]);
});

await test("the register's own branch is added, and named, when the till has no such branch", async () => {
  const raw = withRegister(tillRaw(), [sold("PM-1", "fries", 2)]);
  assert.deepEqual(raw.allBranches, ["b1", "register"]);
  assert.equal(raw.storeNames.register, "Register");
});

await test("register sales older than the till's window are left out with the till's", async () => {
  const raw = withRegister(tillRaw(), [sold("PM-old", "fries", 1, { at: NOW - 45 * 864e5 })]);
  assert.equal(raw.receipts.length, 1);
});

await test("no register sales leaves the read exactly as it was", async () => {
  const cached = tillRaw();
  assert.equal(withRegister(cached, []), cached);
  assert.equal(withRegister(cached, null), cached);
});

await test("an account with no till gets figures from its register alone", async () => {
  const m = await getMetrics("", { register: [sold("PM-1", "fries", 2), sold("PM-2", "latte", 1)] });
  const byName = Object.fromEntries((m.items || []).map((i) => [i.name, i]));
  assert.equal(byName.Fries.qty, 2);
  assert.equal(byName.Fries.revenue, 24);
  assert.equal(byName.Latte.qty, 1);
  assert.equal(m.fetch.registerCount, 2);
  assert.deepEqual(m.allBranches, ["register"]);
});

await test("with no till and no register sales, it is still 'not connected'", async () => {
  await assert.rejects(() => getMetrics("", {}), NotConnected);
  await assert.rejects(() => getMetrics("", { register: [] }), NotConnected);
});

await test("the sales lines behind variance and the purchase plan include register sales", async () => {
  const out = await salesLines("", { register: [sold("PM-1", "fries", 3)], from: NOW - 864e5, to: NOW });
  const fries = out.lines.find((l) => l.name === "Fries");
  assert.equal(fries.qty, 3);
  assert.equal(fries.branchId, "register");
});

await test("the sales list reads register receipts as it reads the till's", async () => {
  const out = await rawReceipts("", { register: [sold("PM-1", "fries", 1)], days: 7 });
  assert.deepEqual(out.map((r) => r.receipt_number), ["PM-1"]);
});

await test("the register is the branch of an account with no till that uses it", async () => {
  assert.deepEqual(await branchList("", { register: true }), [{ ...REGISTER_BRANCH }]);
  await assert.rejects(() => branchList(""), NotConnected);
});

await test("a register-only read covers the sixty days a period is compared with", async () => {
  const raw = registerOnlyRaw([sold("PM-1", "fries", 1)], NOW);
  assert.ok(raw.historyDays >= 60);
  assert.equal(raw.limitedHistory, false);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
