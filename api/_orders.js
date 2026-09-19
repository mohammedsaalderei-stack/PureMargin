import { ensureBusiness } from "./_db.js";

/* The order lifecycle, and the one operation the whole storage move was for.
   Appendix A of the specification is `complete_order`; this is it.

   ── Why completion is the hard one ───────────────────────────────────────

   Everything else in an order's life changes one row. Completion recognises a
   sale, snapshots what it cost, and takes the food out of stock — three
   writes that have to happen together or not at all. A sale recorded with no
   deduction overstates the shelf for ever; a deduction with no sale
   understates it and nobody can say why. The Redis store could not offer a
   commit spanning them, which is the entire reason this table lives in
   Postgres.

   ── Locking ──────────────────────────────────────────────────────────────

   The order row is locked FOR UPDATE, and that lock is what makes completion
   idempotent under concurrency rather than merely idempotent-looking. Two
   requests arriving together do not both read "not completed": the first takes
   the lock and commits, the second blocks until it does, then reads the
   completed row and returns that result. §9 asks for exactly this — one
   committed effect, the other request receiving the current state.

   Appendix A also says to lock the affected inventory rows in a stable order.
   That instruction assumes stored stock levels, and there are none here:
   balances are derived by summing an append-only ledger, which this codebase
   has done since the beginning. Appending needs no lock at all.

   It is worth being precise about when that stops being true. `_movements.js`
   has a `allowNegative` guard that reads the ledger, sums it, and refuses a
   movement that would drive the balance below zero — a read-then-write, and
   two concurrent ones can both see "five left" and both take three. That path
   needs a `pg_advisory_xact_lock` per ingredient, taken in sorted order so two
   transactions touching the same pair cannot deadlock.

   Completion deliberately does not take that path. §6 allows negative-stock
   sales with a documented provisional cost, and refusing to record a meal that
   has already left the kitchen would be the wrong answer to a stock figure
   being wrong. So a sale may drive stock negative, and says so.

   ── Arithmetic happens in the database ───────────────────────────────────

   A cost per base unit is routinely smaller than the smallest coin: flour at
   3.00/kg is 0.003 per gram. Converting that to minor units would round it to
   zero and every dish made of flour would cost nothing.

   So the multiply is not done in JavaScript. The quantities and unit costs go
   to Postgres as NUMERIC, the line total is summed there exactly, and only the
   result — which is a real amount of money — comes back to be read through
   `_money.js`. One rounding, at the end, on a number big enough to round. */

export const OPEN_STATES = ["new", "preparing", "ready"];

