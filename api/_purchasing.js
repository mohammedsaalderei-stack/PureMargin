/* Purchasing and receiving — stage 4, phase 4.

   This is where cost enters the system. Everything downstream — valuation,
   theoretical vs actual, margin — is arithmetic on numbers that arrive here, so
   the module's job is to record what was actually ordered, actually delivered,
   and actually charged, and to keep those three separate.

   That separation is the whole design. An order is an intention; a receipt is an
   event; an invoice is a claim about money. Collapsing them loses exactly the
   information the document asks for — quantity variance (ordered vs delivered)
   and price variance (agreed vs invoiced) — because both are differences between
   two records that a simpler model would have overwritten with one.

   Decisions worth keeping:

   1. **Receiving is additive and repeatable.** A purchase order is received in as
      many partial receipts as reality needs, each one writing its own `receive`
      movements. Nothing is ever "marked received" as a status change alone.
   2. **Discounts and charges are allocated pro rata by line value**, so the cost
      landed on stock is what the business actually paid per kilo, not the sticker
      price. A delivery fee spread across a delivery is real cost; leaving it out
      understates food cost and overstates margin.
   3. **Over-receipt is refused, with the remaining quantity in the error.** A
      keying slip that receives 100 kg against a 10 kg order is not a variance to
      analyse later, it is a typo to reject now.
   4. **A return is a movement, not an edit.** Returning to a supplier writes
      `return_out` at the cost the goods came in at, and the order remembers it.

   Isolation follows the rest of stage 4: org id in the key, branch id on the
   record, and the route resolves both from the session. */

import { getJSON, setJSON } from "./_store.js";
import { getIngredient, listSuppliers } from "./_inventory.js";
import { recordMovement, baseUnitOf } from "./_movements.js";
import { convert, isUnit, sameDimension } from "./_units.js";

const ORDERS = (orgId) => `inv:${orgId}:purchases`;

/* draft → open → partial → received, plus the two ends an order can stop at.
   `partial` is a real state rather than a computed hint: a buyer chasing a
   supplier needs to see at a glance which orders are still owed. */
export const ORDER_STATUSES = ["draft", "open", "partial", "received", "cancelled"];

/* An order that has been sent to a supplier and isn't finished yet. */
const RECEIVABLE = new Set(["open", "partial"]);

let counter = 0;
const nextId = (prefix) =>
  `${prefix}${Date.now().toString(36)}${(counter = (counter + 1) % 1e4).toString(36).padStart(3, "0")}`;

const round = (n, places = 6) => Number(n.toFixed(places));

async function readAll(orgId) {
  return (await getJSON(ORDERS(orgId))) || {};
}

async function write(orgId, order) {
  const map = await readAll(orgId);
  map[order.id] = order;
  await setJSON(ORDERS(orgId), map);
  return order;
}

/* ── Order lines ──────────────────────────────────────────── */

/* Validated against the ingredient master, not trusted from the body: a price
   per unit is meaningless unless the unit measures the same thing the ingredient
   is stocked in. Returns field names; the interface owns the wording. */
async function buildLines(orgId, inputs) {
  if (!Array.isArray(inputs) || !inputs.length) return { error: "nolines" };

  const lines = [];
  for (const input of inputs) {
    const ingredient = await getIngredient(orgId, String(input.ingredientId || ""));
    if (!ingredient) return { error: "ingredientId" };
    if (lines.some((l) => l.ingredientId === ingredient.id)) return { error: "duplicate" };

    const qty = Number(input.qty);
    if (!Number.isFinite(qty) || qty <= 0) return { error: "qty" };

    /* Ordering happens in the purchase unit — a case, a sack — which is rarely
       the stock unit. Either is accepted so long as they measure the same thing. */
    const unit = input.unit || ingredient.purchaseUnit || ingredient.stockUnit;
    if (!isUnit(unit) || !sameDimension(unit, ingredient.stockUnit)) return { error: "unit" };

    const unitPrice = Number(input.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "unitPrice" };

    const baseUnit = baseUnitOf(ingredient);
    lines.push({
      ingredientId: ingredient.id,
      name: ingredient.name,
      stockUnit: ingredient.stockUnit,
      baseUnit,
      /* Ordered, as agreed with the supplier. Never changed by receiving — the
         difference between this and what arrived is the quantity variance. */
      qty,
      unit,
      qtyBase: convert(qty, unit, baseUnit),
      unitPrice,
      /* Per base unit, so a price agreed per sack can be compared with a price
         invoiced per kilo without either side doing mental arithmetic. */
      pricePerBase: unitPrice / convert(1, unit, baseUnit),
      /* Filled in by receipts and returns. */
      receivedBase: 0,
      returnedBase: 0,
    });
  }
  return { lines };
}

