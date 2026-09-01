/* Correcting what the till reported.

   What these protect: nothing upstream is mutated, so a correction is always
   reversible; a void stops a sale counting without erasing it; the original is
   captured once and never rewritten by a second edit; tax and service survive
   a line correction instead of being quietly dropped; a correction whose basis
   has moved is flagged rather than applied on top; and an empty correction is
   refused rather than stored as a change with nothing in it. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const se = await import("./_saleedits.js");

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

const ORG = "org-1";

/* 100 + 50 of lines, 165 charged: 15 of tax sitting outside the lines. */
const RECEIPT = () => ({
  receipt_number: "R-1001",
  store_id: "branch-a",
  receipt_date: "2026-05-15T18:30:00.000Z",
  total_money: 165,
  line_items: [
    { item_name: "Chicken shawarma", quantity: 2, total_money: 100 },
    { item_name: "Fresh juice", quantity: 1, total_money: 50 },
  ],
});

await test("a receipt with no correction comes back untouched", () => {
  const r = RECEIPT();
  assert.deepEqual(se.applyEdit(r, null), r);
  assert.deepEqual(se.applyEdits([r], {}), [r]);
});

await test("voiding drops the sale from the figures", async () => {
  const r = RECEIPT();
  await se.saveEdit(ORG, { receiptId: "R-1001", voided: true, reason: "duplicate" },
    { actor: "sara", receipt: r });

  const edits = await se.listEdits(ORG);
  assert.equal(se.applyEdit(r, edits["R-1001"]), null);
  assert.deepEqual(se.applyEdits([r], edits), []);
});

await test("a voided sale keeps its original rather than disappearing", async () => {
  const r = RECEIPT();
  await se.saveEdit(ORG, { receiptId: "R-1001", voided: true, reason: "training" },
    { actor: "sara", receipt: r });

  const edit = (await se.listEdits(ORG))["R-1001"];
  assert.equal(edit.original.total, 165, "what the till said survives the void");
  assert.equal(edit.by, "sara");
  assert.equal(se.differenceOf(edit), -165);
});

await test("an explicit total wins over the lines", async () => {
  const r = RECEIPT();
  await se.saveEdit(ORG, { receiptId: "R-1001", total: 65, reason: "wrongamount" },
    { receipt: r });

  const out = se.applyEdit(r, (await se.listEdits(ORG))["R-1001"]);
  assert.equal(out.total_money, 65);
  assert.equal(out.line_items.length, 2, "lines are left alone when only the total was given");
});

await test("voiding one line keeps the tax proportion on what is left", async () => {
  const r = RECEIPT();
  await se.saveEdit(ORG, {
    receiptId: "R-1001", reason: "wrongitem", lines: { 1: { voided: true } },
  }, { receipt: r });

  const out = se.applyEdit(r, (await se.listEdits(ORG))["R-1001"]);
  assert.equal(out.line_items.length, 1);
  /* 100 of lines left out of 150, so two thirds of the 15 tax: 100 + 10. */
  assert.equal(out.total_money, 110);
});

await test("correcting a line amount re-totals the receipt", async () => {
  const r = RECEIPT();
  await se.saveEdit(ORG, {
    receiptId: "R-1001", reason: "wrongamount", lines: { 0: { amount: 10, qty: 2 } },
  }, { receipt: r });

  const out = se.applyEdit(r, (await se.listEdits(ORG))["R-1001"]);
  /* Lines fall from 150 to 60, so the 15 tax scales to 6. */
  assert.equal(out.line_items[0].total_money, 10);
  assert.equal(out.total_money, 66);
});

await test("a receipt with no tax re-totals to exactly its lines", () => {
  const r = { ...RECEIPT(), total_money: 150 };
  const edit = { receiptId: "R-1001", lines: { 1: { voided: true } }, total: null };
  assert.equal(se.applyEdit(r, edit).total_money, 100);
});

