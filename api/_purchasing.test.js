/* Stage 4, phase 4: purchase orders, receiving, allocation and returns.

   The claims worth protecting: ordered and received stay separate records, cost
   landed on stock includes the invoice's discounts and charges apportioned by
   value, over-receipt is refused rather than analysed later, prices agreed and
   invoiced are compared per base unit so a different delivery unit can't fake a
   variance, and a return is a movement at the cost the goods came in at. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");
const po = await import("./_purchasing.js");

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

const near = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

/* Flour stocked in kg and bought in 25 kg sacks; boxes counted each. */
async function seed() {
  await inv.saveSupplier("org1", { name: "Gulf Foods" });
  await inv.saveIngredient("org1", {
    name: "Plain flour", stockUnit: "kg", purchaseUnit: "kg", category: "Dry",
  });
  await inv.saveIngredient("org1", { name: "Burger box", stockUnit: "ea", category: "Packaging" });
}

const onHand = async (id) => {
  const rows = await mv.balances("org1", ["b1"], {
    ingredients: await inv.listIngredients("org1", { includeArchived: true }),
  });
  return rows.find((r) => r.ingredientId === id)?.qty ?? 0;
};

/* A submitted order: 20 kg of flour at 10, 100 boxes at 0.5. */
async function openOrder(lines) {
  const out = await po.saveOrder("org1", "b1", {
    supplierId: "gulf-foods",
    actor: "buyer",
    reference: "PO-1",
    lines: lines || [
      { ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 10 },
      { ingredientId: "burger-box", qty: 100, unit: "ea", unitPrice: 0.5 },
    ],
  });
  assert.ok(out.order, `order not created: ${out.error}`);
  return (await po.submitOrder("org1", out.order.id, { actor: "buyer" })).order;
}

/* ------------------------- the order ----------------------------- */

await test("an order is created as a draft and priced from its lines", async () => {
  await seed();
  const { order } = await po.saveOrder("org1", "b1", {
    supplierId: "gulf-foods", actor: "buyer",
    lines: [{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 10 }],
  });
  assert.strictEqual(order.status, "draft");
  assert.strictEqual(order.supplierName, "Gulf Foods");
  near(po.summarise(order).orderedValue, 200);
});

await test("an order can be placed in a purchase unit and priced per that unit", async () => {
  await seed();
  const { order } = await po.saveOrder("org1", "b1", {
    lines: [{ ingredientId: "burger-box", qty: 10, unit: "dozen", unitPrice: 6 }],
  });
  /* Ten dozen at 6 a dozen: 120 boxes, and 0.5 each however it was typed. */
  near(order.lines[0].qtyBase, 120);
  near(order.lines[0].pricePerBase, 0.5);
});

await test("bad lines are refused by field name", async () => {
  await seed();
  const bad = async (lines) => (await po.saveOrder("org1", "b1", { lines })).error;
  assert.strictEqual(await bad([]), "nolines");
  assert.strictEqual(await bad([{ ingredientId: "nope", qty: 1, unitPrice: 1 }]), "ingredientId");
  assert.strictEqual(await bad([{ ingredientId: "plain-flour", qty: 0, unitPrice: 1 }]), "qty");
  assert.strictEqual(await bad([{ ingredientId: "plain-flour", qty: 1, unit: "l", unitPrice: 1 }]), "unit");
  assert.strictEqual(await bad([{ ingredientId: "plain-flour", qty: 1, unitPrice: -5 }]), "unitPrice");
  assert.strictEqual(await bad([
    { ingredientId: "plain-flour", qty: 1, unitPrice: 1 },
    { ingredientId: "plain-flour", qty: 2, unitPrice: 1 },
  ]), "duplicate");
  assert.strictEqual((await po.saveOrder("org1", "b1", {
    supplierId: "ghost", lines: [{ ingredientId: "plain-flour", qty: 1, unitPrice: 1 }],
  })).error, "supplierId");
});

await test("a submitted order can no longer be rewritten", async () => {
  await seed();
  const order = await openOrder();
  assert.strictEqual(order.status, "open");
  const out = await po.saveOrder("org1", "b1", {
    id: order.id, lines: [{ ingredientId: "plain-flour", qty: 1, unitPrice: 1 }],
  });
  assert.strictEqual(out.error, "notdraft");
});