/* ── Creating and editing an order ────────────────────────── */

export async function saveOrder(orgId, branchId, input = {}) {
  if (!branchId) return { error: "branchId" };

  const built = await buildLines(orgId, input.lines);
  if (built.error) return { error: built.error };

  const suppliers = await listSuppliers(orgId);
  const supplierId = String(input.supplierId || "").trim();
  const supplier = suppliers.find((s) => s.id === supplierId);
  if (supplierId && !supplier) return { error: "supplierId" };

  const existing = input.id ? (await readAll(orgId))[String(input.id)] : null;
  if (input.id && !existing) return { error: "notfound" };
  /* Only a draft can be rewritten. Once an order is with the supplier, changing
     what it says would erase the agreement the variance is measured against. */
  if (existing && existing.status !== "draft") return { error: "notdraft" };

  const order = {
    id: existing?.id || nextId("po"),
    branchId: existing?.branchId || branchId,
    status: "draft",
    supplierId,
    /* Denormalised on purpose: an order is a historical document, and a supplier
       renamed next year must not silently rewrite what last year's said. */
    supplierName: supplier?.name || String(input.supplierName || "").trim(),
    reference: String(input.reference || "").trim(),
    expectedAt: Number(input.expectedAt) > 0 ? Number(input.expectedAt) : null,
    notes: String(input.notes || "").trim(),
    createdAt: existing?.createdAt || Date.now(),
    createdBy: existing?.createdBy || String(input.actor || ""),
    updatedAt: Date.now(),
    submittedAt: existing?.submittedAt || null,
    submittedBy: existing?.submittedBy || null,
    cancelledAt: null, cancelledBy: null, cancelReason: "",
    lines: built.lines,
    receipts: existing?.receipts || [],
  };

  return { order: await write(orgId, order), created: !existing };
}

/* Sent to the supplier. From here the lines are frozen and receiving can start. */
export async function submitOrder(orgId, id, { actor } = {}) {
  const map = await readAll(orgId);
  const order = map[id];
  if (!order) return { error: "notfound" };
  if (order.status !== "draft") return { error: "notdraft" };

  order.status = "open";
  order.submittedAt = Date.now();
  order.submittedBy = String(actor || "");
  return { order: await write(orgId, order) };
}

/* Cancelling is only honest while nothing has arrived. Once part of an order is
   on the shelf, the order is a record of something that happened. */
export async function cancelOrder(orgId, id, { actor, reason } = {}) {
  const map = await readAll(orgId);
  const order = map[id];
  if (!order) return { error: "notfound" };
  if (order.receipts.length) return { error: "received" };
  if (order.status === "cancelled") return { error: "cancelled" };

  order.status = "cancelled";
  order.cancelledAt = Date.now();
  order.cancelledBy = String(actor || "");
  order.cancelReason = String(reason || "").trim();
  return { order: await write(orgId, order) };
}

/* ── Receiving ────────────────────────────────────────────── */

const outstandingBase = (line) => line.qtyBase - line.receivedBase;

/* An order is fully received when no line is still owed. Returns deliberately do
   not reopen it: the goods arrived and went back, which is a different event from
   never having arrived. */
function statusAfterReceipt(order) {
  const anything = order.lines.some((l) => l.receivedBase > 1e-9);
  const complete = order.lines.every((l) => outstandingBase(l) <= 1e-9);
  if (complete) return "received";
  return anything ? "partial" : "open";
}

/* Records a delivery: one `receive` movement per line, at the cost actually
   landed on stock.

   `discount` and `charges` are the invoice's totals for the whole delivery —
   trade discount off, freight and handling on — and are allocated across the
   lines in proportion to their value. Pro rata by value rather than by weight or
   by line count: a delivery fee on a load that is nine tenths beef by value
   belongs mostly to the beef, and spreading it evenly would flatter the beef's
   cost and punish the parsley's.

   Movements are written first and their ids kept on the receipt. If one is
   refused the receipt is abandoned before anything is stored, so a rejected
   delivery cannot leave half its lines on the shelf. */