await test("the original is captured once, not rewritten by a second edit", async () => {
  const r = RECEIPT();
  await se.saveEdit(ORG, { receiptId: "R-1001", total: 65, reason: "wrongamount" }, { receipt: r });
  /* Somebody corrects their own correction. The difference has to stay
     measured against the till, not against the first attempt. */
  await se.saveEdit(ORG, { receiptId: "R-1001", total: 60, reason: "wrongamount" },
    { receipt: { ...r, total_money: 65 } });

  const edit = (await se.listEdits(ORG))["R-1001"];
  assert.equal(edit.original.total, 165);
  assert.equal(se.differenceOf(edit), -105);
});

await test("removing a correction restores the till's figure exactly", async () => {
  const r = RECEIPT();
  await se.saveEdit(ORG, { receiptId: "R-1001", voided: true, reason: "duplicate" }, { receipt: r });
  assert.deepEqual(await se.removeEdit(ORG, "R-1001"), { restored: true, receiptId: "R-1001" });

  const edits = await se.listEdits(ORG);
  assert.deepEqual(se.applyEdits([r], edits), [r], "nothing upstream was ever changed");
  assert.equal((await se.removeEdit(ORG, "R-1001")).error, "notfound");
});

await test("a correction is flagged stale when the till moves under it", async () => {
  const r = RECEIPT();
  await se.saveEdit(ORG, { receiptId: "R-1001", total: 65, reason: "wrongamount" }, { receipt: r });
  const edit = (await se.listEdits(ORG))["R-1001"];

  assert.equal(se.isStale(r, edit), false);
  /* Somebody fixed it in the POS as well. Applying the correction on top would
     now be correcting an already-corrected figure. */
  assert.equal(se.isStale({ ...r, total_money: 65 }, edit), true);
});

await test("a correction that changes nothing is refused", () => {
  assert.equal(se.validateEdit({ receiptId: "R-1", reason: "other" }), "empty");
  assert.equal(se.validateEdit({ receiptId: "R-1", reason: "other", lines: {} }), "empty");
  assert.equal(se.validateEdit({ receiptId: "R-1", reason: "other", total: 10 }), null);
  assert.equal(se.validateEdit({ receiptId: "R-1", reason: "other", voided: true }), null);
});

await test("a reason is required and must be one of the listed ones", () => {
  assert.equal(se.validateEdit({ receiptId: "R-1", voided: true }), "reason");
  assert.equal(se.validateEdit({ receiptId: "R-1", voided: true, reason: "because" }), "reason");
  assert.equal(se.validateEdit({ receiptId: "", voided: true, reason: "other" }), "receiptId");
});

await test("a negative amount is refused rather than stored", () => {
  assert.equal(se.validateEdit({ receiptId: "R-1", reason: "other", total: -5 }), "total");
  assert.equal(se.validateEdit({
    receiptId: "R-1", reason: "other", lines: { 0: { amount: -1 } },
  }), "amount");
  assert.equal(se.validateEdit({
    receiptId: "R-1", reason: "other", lines: { 0: { qty: -1 } },
  }), "qty");
});

await test("a total of zero is allowed — it is not the same as no total", () => {
  /* Zero is a real statement: the sale was rung up and comes to nothing. */
  assert.equal(se.validateEdit({ receiptId: "R-1", reason: "notcompleted", total: 0 }), null);
});

await test("one org's corrections never reach another's receipts", async () => {
  const r = RECEIPT();
  await se.saveEdit("org-a", { receiptId: "R-1001", voided: true, reason: "duplicate" }, { receipt: r });
  assert.deepEqual(await se.listEdits("org-b"), {});
  assert.deepEqual(se.applyEdits([r], await se.listEdits("org-b")), [r]);
});

await test("a receipt id is derived the same way whatever the POS calls it", () => {
  assert.equal(se.receiptIdOf({ receipt_number: "R-1" }), "R-1");
  assert.equal(se.receiptIdOf({ id: "abc" }), "abc");
  assert.equal(se.receiptIdOf({ receipt_id: "xyz" }), "xyz");
  assert.equal(se.receiptIdOf(null), "");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