await test("an order is cancellable until something arrives", async () => {
  await seed();
  const order = await openOrder();
  await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "plain-flour", qty: 5, unit: "kg" }],
  });
  assert.strictEqual((await po.cancelOrder("org1", order.id)).error, "received");

  const fresh = await openOrder();
  const out = await po.cancelOrder("org1", fresh.id, { actor: "buyer", reason: "duplicate" });
  assert.strictEqual(out.order.status, "cancelled");
  assert.strictEqual(out.order.cancelReason, "duplicate");
});

/* ------------------------- receiving ----------------------------- */

await test("receiving writes movements and puts the stock on the shelf", async () => {
  await seed();
  const order = await openOrder();
  const out = await po.receiveOrder("org1", order.id, {
    lines: [
      { ingredientId: "plain-flour", qty: 20, unit: "kg" },
      { ingredientId: "burger-box", qty: 100, unit: "ea" },
    ],
    invoiceNo: "INV-88", actor: "storeman",
  });

  assert.strictEqual(out.order.status, "received");
  near(await onHand("plain-flour"), 20);
  near(await onHand("burger-box"), 100);

  const moves = await mv.listMovements("org1", "b1", { type: "receive" });
  assert.strictEqual(moves.length, 2);
  assert.strictEqual(moves[0].ref, `po:${order.id}`);
  assert.strictEqual(moves[0].actor, "storeman");
  assert.strictEqual(out.receipt.invoiceNo, "INV-88");
});

await test("a partial delivery leaves the rest outstanding", async () => {
  await seed();
  const order = await openOrder();
  const out = await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "plain-flour", qty: 12, unit: "kg" }],
  });

  assert.strictEqual(out.order.status, "partial");
  const summary = po.summarise(out.order);
  assert.strictEqual(summary.fullyReceived, false);
  assert.deepStrictEqual(
    summary.outstanding.map((o) => [o.ingredientId, o.qty, o.unit]),
    [["plain-flour", 8, "kg"], ["burger-box", 100, "ea"]]
  );
});

await test("the rest of a line can arrive later, in a different unit", async () => {
  await seed();
  const order = await openOrder();
  await po.receiveOrder("org1", order.id, { lines: [{ ingredientId: "plain-flour", qty: 12, unit: "kg" }] });
  /* The remaining 8 kg turns up as 8000 g. */
  const out = await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "plain-flour", qty: 8000, unit: "g", unitPrice: 0.01 }],
  });
  near(await onHand("plain-flour"), 20);
  assert.strictEqual(po.summarise(out.order).outstanding.length, 1, "only the boxes are still owed");
});

await test("over-receipt is refused and says what is still expected", async () => {
  await seed();
  const order = await openOrder();
  const out = await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "plain-flour", qty: 100, unit: "kg" }],
  });
  assert.strictEqual(out.error, "over");
  near(out.remaining, 20);
  assert.strictEqual(out.unit, "kg");
  /* Nothing was written. */
  near(await onHand("plain-flour"), 0);
});

await test("a rejected line abandons the whole receipt, stock included", async () => {
  await seed();
  const order = await openOrder();
  const out = await po.receiveOrder("org1", order.id, {
    lines: [
      { ingredientId: "plain-flour", qty: 20, unit: "kg" },
      { ingredientId: "burger-box", qty: 500, unit: "ea" },
    ],
  });
  assert.strictEqual(out.error, "over");
  near(await onHand("plain-flour"), 0, 1e-9);
  assert.strictEqual((await mv.listMovements("org1", "b1", { type: "receive" })).length, 0);
});

await test("a draft or a finished order cannot take a delivery", async () => {
  await seed();
  const { order } = await po.saveOrder("org1", "b1", {
    lines: [{ ingredientId: "plain-flour", qty: 1, unitPrice: 1 }],
  });
  assert.strictEqual((await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "plain-flour", qty: 1 }] })).error, "notopen");

  const done = await openOrder([{ ingredientId: "plain-flour", qty: 5, unit: "kg", unitPrice: 10 }]);
  await po.receiveOrder("org1", done.id, { lines: [{ ingredientId: "plain-flour", qty: 5, unit: "kg" }] });
  assert.strictEqual((await po.receiveOrder("org1", done.id, {
    lines: [{ ingredientId: "plain-flour", qty: 1, unit: "kg" }] })).error, "notopen");
});