export async function receiveOrder(orgId, id, input = {}) {
  const map = await readAll(orgId);
  const order = map[id];
  if (!order) return { error: "notfound" };
  if (!RECEIVABLE.has(order.status)) return { error: "notopen" };
  if (!Array.isArray(input.lines) || !input.lines.length) return { error: "nolines" };

  const discount = Number(input.discount) > 0 ? Number(input.discount) : 0;
  const charges = Number(input.charges) > 0 ? Number(input.charges) : 0;

  /* First pass: validate everything and work out each line's value, before a
     single movement is written. */
  const prepared = [];
  for (const entry of input.lines) {
    const line = order.lines.find((l) => l.ingredientId === String(entry.ingredientId || ""));
    if (!line) return { error: "ingredientId" };
    if (prepared.some((p) => p.line === line)) return { error: "duplicate" };

    const qty = Number(entry.qty);
    if (!Number.isFinite(qty) || qty <= 0) return { error: "qty" };

    /* A delivery can be measured differently from the order — 20 kg loose
       against 2 sacks ordered — so long as it measures the same thing. */
    const unit = entry.unit || line.unit;
    if (!isUnit(unit) || !sameDimension(unit, line.stockUnit)) return { error: "unit" };

    const qtyBase = convert(qty, unit, line.baseUnit);
    /* Refused rather than recorded: over-receipt at this scale is a typo, and the
       remaining quantity goes back so the interface can say what was expected. */
    if (qtyBase - outstandingBase(line) > 1e-9) {
      return {
        error: "over",
        ingredientId: line.ingredientId,
        remaining: convert(outstandingBase(line), line.baseUnit, line.unit),
        unit: line.unit,
      };
    }

    /* The invoiced price. Defaults to the agreed price, which is the common case
       and saves retyping it on every line. */
    const unitPrice = entry.unitPrice === undefined || entry.unitPrice === ""
      ? line.unitPrice * (convert(1, unit, line.baseUnit) / convert(1, line.unit, line.baseUnit))
      : Number(entry.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: "unitPrice" };

    prepared.push({ line, qty, unit, qtyBase, unitPrice, value: qty * unitPrice });
  }

  const goodsTotal = prepared.reduce((sum, p) => sum + p.value, 0);
  const netAdjustment = charges - discount;

  const receipt = {
    id: nextId("gr"),
    at: Date.now(),
    by: String(input.actor || ""),
    /* The invoice this delivery was billed on — the link the document asks for
       between a stock movement and the paperwork behind it. */
    invoiceNo: String(input.invoiceNo || "").trim(),
    invoiceDate: Number(input.invoiceDate) > 0 ? Number(input.invoiceDate) : null,
    note: String(input.note || "").trim(),
    discount, charges,
    goodsTotal: round(goodsTotal, 2),
    /* What the delivery actually cost, which is what the invoice should say. */
    invoiceTotal: round(goodsTotal + netAdjustment, 2),
    lines: [],
  };

  for (const p of prepared) {
    /* Zero-value goods (a free case, a sample) can't take a share of an
       allocation by value, and forcing one would divide by nothing. */
    const share = goodsTotal > 0 ? (p.value / goodsTotal) * netAdjustment : 0;
    const effectiveUnitCost = p.unitPrice + share / p.qty;

    const pricePerBase = p.unitPrice / convert(1, p.unit, p.line.baseUnit);
    /* Agreed against invoiced, per base unit so the comparison survives a
       different unit on the delivery note. Positive means it cost more. */
    const priceVarianceValue = (pricePerBase - p.line.pricePerBase) * p.qtyBase;

    const out = await recordMovement(orgId, order.branchId, {
      ingredientId: p.line.ingredientId,
      type: "receive",
      qty: p.qty,
      unit: p.unit,
      /* Landed cost, not sticker price: allocations are part of what the
         business paid for the goods. */
      unitCost: effectiveUnitCost,
      reason: "purchase",
      note: receipt.invoiceNo ? `invoice ${receipt.invoiceNo}` : "",
      ref: `po:${order.id}`,
      actor: input.actor,
    });
    /* Receiving adds stock, so the negative-stock policy can't refuse it; any
       error here is a validation fault worth surfacing rather than swallowing. */
    if (out.error) return { error: out.error };

    receipt.lines.push({
      ingredientId: p.line.ingredientId,
      name: p.line.name,
      qty: p.qty,
      unit: p.unit,
      qtyBase: p.qtyBase,
      unitPrice: p.unitPrice,
      orderedUnitPrice: p.line.unitPrice,
      orderedUnit: p.line.unit,
      allocated: round(share, 4),
      effectiveUnitCost: round(effectiveUnitCost, 6),
      priceVarianceValue: round(priceVarianceValue, 4),
      movementId: out.movement.id,
    });

    p.line.receivedBase = round(p.line.receivedBase + p.qtyBase);
  }

  order.receipts.push(receipt);
  order.status = statusAfterReceipt(order);
  order.updatedAt = Date.now();

  return { order: await write(orgId, order), receipt };
}

/* ── Returns ──────────────────────────────────────────────── */

/* Sent back to the supplier. Written as a `return_out` movement at the cost the
   goods came in at — valuing a return at today's price would turn a rejected
   delivery into a phantom profit or loss. */
