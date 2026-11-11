/* A sale that was made with no connection, arriving afterwards.

   It has already happened. The customer has paid, has a receipt with a
   number on it, and has left. So the one thing the server may not do with it
   is refuse it, or record something other than what was charged — and both
   used to be possible:

     · the business counts its drawer by shift, and none was open on the
       server when the sale arrived: refused, and parked on the device where
       nobody would look;
     · a price was changed, or a dish archived, while the till was offline:
       refused — or, worse, rebuilt at the new price, so the books said 20
       for a sale the customer paid 18 for, and nothing anywhere showed it.

   So a sale replayed from a till's queue (`offline: true`) carries the
   receipt the till built and printed. The server still prices the sale
   itself, from its own menu, and uses its own receipt whenever that comes to
   what the till charged — the ordinary case, and nothing is trusted. Only
   when the server cannot rebuild it, or would get a different total, is the
   till's receipt the one recorded: checked for its own arithmetic, stripped
   to the fields a receipt has, stamped by the server with who, where and
   when, and marked (`price_source: "till"`, `review`) and audit-logged, so
   every such sale can be found and looked at. `review` is a list of reasons
   from `REVIEW_REASONS`, never a sentence: the register words them, in the
   reader's language. A discount on it that is not
   one of the business's presets is flagged for a manager rather than
   blocked, for the same reason: it was already given.

   This is the one place a price in a request is read at all. It is read
   only for a sale that says it was made offline, only when the server's own
   figure disagrees, and never silently. */

import { ORDER_TYPES } from "../shared/tillprice.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const money = (v, max = 1000000) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? round2(n) : null;
};
const near = (a, b, tol = 0.03) => Math.abs(Number(a) - Number(b)) <= tol;
const MAX_LINES = 100;

/* Why a sale made offline is marked for somebody to look at. */
export const REVIEW_REASONS = ["total", "rebuild", "discount"];

/* The till's receipt, as a receipt and nothing more — or null when it does
   not add up. */
