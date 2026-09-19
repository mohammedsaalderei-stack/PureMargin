/* Completing an order, against a real Postgres.

   ── Why this one cannot be faked ─────────────────────────────────────────

   Every other test here runs against an in-memory store, because what they
   check is arithmetic and the store is incidental. This one checks the
   opposite: that two requests arriving at the same instant produce one effect,
   that a retry does not deduct stock twice, and that a failure leaves nothing
   behind. None of that means anything without real transactions and real row
   locks — a fake would be testing the fake.

   So it needs a database. With `DATABASE_URL` unset it skips and says so
   rather than failing, because somebody checking out this repository to read
   it should still get a green suite.

   ── It is safe to run against the live database ──────────────────────────

   Every row it writes carries a business id generated fresh for the run, and
   `businesses` has a foreign key from everything else — so nothing it creates
   can touch, or be reached from, a real organization's data. It deletes what
   it made at the end, and the count afterwards is asserted rather than
   assumed.

   The concurrency tests genuinely commit. They have to: a transaction that
   rolls back never contends for anything, so testing a lock inside one would
   test nothing at all. */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadLocalEnv } from "./_env.js";

loadLocalEnv();

const { configured, db, close, transaction, ensureBusiness } = await import("./_db.js");

if (!configured) {
  console.log("  skip  order completion — no DATABASE_URL set");
  console.log("\nall passed");
  process.exit(0);
}

const { createOrder, completeOrder, transitionOrder, canTransition } = await import("./_orders.js");
const { fromDb, toDecimalString } = await import("./_money.js");

/* This run's own tenant. Nothing else can see it and it sees nothing else. */
const BIZ = crypto.randomUUID();

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

/* One order, two lines, ready to be completed. */
async function seedOrder(over = {}) {
  return transaction(async (client) => {
    await ensureBusiness(client, BIZ);
    return createOrder(client, {
      businessId: BIZ,
      branchId: "b1",
      lines: [
        { itemName: "Shawarma", quantity: "2", priceSnapshot: "24.00" },
        { itemName: "Tea", quantity: "1", priceSnapshot: "6.00" },
      ],
      ...over,
    });
  });
}

/* Flour at 3.00/kg is 0.003 per gram — below the smallest coin, which is the
   case that breaks any implementation converting unit costs to minor units. */
const consumptionFor = (order, over = {}) => [
  {
    orderLineId: order.lines[0].id,
    ingredientId: "beef",
    branchId: "b1",
    qtyBase: "300",
    costPerBase: "0.03",
    ...over,
  },
  {
    orderLineId: order.lines[0].id,
    ingredientId: "bread",
    branchId: "b1",
    qtyBase: "150",
    costPerBase: "0.003",
    ...over,
  },
];

const movementsFor = async (orderId) => {
  const r = await db().query(
    "SELECT ingredient_id, quantity_signed, unit_cost_snapshot FROM inventory_movements WHERE source_id = $1 AND business_id = $2 ORDER BY ingredient_id",
    [orderId, BIZ],
  );
  return r.rows;
};

/* ── The transitions ────────────────────────────────────────────────────── */

await test("the state machine refuses what it should", () => {
  assert.equal(canTransition("new", "preparing"), true);
  assert.equal(canTransition("ready", "completed"), true);
  assert.equal(canTransition("cancelled", "completed"), false, "a cancelled order cannot be sold");
  assert.equal(canTransition("completed", "cancelled"), false, "and a sale is not undone by cancelling");
  assert.equal(canTransition("completed", "completed"), false);
});

await test("completion is not reachable through the ordinary transition", async () => {
  const order = await seedOrder();
  const out = await transaction((c) =>
    transitionOrder(c, { businessId: BIZ, orderId: order.id, to: "completed" }));
  /* It would change a word and post no stock, which is the silent version of
     every bug this module exists to prevent. */
  assert.equal(out.error, "usecomplete");
});

/* ── Completing ─────────────────────────────────────────────────────────── */