export async function returnToSupplier(orgId, id, input = {}) {
  const map = await readAll(orgId);
  const order = map[id];
  if (!order) return { error: "notfound" };
  if (!order.receipts.length) return { error: "nothingreceived" };

  const line = order.lines.find((l) => l.ingredientId === String(input.ingredientId || ""));
  if (!line) return { error: "ingredientId" };

  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) return { error: "qty" };

  const unit = input.unit || line.unit;
  if (!isUnit(unit) || !sameDimension(unit, line.stockUnit)) return { error: "unit" };

  const qtyBase = convert(qty, unit, line.baseUnit);
  const heldBase = line.receivedBase - line.returnedBase;
  /* You cannot return more than arrived. */
  if (qtyBase - heldBase > 1e-9) {
    return {
      error: "overreturn",
      remaining: convert(heldBase, line.baseUnit, line.unit),
      unit: line.unit,
    };
  }

  /* The cost this ingredient last came in at on this order. */
  const received = order.receipts
    .flatMap((r) => r.lines.map((l) => ({ ...l, at: r.at })))
    .filter((l) => l.ingredientId === line.ingredientId)
    .sort((a, b) => b.at - a.at)[0];

  const ingredient = await getIngredient(orgId, line.ingredientId);
  if (!ingredient) return { error: "ingredientId" };

  const costPerBase = received.effectiveUnitCost / convert(1, received.unit, line.baseUnit);

  const out = await recordMovement(orgId, order.branchId, {
    ingredientId: line.ingredientId,
    type: "return_out",
    qty,
    unit,
    unitCost: costPerBase * convert(1, unit, line.baseUnit),
    reason: String(input.reason || "").trim() || "supplier return",
    note: String(input.note || "").trim(),
    ref: `po:${order.id}`,
    actor: input.actor,
  });
  if (out.error) return out;

  line.returnedBase = round(line.returnedBase + qtyBase);
  order.returns = order.returns || [];
  order.returns.push({
    id: nextId("rt"),
    at: Date.now(),
    by: String(input.actor || ""),
    ingredientId: line.ingredientId,
    name: line.name,
    qty, unit, qtyBase,
    value: round(costPerBase * qtyBase, 4),
    reason: String(input.reason || "").trim(),
    movementId: out.movement.id,
  });
  order.updatedAt = Date.now();

  return { order: await write(orgId, order), movementId: out.movement.id };
}

/* ── Reading ──────────────────────────────────────────────── */

/* The figures a buyer and an accountant argue over, derived rather than stored so
   they can never drift from the lines and receipts they come from. */
export function summarise(order) {
  const orderedValue = order.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const receiptLines = order.receipts.flatMap((r) => r.lines);

  const receivedValue = order.receipts.reduce((sum, r) => sum + r.invoiceTotal, 0);
  const priceVarianceValue = receiptLines.reduce((sum, l) => sum + l.priceVarianceValue, 0);
  const allocated = receiptLines.reduce((sum, l) => sum + l.allocated, 0);
  const returnedValue = (order.returns || []).reduce((sum, r) => sum + r.value, 0);

  return {
    orderedValue: round(orderedValue, 2),
    /* What the invoices total, allocations included — the cost that actually
       landed on stock. */
    receivedValue: round(receivedValue, 2),
    /* Agreed price against invoiced price. Positive means the delivery cost more
       than the order said it would. */
    priceVarianceValue: round(priceVarianceValue, 2),
    /* Discounts and charges spread onto stock cost, kept visible because it is
       the part of food cost an invoice hides in its footer. */
    allocatedValue: round(allocated, 2),
    returnedValue: round(returnedValue, 2),
    /* Still owed by the supplier, per line, in the unit the order was placed in. */
    outstanding: order.lines
      .filter((l) => outstandingBase(l) > 1e-9)
      .map((l) => ({
        ingredientId: l.ingredientId,
        name: l.name,
        qty: round(convert(outstandingBase(l), l.baseUnit, l.unit), 4),
        unit: l.unit,
      })),
    fullyReceived: order.lines.every((l) => outstandingBase(l) <= 1e-9),
  };
}

export async function getOrder(orgId, id) {
  const order = (await readAll(orgId))[String(id || "")] || null;
  return order ? { ...order, summary: summarise(order) } : null;
}

/* Orders across the branches the caller may see, newest first. Thin rows: a
   buyer picks from this list, and the lines only matter for the one they open. */
export async function listOrders(orgId, branchIds, { status } = {}) {
  const allowed = new Set(branchIds.map(String));
  return Object.values(await readAll(orgId))
    .filter((o) => allowed.has(String(o.branchId)))
    .filter((o) => !status || o.status === status)
    .sort((a, b) => (b.createdAt - a.createdAt) || b.id.localeCompare(a.id))
    .map(({ lines, receipts, returns, ...rest }) => ({
      ...rest,
      lineCount: lines.length,
      receiptCount: receipts.length,
      summary: summarise({ lines, receipts, returns }),
    }));
}