export function readTillReceipt(raw, { presets = [] } = {}) {
  if (!raw || typeof raw !== "object" || raw.receipt_type !== "SALE") return null;
  const lines = Array.isArray(raw.line_items) ? raw.line_items : [];
  if (!lines.length || lines.length > MAX_LINES) return null;
  const orderType = ORDER_TYPES.includes(raw.order_type) ? raw.order_type : null;
  if (!orderType) return null;

  const lineItems = [];
  for (const li of lines) {
    const qty = Number(li?.quantity);
    const price = money(li?.price, 100000);
    const gross = money(li?.gross_total_money);
    const off = money(li?.total_discount ?? 0);
    const total = money(li?.total_money);
    const name = text(li?.item_name, 80);
    if (!name || !Number.isInteger(qty) || qty < 1 || qty > 999) return null;
    if (price === null || gross === null || off === null || total === null) return null;
    /* (A discount larger than the line would leave a negative total, which
       `money` has already turned away.) */
    if (!near(gross, price * qty) || !near(total, gross - off)) return null;
    const mods = Array.isArray(li.line_modifiers) ? li.line_modifiers.slice(0, 20) : [];
    const draw = Array.isArray(li.stock_draw) ? li.stock_draw.slice(0, 3) : [];
    lineItems.push({
      item_id: text(li.item_id, 80),
      variant_id: text(li.variant_id, 60),
      item_name: name,
      variant_name: text(li.variant_name, 40),
      ...(Number(li.variant_scale) > 0 && Number(li.variant_scale) <= 20 && Number(li.variant_scale) !== 1 ? { variant_scale: Number(li.variant_scale) } : {}),
      ...(draw.length ? { stock_draw: draw.map((d) => ({ ingredientId: text(d?.ingredientId, 80), qty: money(d?.qty, 100000) || 0, unit: text(d?.unit, 10) })).filter((d) => d.ingredientId && d.qty > 0) } : {}),
      quantity: qty,
      price,
      gross_total_money: gross,
      total_discount: off,
      total_money: total,
      note: text(li.note, 120) || undefined,
      line_modifiers: mods.map((m) => ({ id: text(m?.id, 60), name: text(m?.name, 40), price: money(m?.price, 100000) || 0, cost: m?.cost === null || m?.cost === undefined ? null : money(m.cost, 100000) })),
      addon_cost: li.addon_cost === null || li.addon_cost === undefined ? null : money(li.addon_cost),
      ...(Number(li.cost) > 0 ? { cost: money(li.cost) } : {}),
    });
  }

  const subtotal = round2(lineItems.reduce((s, li) => s + li.gross_total_money, 0));
  const net = round2(lineItems.reduce((s, li) => s + li.total_money, 0));
  const rate = Number(raw.vat_pct);
  if (!Number.isFinite(rate) || rate < 0 || rate > 50) return null;
  const inclusive = raw.vat_mode === "inclusive";
  const tax = inclusive ? round2(net - net / (1 + rate / 100)) : round2((net * rate) / 100);
  const total = inclusive ? net : round2(net + tax);
  if (!near(raw.total_money, total) || !near(raw.total_tax, tax)) return null;

  const paid = Array.isArray(raw.payments) ? raw.payments : [];
  if (!paid.length || paid.length > 6) return null;
  const payments = [];
  for (const p of paid) {
    const amount = money(p?.money_amount);
    if (amount === null) return null;
    const type = ["CASH", "CARD", "OTHER"].includes(p?.type) ? p.type : "OTHER";
    payments.push({
      type, name: text(p.name, 40) || type, payment_type_id: text(p.payment_type_id, 40),
      money_amount: amount, received: money(p.received) ?? amount, change: money(p.change) ?? 0,
    });
  }
  if (!near(payments.reduce((s, p) => s + p.money_amount, 0), total)) return null;

  /* A discount is the business's own only when it is one of its presets,
     exactly. Anything else was typed in, and typing one in is a manager's. */
  const known = new Map(presets.map((d) => [d.id, d]));
  const discounts = (Array.isArray(raw.discounts) ? raw.discounts.slice(0, 20) : []).map((d) => {
    const preset = d?.id ? known.get(String(d.id)) : null;
    const same = preset && preset.type === d.type && Number(preset.value) === Number(d.value);
    return {
      id: text(d?.id, 40), name: text(d?.name, 40), type: d?.type === "amount" ? "amount" : "pct",
      value: money(d?.value, 100000) || 0, scope: d?.scope === "item" ? "item" : "ticket",
      money_amount: money(d?.money_amount) || 0, ...(d?.item ? { item: text(d.item, 80) } : {}),
      /* That includes one calling itself points: none are spent offline. */
      ...(same ? (preset.restricted ? { restricted: true } : {}) : { custom: true }),
    };
  });

  return {
    receipt_type: "SALE",
    order_type: orderType,
    table: orderType === "dine_in" ? text(raw.table, 10) || null : null,
    ticket_name: text(raw.ticket_name, 40) || null,
    note: text(raw.note, 200) || null,
    customer_id: text(raw.customer_id, 60) || null,
    vat_pct: rate,
    vat_mode: inclusive ? "inclusive" : "exclusive",
    subtotal_money: subtotal,
    total_discount: round2(subtotal - net),
    discounts,
    total_tax: tax,
    total_money: total,
    /* Points are not spent offline, and what a sale earns is the business's
       rate at most. */
    points_earned: 0,
    points_redeemed: 0,
    line_items: lineItems,
    payments,
  };
}

/* Which receipt to record for a sale replayed from a till: the server's own
   when it agrees with what was charged, the till's when it does not.

   `menuTotal` is what the menu as it stands would charge for the same order
   with the payments left out of it (null when it cannot be priced at all).
   It is what tells a changed price from a vanished dish: the till sends the
   money that was tendered, to the fil, so after a price rise the server's
   own attempt does not come out dearer — it fails, as underpaid, exactly as
   it does when an item has gone. Without this every changed price was
   reported as "something on it is no longer on the menu". */
export function reconcileOffline(built, tillRaw, { presets = [], loyaltyPct = 0, hasCustomer = false, menuTotal = null } = {}) {
  const till = readTillReceipt(tillRaw, { presets });
  if (!till) return built.error ? { error: built.error, detail: built } : { receipt: built.receipt, from: "server" };
  if (!built.error && near(built.receipt.total_money, till.total_money, 0.011)) return { receipt: built.receipt, from: "server" };
  const earned = Number(loyaltyPct) > 0 && hasCustomer ? Math.floor(till.total_money * Number(loyaltyPct)) / 100 : 0;
  const serverTotal = !built.error ? built.receipt.total_money : menuTotal;
  const differs = serverTotal !== null && Number.isFinite(Number(serverTotal)) && !near(serverTotal, till.total_money, 0.011);
  return {
    receipt: { ...till, points_earned: earned },
    from: "till",
    why: differs ? "total" : "rebuild",
    serverTotal: differs ? round2(serverTotal) : null,
  };
}