/* -------------------- cost, charges, variance -------------------- */

await test("the invoiced price defaults to the agreed price", async () => {
  await seed();
  const order = await openOrder();
  const out = await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "plain-flour", qty: 20, unit: "kg" }],
  });
  near(out.receipt.lines[0].unitPrice, 10);
  near(out.receipt.lines[0].priceVarianceValue, 0);
});

await test("charges are allocated pro rata by line value and landed on cost", async () => {
  await seed();
  const order = await openOrder();
  /* 200 of flour + 50 of boxes = 250 of goods, plus 25 delivery: flour takes
     four fifths (20), boxes one fifth (5). */
  const out = await po.receiveOrder("org1", order.id, {
    lines: [
      { ingredientId: "plain-flour", qty: 20, unit: "kg" },
      { ingredientId: "burger-box", qty: 100, unit: "ea" },
    ],
    charges: 25,
  });

  const flour = out.receipt.lines.find((l) => l.ingredientId === "plain-flour");
  const boxes = out.receipt.lines.find((l) => l.ingredientId === "burger-box");
  near(flour.allocated, 20);
  near(boxes.allocated, 5);
  near(flour.effectiveUnitCost, 11);       // 10 + 20/20 kg
  near(boxes.effectiveUnitCost, 0.55);     // 0.5 + 5/100 ea
  near(out.receipt.invoiceTotal, 275);

  /* And the ledger carries the landed cost, not the sticker price. */
  near(await mv.lastCostPerBase("org1", ["b1"], "plain-flour"), 11 / 1000);
});

await test("a discount reduces landed cost the same way", async () => {
  await seed();
  const order = await openOrder([{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 10 }]);
  const out = await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "plain-flour", qty: 20, unit: "kg" }],
    discount: 40,
  });
  near(out.receipt.lines[0].effectiveUnitCost, 8);
  near(out.receipt.invoiceTotal, 160);
});

await test("a free line takes no share of an allocation instead of dividing by nothing", async () => {
  await seed();
  const order = await openOrder([{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 0 }]);
  const out = await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 0 }],
    charges: 30,
  });
  near(out.receipt.lines[0].allocated, 0);
  near(out.receipt.lines[0].effectiveUnitCost, 0);
  assert.ok(Number.isFinite(out.receipt.lines[0].effectiveUnitCost));
});

await test("price variance compares agreed against invoiced", async () => {
  await seed();
  const order = await openOrder([{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 10 }]);
  const out = await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 12 }],
  });
  /* 2 more per kg on 20 kg. */
  near(out.receipt.lines[0].priceVarianceValue, 40);
  near(po.summarise(out.order).priceVarianceValue, 40);
});

await test("a different delivery unit does not fake a price variance", async () => {
  await seed();
  /* Ordered by the dozen at 6 (= 0.5 each), delivered loose at 0.5 each. */
  const order = await openOrder([{ ingredientId: "burger-box", qty: 10, unit: "dozen", unitPrice: 6 }]);
  const out = await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "burger-box", qty: 120, unit: "ea", unitPrice: 0.5 }],
  });
  near(out.receipt.lines[0].priceVarianceValue, 0);
  near(await onHand("burger-box"), 120);
});

await test("the summary keeps ordered, invoiced, allocated and variance apart", async () => {
  await seed();
  const order = await openOrder([{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 10 }]);
  const out = await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 11 }],
    charges: 20,
  });
  const s = po.summarise(out.order);
  near(s.orderedValue, 200);
  near(s.receivedValue, 240);        // 220 invoiced goods + 20 delivery
  near(s.priceVarianceValue, 20);    // 1 more per kg
  near(s.allocatedValue, 20);
});

/* --------------------------- returns ----------------------------- */

await test("a return takes stock back out at the cost it came in at", async () => {
  await seed();
  const order = await openOrder([{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 10 }]);
  await po.receiveOrder("org1", order.id, {
    lines: [{ ingredientId: "plain-flour", qty: 20, unit: "kg" }],
    charges: 20,   // landed cost is 11/kg
  });

  const out = await po.returnToSupplier("org1", order.id, {
    ingredientId: "plain-flour", qty: 5, unit: "kg", reason: "damaged", actor: "storeman",
  });
  near(await onHand("plain-flour"), 15);

  const returns = await mv.listMovements("org1", "b1", { type: "return_out" });
  assert.strictEqual(returns.length, 1);
  near(returns[0].qty, -5);
  near(returns[0].costPerBase, 11 / 1000, 1e-9);
  near(po.summarise(out.order).returnedValue, 55);
});