const ALLOWED = {
  new: ["preparing", "ready", "completed", "cancelled"],
  preparing: ["ready", "completed", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const canTransition = (from, to) => (ALLOWED[from] || []).includes(to);

/* ── Creating one ────────────────────────────────────────────────────────

   Prices are the caller's, and §7 is explicit that the server computes them
   rather than trusting a client. That resolution belongs in the route with the
   catalogue; what arrives here is already priced, and is snapshotted as given
   so a later price change cannot rewrite it. */
export async function createOrder(client, {
  businessId, source = "puremargin", externalOrderId = null, channel = "dine_in",
  branchId = null, tableReference = null, shiftId = null, currency = "AED",
  scheduledAt = null, lines = [],
}) {
  await ensureBusiness(client, businessId);

  const order = await client.query(
    `INSERT INTO orders
       (business_id, source, external_order_id, channel, branch_id,
        table_reference, shift_id, currency, scheduled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, version, fulfillment_status, payment_status`,
    [businessId, source, externalOrderId, channel, branchId,
      tableReference, shiftId, currency, scheduledAt],
  );
  const orderId = order.rows[0].id;

  const saved = [];
  for (const line of lines) {
    const row = await client.query(
      `INSERT INTO order_lines
         (business_id, order_id, variant_id, item_name, quantity,
          price_snapshot, discount_allocated, tax_amount, recipe_version, cost_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'incomplete')
       RETURNING id, item_name, quantity`,
      [businessId, orderId, line.variantId ?? null, line.itemName,
        String(line.quantity), String(line.priceSnapshot),
        String(line.discountAllocated ?? "0"), String(line.taxAmount ?? "0"),
        line.recipeVersion ?? null],
    );
    saved.push(row.rows[0]);
  }

  return { ...order.rows[0], id: orderId, lines: saved };
}

/* ── Moving it along ─────────────────────────────────────────────────────

   Everything except completion, which has its own function because it does
   far more than change a word. */
export async function transitionOrder(client, { businessId, orderId, to, expectedVersion }) {
  if (to === "completed") {
    return { error: "usecomplete" };
  }

  const found = await client.query(
    `SELECT id, version, fulfillment_status FROM orders
      WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [orderId, businessId],
  );
  if (found.rowCount === 0) return { error: "notfound" };

  const order = found.rows[0];
  if (expectedVersion !== undefined && Number(expectedVersion) !== order.version) {
    return { error: "conflict", version: order.version, status: order.fulfillment_status };
  }
  if (!canTransition(order.fulfillment_status, to)) {
    return { error: "transition", from: order.fulfillment_status, to };
  }

  const out = await client.query(
    `UPDATE orders
        SET fulfillment_status = $3, version = version + 1, updated_at = now()
      WHERE id = $1 AND business_id = $2
      RETURNING id, version, fulfillment_status`,
    [orderId, businessId, to],
  );
  return { order: out.rows[0] };
}

/* ── Completion ──────────────────────────────────────────────────────────

   `consumption` is what the recipes resolved to, worked out by the caller
   before the transaction opens. Recipes live in Redis and cannot join this
   transaction whatever order things happen in, so resolving inside it would
   buy nothing — and `recipe_version` is snapshotted on the line, so which
   version was used stays answerable either way.

   Each entry:
     { orderLineId, ingredientId, branchId, qtyBase, costPerBase, provisional }

   `costPerBase` null means this ingredient has no cost basis — an unlinked
   item, or one nothing has ever been bought. §6 is emphatic: the line's cost
   becomes null and incomplete. Never zero. Zero is a claim that it was free,
   and a margin built on it is flattering by an unknown amount. */
export async function completeOrder(client, {
  businessId, orderId, expectedVersion, actor = "", consumption = [], now = null,
}) {
  /* The lock. Everything below reads a row nobody else can change until this
     transaction ends, which is what makes the idempotency real. */
  const found = await client.query(
    `SELECT id, version, fulfillment_status, completed_at, shift_id, currency
       FROM orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [orderId, businessId],
  );
  if (found.rowCount === 0) return { error: "notfound" };
  const order = found.rows[0];

  /* Already done, by a retry or by whoever won the race. The recorded result
     is returned rather than an error: from the caller's side it did work, and
     §9 asks for the current state rather than a failure. */
  if (order.fulfillment_status === "completed") {
    const lines = await client.query(
      `SELECT id, materials_cost_snapshot, cost_status FROM order_lines
        WHERE order_id = $1 AND business_id = $2 ORDER BY created_at`,
      [orderId, businessId],
    );
    return {
      already: true,
      order: { id: order.id, version: order.version, completedAt: order.completed_at },
      lines: lines.rows,
    };
  }

  if (expectedVersion !== undefined && Number(expectedVersion) !== order.version) {
    return { error: "conflict", version: order.version, status: order.fulfillment_status };
  }
  if (!canTransition(order.fulfillment_status, "completed")) {
    return { error: "transition", from: order.fulfillment_status, to: "completed" };
  }

  /* A sale cannot be posted into a drawer that has been counted and closed —
     it would change a figure somebody has already reconciled and signed off. */
  if (order.shift_id) {
    const shift = await client.query(
      "SELECT closed_at FROM pos_shifts WHERE id = $1 AND business_id = $2",
      [order.shift_id, businessId],
    );
    if (shift.rowCount === 0) return { error: "noshift" };
    if (shift.rows[0].closed_at) return { error: "shiftclosed" };
  }

  const at = now ? new Date(now).toISOString() : null;

  /* ── The stock, out once ──────────────────────────────────────────────

     Negative quantities, reason 'sale', carrying the order id so every
     deduction can be traced back to what caused it. Sorted by ingredient so
     the write order is deterministic — not needed for correctness while this
     is a pure append, and the thing to keep if a non-negative guard is ever
     added here, since that is the order those locks would have to be taken
     in. */
  const sorted = [...consumption].sort((a, b) =>
    String(a.ingredientId).localeCompare(String(b.ingredientId)));

  for (const part of sorted) {
    if (!(Number(part.qtyBase) > 0)) continue;
    await client.query(
      `INSERT INTO inventory_movements
         (business_id, branch_id, ingredient_id, quantity_signed,
          unit_cost_snapshot, reason, source_id, occurred_at)
       VALUES ($1,$2,$3, -$4::numeric, $5, 'sale', $6, COALESCE($7::timestamptz, now()))`,
      [businessId, part.branchId ?? null, part.ingredientId, String(part.qtyBase),
        part.costPerBase === null || part.costPerBase === undefined
          ? null : String(part.costPerBase),
        orderId, at],
    );
  }

  /* ── What it cost, computed in NUMERIC ────────────────────────────────

     One statement. The quantities and unit costs are multiplied and summed by
     Postgres at full precision, a line with any missing cost comes back null
     rather than short, and the result lands on the line as a snapshot that
     nothing later recalculates. */
  let costed = [];
  if (consumption.length > 0) {
    const values = [];
    const params = [businessId];
    for (const part of consumption) {
      const base = params.length;
      params.push(part.orderLineId, String(part.qtyBase),
        part.costPerBase === null || part.costPerBase === undefined
          ? null : String(part.costPerBase),
        Boolean(part.provisional));
      values.push(`($${base + 1}::uuid, $${base + 2}::numeric, $${base + 3}::numeric, $${base + 4}::boolean)`);
    }

    const out = await client.query(
      `WITH parts(line_id, qty, cost_per, provisional) AS (VALUES ${values.join(", ")}),
            totals AS (
              SELECT line_id,
                     bool_or(cost_per IS NULL) AS missing,
                     bool_or(provisional)      AS provisional,
                     sum(qty * cost_per)       AS cost
                FROM parts GROUP BY line_id)
       UPDATE order_lines ol
          SET materials_cost_snapshot = CASE WHEN t.missing THEN NULL ELSE t.cost END,
              cost_status = CASE WHEN t.missing     THEN 'incomplete'
                                 WHEN t.provisional THEN 'provisional'
                                 ELSE 'complete' END
         FROM totals t
        WHERE ol.id = t.line_id AND ol.business_id = $1
        RETURNING ol.id, ol.materials_cost_snapshot, ol.cost_status`,
      params,
    );
    costed = out.rows;
  }

  const done = await client.query(
    `UPDATE orders
        SET fulfillment_status = 'completed',
            completed_at = COALESCE($3::timestamptz, now()),
            version = version + 1,
            updated_at = now()
      WHERE id = $1 AND business_id = $2
      RETURNING id, version, completed_at`,
    [orderId, businessId, at],
  );

  return {
    already: false,
    order: {
      id: done.rows[0].id,
      version: done.rows[0].version,
      completedAt: done.rows[0].completed_at,
    },
    lines: costed,
    /* What the caller needs to know without going and looking: whether this
       order's cost is trustworthy. A margin built on incomplete lines is an
       upper bound, and saying so is the difference between a number and a
       number somebody can act on. */
    incompleteLines: costed.filter((l) => l.cost_status === "incomplete").length,
    provisionalLines: costed.filter((l) => l.cost_status === "provisional").length,
    actor,
  };
}