await test("completing records the sale, the cost and the stock together", async () => {
  const order = await seedOrder();
  const out = await transaction((c) =>
    completeOrder(c, { businessId: BIZ, orderId: order.id, consumption: consumptionFor(order) }));

  assert.equal(out.already, false);
  assert.equal(out.order.version, 2, "the version moved");
  assert.ok(out.order.completedAt, "and it carries the moment");

  const moves = await movementsFor(order.id);
  assert.equal(moves.length, 2);
  assert.equal(Number(moves[0].quantity_signed), -300, "stock went out, not in");

  /* 300 x 0.03 = 9.00, plus 150 x 0.003 = 0.45. The second is the one that
     would be zero if unit costs were rounded to fils before multiplying. */
  const line = out.lines.find((l) => l.id === order.lines[0].id);
  assert.equal(toDecimalString(fromDb(line.materials_cost_snapshot)), "9.45");
  assert.equal(line.cost_status, "complete");
});

await test("completing twice does not take the stock twice", async () => {
  /* The retry. A phone on a bad connection sends the same request again, and
     the kitchen must not lose a second portion of everything. */
  const order = await seedOrder();
  const first = await transaction((c) =>
    completeOrder(c, { businessId: BIZ, orderId: order.id, consumption: consumptionFor(order) }));
  const second = await transaction((c) =>
    completeOrder(c, { businessId: BIZ, orderId: order.id, consumption: consumptionFor(order) }));

  assert.equal(first.already, false);
  assert.equal(second.already, true, "the second is told it was already done");
  assert.equal(second.order.version, first.order.version, "and nothing moved");
  assert.equal((await movementsFor(order.id)).length, 2, "one deduction, not two");
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await test("the second request waits for the first, and is told it lost", async () => {
  /* The lock, tested deterministically.

     Firing two completions with `Promise.all` does not do it. Every statement
     is a round trip to a database in another region, so the first transaction
     finishes before the second has read anything, and the test passes whether
     or not `FOR UPDATE` is there — which was true of the version this
     replaced. A mutation run proved it: removing the lock changed nothing.

     So the interleaving is forced instead. The first transaction takes the
     lock and is held open. The second is started and must not get past its
     SELECT. Only when the first commits may it proceed, and what it must find
     then is a completed order — not a fresh one to complete again. */
  const order = await seedOrder();
  const first = await db().connect();
  const second = await db().connect();
  let secondFinished = false;

  try {
    await first.query("BEGIN");
    const won = await completeOrder(first, {
      businessId: BIZ, orderId: order.id, consumption: consumptionFor(order),
    });
    assert.equal(won.already, false, "the first one completes it");

    await second.query("BEGIN");
    let pending;
    pending = completeOrder(second, {
      businessId: BIZ, orderId: order.id, consumption: consumptionFor(order),
    }).then((r) => { secondFinished = true; return r; });

    await sleep(500);
    assert.equal(secondFinished, false, "the second is still waiting on the lock");

    await first.query("COMMIT");
    const lost = await pending;
    await second.query("COMMIT");

    /* The assertion the lock is actually for. Without it the second read
       "new" before the first committed, posted its own stock, and returned a
       completion of its own. */
    assert.equal(lost.already, true, "and is handed the completed order");
    assert.equal(lost.order.version, won.order.version, "the same one, not a second");
    assert.equal((await movementsFor(order.id)).length, 2, "the stock moved once");
  } finally {
    /* The waiting call has to be let go of before anything else touches these
       rows. An assertion failing above leaves it blocked on a lock this
       transaction still holds, and the cleanup at the end of the file would
       then block behind it — which is how a failed run of this file once left
       rows in the database. Rolling back first releases it; awaiting it stops
       the process exiting with a query still in flight. */
    try { await first.query("ROLLBACK"); } catch { /* already committed */ }
    try { await pending; } catch { /* it was only ever there to be waited on */ }
    try { await second.query("ROLLBACK"); } catch { /* already committed */ }
    first.release();
    second.release();
  }
});

await test("a stale version is a conflict, not a silent overwrite", async () => {
  const order = await seedOrder();
  const out = await transaction((c) =>
    completeOrder(c, { businessId: BIZ, orderId: order.id, expectedVersion: 99, consumption: [] }));
  assert.equal(out.error, "conflict");
  assert.equal(out.version, 1, "and says what the version actually is");
  assert.equal((await movementsFor(order.id)).length, 0, "nothing was posted");
});

await test("a cancelled order cannot be completed", async () => {
  const order = await seedOrder();
  await transaction((c) =>
    transitionOrder(c, { businessId: BIZ, orderId: order.id, to: "cancelled" }));

  const out = await transaction((c) =>
    completeOrder(c, { businessId: BIZ, orderId: order.id, consumption: consumptionFor(order) }));
  assert.equal(out.error, "transition");
  assert.equal((await movementsFor(order.id)).length, 0);
});

await test("a missing cost makes the line incomplete, never free", async () => {
  /* §6: if an ingredient is unlinked or has no cost, the line's cost is null
     and incomplete. Zero would be a claim that the dish cost nothing to make,
     and every margin above it would be flattering by an unknown amount. */
  const order = await seedOrder();
  const out = await transaction((c) => completeOrder(c, {
    businessId: BIZ,
    orderId: order.id,
    consumption: [
      { orderLineId: order.lines[0].id, ingredientId: "beef", branchId: "b1", qtyBase: "300", costPerBase: "0.03" },
      { orderLineId: order.lines[0].id, ingredientId: "mystery", branchId: "b1", qtyBase: "10", costPerBase: null },
    ],
  }));

  const line = out.lines[0];
  assert.equal(line.materials_cost_snapshot, null, "null, not 9.00 and not 0");
  assert.equal(line.cost_status, "incomplete");
  assert.equal(out.incompleteLines, 1, "and the caller is told without having to look");

  /* The stock still moved. The ingredient left the kitchen whether or not
     anybody knows what it cost. */
  assert.equal((await movementsFor(order.id)).length, 2);
});

await test("a provisional cost is carried, not quietly promoted", async () => {
  const order = await seedOrder();
  const out = await transaction((c) => completeOrder(c, {
    businessId: BIZ,
    orderId: order.id,
    consumption: consumptionFor(order, { provisional: true }),
  }));
  assert.equal(out.lines[0].cost_status, "provisional");
  assert.equal(out.provisionalLines, 1);
});

await test("a sale is refused into a drawer somebody has already counted", async () => {
  const shift = await db().query(
    `INSERT INTO pos_shifts (business_id, cashier_id, closed_at, counted_cash)
     VALUES ($1,'sam', now(), '500.00') RETURNING id`, [BIZ]);
  const order = await seedOrder({ shiftId: shift.rows[0].id });

  const out = await transaction((c) =>
    completeOrder(c, { businessId: BIZ, orderId: order.id, consumption: consumptionFor(order) }));
  /* Posting into a closed shift changes a figure that has been reconciled and
     signed off. */
  assert.equal(out.error, "shiftclosed");
  assert.equal((await movementsFor(order.id)).length, 0);
});

await test("a failure part way through leaves nothing behind", async () => {
  const order = await seedOrder();
  await assert.rejects(transaction(async (c) => {
    await completeOrder(c, { businessId: BIZ, orderId: order.id, consumption: consumptionFor(order) });
    throw new Error("something later went wrong");
  }));

  /* The whole point of the storage decision: the sale and the stock are one
     commit, so a failure after them undoes both rather than leaving a
     deduction with no sale. */
  assert.equal((await movementsFor(order.id)).length, 0, "the stock came back");
  const still = await db().query("SELECT fulfillment_status FROM orders WHERE id = $1", [order.id]);
  assert.equal(still.rows[0].fulfillment_status, "new", "and the order was never completed");
});

await test("another business cannot complete this one's order", async () => {
  const order = await seedOrder();
  const other = crypto.randomUUID();
  const out = await transaction(async (c) => {
    await ensureBusiness(c, other);
    return completeOrder(c, { businessId: other, orderId: order.id, consumption: [] });
  });
  /* Not "forbidden" — it does not exist, as far as they are concerned. */
  assert.equal(out.error, "notfound");
  await db().query("DELETE FROM businesses WHERE id = $1", [other]);
});

/* ── Leave the database as it was found ─────────────────────────────────── */

try {
  await db().query("DELETE FROM inventory_movements WHERE business_id = $1", [BIZ]);
  await db().query("DELETE FROM orders WHERE business_id = $1", [BIZ]);
  await db().query("DELETE FROM pos_shifts WHERE business_id = $1", [BIZ]);
  await db().query("DELETE FROM businesses WHERE id = $1", [BIZ]);

  const left = await db().query(
    "SELECT count(*)::int n FROM orders WHERE business_id = $1", [BIZ]);
  if (left.rows[0].n !== 0) {
    failures += 1;
    console.error("  FAIL cleanup left rows behind");
  }
} catch (err) {
  failures += 1;
  console.error("  FAIL cleanup:", err.message);
} finally {
  await close();
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