await test("more cannot be returned than arrived", async () => {
  await seed();
  const order = await openOrder([{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 10 }]);
  await po.receiveOrder("org1", order.id, { lines: [{ ingredientId: "plain-flour", qty: 8, unit: "kg" }] });

  const out = await po.returnToSupplier("org1", order.id, { ingredientId: "plain-flour", qty: 9, unit: "kg" });
  assert.strictEqual(out.error, "overreturn");
  near(out.remaining, 8);
  near(await onHand("plain-flour"), 8);
});

await test("nothing can be returned against an order that never arrived", async () => {
  await seed();
  const order = await openOrder();
  assert.strictEqual((await po.returnToSupplier("org1", order.id, {
    ingredientId: "plain-flour", qty: 1, unit: "kg" })).error, "nothingreceived");
});

await test("a return does not reopen a completed order", async () => {
  await seed();
  const order = await openOrder([{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 10 }]);
  await po.receiveOrder("org1", order.id, { lines: [{ ingredientId: "plain-flour", qty: 20, unit: "kg" }] });
  const out = await po.returnToSupplier("org1", order.id, { ingredientId: "plain-flour", qty: 20, unit: "kg" });
  assert.strictEqual(out.order.status, "received", "the goods arrived; they were then sent back");
});

/* --------------------- listing and isolation --------------------- */

await test("orders list only for authorized branches, newest first", async () => {
  await seed();
  const a = await po.saveOrder("org1", "b1", { lines: [{ ingredientId: "plain-flour", qty: 1, unitPrice: 1 }] });
  const b = await po.saveOrder("org1", "b2", { lines: [{ ingredientId: "plain-flour", qty: 1, unitPrice: 1 }] });

  assert.deepStrictEqual((await po.listOrders("org1", ["b1"])).map((o) => o.id), [a.order.id]);
  assert.deepStrictEqual(
    (await po.listOrders("org1", ["b1", "b2"])).map((o) => o.id),
    [b.order.id, a.order.id]
  );
  assert.deepStrictEqual(await po.listOrders("org1", []), []);
  /* Thin rows, with the summary a buyer scans by. */
  const row = (await po.listOrders("org1", ["b1"]))[0];
  assert.strictEqual(row.lines, undefined);
  assert.strictEqual(row.lineCount, 1);
  assert.ok(row.summary);
});

await test("a status filter separates what is still owed from what is done", async () => {
  await seed();
  const open = await openOrder([{ ingredientId: "plain-flour", qty: 20, unit: "kg", unitPrice: 10 }]);
  await po.receiveOrder("org1", open.id, { lines: [{ ingredientId: "plain-flour", qty: 5, unit: "kg" }] });
  await openOrder([{ ingredientId: "burger-box", qty: 10, unit: "ea", unitPrice: 1 }]);

  assert.strictEqual((await po.listOrders("org1", ["b1"], { status: "partial" })).length, 1);
  assert.strictEqual((await po.listOrders("org1", ["b1"], { status: "open" })).length, 1);
});

await test("one organization's orders are unreachable from another", async () => {
  await seed();
  const order = await openOrder();
  assert.strictEqual(await po.getOrder("org2", order.id), null);
  assert.deepStrictEqual(await po.listOrders("org2", ["b1"]), []);
});

await test("receiving posts into the order's own branch, not one passed in later", async () => {
  await seed();
  const { order } = await po.saveOrder("org1", "b2", {
    lines: [{ ingredientId: "plain-flour", qty: 5, unit: "kg", unitPrice: 10 }],
  });
  await po.submitOrder("org1", order.id);
  await po.receiveOrder("org1", order.id, { lines: [{ ingredientId: "plain-flour", qty: 5, unit: "kg" }] });

  near(await onHand("plain-flour"), 0, 1e-9);
  assert.strictEqual((await mv.listMovements("org1", "b2", { type: "receive" })).length, 1);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
