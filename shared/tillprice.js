/* What a register sale comes to — the arithmetic alone.

   Kept apart from `api/_till.js`, outside `api/`, with no imports, so the same code runs in two
   places: on the server, which decides what a sale costs, and on a till that
   has lost its connection, which has to print the customer a receipt now and
   send the sale when it is back. Two copies of this arithmetic would drift,
   and a receipt in a customer's hand that disagrees with the books by a fils
   is a receipt nobody can explain. One copy cannot disagree with itself.

   Nothing here touches storage, the network or the clock beyond what it is
   given. */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const text = (v, max) => String(v ?? "").trim().slice(0, max);

export const DEFAULT_VAT_PCT = 5;
const MAX_LINES = 100;
const MAX_QTY = 999;
const MAX_PRICE = 100000;
/* The register's own branch id, for a business with no POS stores. */
const REGISTER_BRANCH_ID = "register";

export const ORDER_TYPES = ["dine_in", "takeaway", "car", "delivery"];
export const PAYMENT_TYPES = ["cash", "card"];
/* What a payment type is underneath its name. Cash opens the drawer and is
   counted at the end of the shift; the others are recorded and reconciled
   elsewhere — a card machine, a delivery app's statement. */
export const PAYMENT_KINDS = ["cash", "card", "other"];
export const DEFAULT_PAYMENT_TYPES = [
  { id: "cash", name: "Cash", kind: "cash" },
  { id: "card", name: "Card", kind: "card" },
];
/* Whether the prices on the menu already include VAT. In the UAE a menu is
   usually printed with VAT in; a supplier price list usually without. */
export const VAT_MODES = ["exclusive", "inclusive"];

/* VAT is a rate, between none and anything a government has actually set. */
export function readVat(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 50) return { error: "vat" };
  return { vatPct: round2(n) };
}

/* A receipt number no till issues. Time first so they sort, then a few
   random characters so two tills in the same second still differ. */
export function receiptNumber(at, random = Math.random) {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
    + `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  const tail = Math.floor(random() * 36 ** 3).toString(36).toUpperCase().padStart(3, "0");
  return `PM-${stamp}-${tail}`;
}

/* A discount as the register states it: a preset by id, or a percentage or
   an amount typed in. What it comes to is worked out here against the money
   it applies to, so a client cannot send a discount larger than the bill. */
export function readDiscount(raw, presets = []) {
  if (!raw) return null;
  if (raw.id) {
    const preset = presets.find((d) => d.id === String(raw.id));
    if (!preset) return { error: "discount" };
    return { id: preset.id, name: preset.name, type: preset.type, value: preset.value, restricted: Boolean(preset.restricted) };
  }
  const type = raw.type === "amount" ? "amount" : raw.type === "pct" ? "pct" : null;
  const value = Number(raw.value);
  if (!type || !Number.isFinite(value) || value <= 0) return { error: "discount" };
  if (type === "pct" && value > 100) return { error: "discount" };
  if (type === "amount" && value > MAX_PRICE) return { error: "discount" };
  return { id: "", name: text(raw.name, 40) || "", type, value: round2(value), custom: true };
}

const discountOn = (d, money) => round2(Math.min(money, d.type === "pct" ? (money * d.value) / 100 : d.value));

export function buildSale(input, {
  catalogue, vatPct = DEFAULT_VAT_PCT, branchId, at = Date.now(), number, cashier = "",
  vatMode = "exclusive", paymentTypes = DEFAULT_PAYMENT_TYPES, discounts = [],
  loyaltyPct = 0, pointsBalance = 0, employeeId = "", shiftId = "", clientId = "",
}) {
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  if (!lines.length) return { error: "empty" };
  if (lines.length > MAX_LINES) return { error: "toomany", limit: MAX_LINES };

  const orderType = ORDER_TYPES.includes(input?.orderType) ? input.orderType : null;
  if (!orderType) return { error: "ordertype" };
  const table = orderType === "dine_in" ? text(input?.table, 10) : "";

  const byId = new Map((catalogue || []).map((item) => [item.id, item]));
  const lineItems = [];
  const used = [];
  let subtotal = 0;

  for (const raw of lines) {
    const item = byId.get(String(raw?.itemId ?? ""));
    if (!item) return { error: "item", itemId: raw?.itemId ?? null };

    /* An item sold in sizes or flavours is sold as one of them, never as the
       item alone, and the one chosen sets the price. A variant may be its own
       recipe (`recipeId`, a "Latte · Large" written on the Recipes screen),
       or the item's recipe or stock scaled (`scale`, a large fries being 1.5
       portions). */
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const variant = variants.length ? variants.find((v) => v.id === String(raw?.variantId ?? "")) : null;
    if (variants.length && !variant) return { error: "variant", item: item.name };
    const basePrice = variant ? variant.price : item.price;
    if (!(Number(basePrice) > 0)) return { error: "noprice", item: variant ? `${item.name} · ${variant.name}` : item.name };
    const scale = variant && !variant.recipeId && Number(variant.scale) > 0 ? Number(variant.scale) : 1;
    const qty = Number(raw?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { error: "qty", item: item.name };

    const wanted = Array.isArray(raw?.addons) ? raw.addons.map(String) : [];
    const offered = new Map((item.addons || []).map((a) => [a.id, a]));
    const chosen = [];
    for (const id of wanted) {
      const addon = offered.get(id);
      if (!addon) return { error: "addon", item: item.name, addonId: id };
      chosen.push(addon);
    }

    const unit = round2(Number(basePrice) + chosen.reduce((sum, a) => sum + a.price, 0));
    const gross = round2(unit * qty);
    const lineDiscount = readDiscount(raw?.discount, discounts);
    if (lineDiscount?.error) return { error: "discount", item: item.name };
    const lineOff = lineDiscount ? discountOn(lineDiscount, gross) : 0;
    if (lineDiscount) used.push({ ...lineDiscount, scope: "item", money_amount: lineOff, item: item.name });
    subtotal = round2(subtotal + gross);
    const addonCost = chosen.some((a) => a.cost !== null)
      ? round2(chosen.reduce((sum, a) => sum + (a.cost || 0), 0) * qty)
      : null;

    lineItems.push({
      /* The recipe, by id, where the till would put its catalogue id. Stock
         depletion matches by this first and by the dish name after. A product
         sold as it comes has no recipe, and says so in its id. */
      item_id: item.kind === "product" ? `product:${item.id}` : `recipe:${variant?.recipeId || item.id}`,
      variant_id: variant?.id || "",
      item_name: item.name,
      variant_name: variant?.name || "",
      ...(scale !== 1 ? { variant_scale: scale } : {}),
      /* A product sold as it comes, linked to a stock item: what one of it
         takes off the shelf. Written on the receipt at the time of sale, so
         changing the link later does not rewrite what past sales drew. */
      ...(item.kind === "product" && item.stock?.ingredientId && Number(item.stock.qty) > 0
        ? { stock_draw: [{ ingredientId: item.stock.ingredientId, qty: Math.round(Number(item.stock.qty) * scale * 1e6) / 1e6, unit: item.stock.unit }] }
        : {}),
      quantity: qty,
      price: unit,
      gross_total_money: gross,
      total_discount: lineOff,
      total_money: round2(gross - lineOff),
      note: text(raw?.note, 120) || undefined,
      line_modifiers: chosen.map((a) => ({ id: a.id, name: a.name, price: a.price, cost: a.cost })),
      /* What the add-ons cost the business, for this line. Not the dish's own
         cost, which comes from its recipe like any sale's. */
      addon_cost: addonCost,
      ...(item.kind === "product" && item.cost !== null && item.cost !== undefined
        ? { cost: round2(item.cost * scale * qty) } : {}),
    });
  }

  /* The whole-ticket discount, then any loyalty points, each spread over the
     lines in proportion to what is left on them, so an item report still adds
     up to the takings. */
  const spread = (amount) => {
    const base = lineItems.reduce((sum, li) => sum + li.total_money, 0);
    if (!(amount > 0) || !(base > 0)) return 0;
    let given = 0;
    lineItems.forEach((li, i) => {
      const share = i === lineItems.length - 1
        ? round2(amount - given)
        : round2((amount * li.total_money) / base);
      li.total_discount = round2(li.total_discount + share);
      li.total_money = round2(li.total_money - share);
      given = round2(given + share);
    });
    return amount;
  };

  const ticketDiscount = readDiscount(input?.discount, discounts);
  if (ticketDiscount?.error) return { error: "discount" };
  if (ticketDiscount) {
    const remaining = lineItems.reduce((sum, li) => sum + li.total_money, 0);
    const off = discountOn(ticketDiscount, round2(remaining));
    spread(off);
    used.push({ ...ticketDiscount, scope: "ticket", money_amount: off });
  }

  const pointsWanted = Number(input?.redeemPoints) || 0;
  let pointsRedeemed = 0;
  if (pointsWanted > 0) {
    if (pointsWanted > pointsBalance + 0.001) return { error: "points", balance: round2(pointsBalance) };
    const remaining = round2(lineItems.reduce((sum, li) => sum + li.total_money, 0));
    pointsRedeemed = round2(Math.min(pointsWanted, remaining));
    spread(pointsRedeemed);
    used.push({ id: "points", name: "Points", type: "amount", value: pointsRedeemed, scope: "ticket", money_amount: pointsRedeemed });
  }

  const net = round2(lineItems.reduce((sum, li) => sum + li.total_money, 0));
  const totalDiscount = round2(subtotal - net);
  const rate = readVat(vatPct).error ? DEFAULT_VAT_PCT : Number(vatPct);
  const inclusive = vatMode === "inclusive";
  const tax = inclusive ? round2(net - net / (1 + rate / 100)) : round2((net * rate) / 100);
  const totalMoney = inclusive ? net : round2(net + tax);

  /* Payments: one or several, each against a payment type the business has.
     The old single `payment` is still read, so a till running last week's
     screen keeps selling. */
  const types = new Map((paymentTypes || DEFAULT_PAYMENT_TYPES).map((p) => [p.id, p]));
  const asked = Array.isArray(input?.payments) && input.payments.length
    ? input.payments
    : input?.payment ? [input.payment] : [];
  if (!asked.length) return { error: "payment" };
  if (asked.length > 6) return { error: "payment" };
  const payments = [];
  let paid = 0;
  for (const [i, raw] of asked.entries()) {
    const kind = types.get(String(raw?.type ?? ""));
    if (!kind) return { error: "payment" };
    const last = i === asked.length - 1;
    const amountRaw = raw?.amount;
    const amount = amountRaw === undefined || amountRaw === null || amountRaw === ""
      ? (last ? round2(totalMoney - paid) : NaN)
      : round2(amountRaw);
    if (!Number.isFinite(amount) || amount < 0) return { error: "payment" };
    let received = amount;
    if (kind.kind === "cash" && raw.received !== undefined && raw.received !== null && raw.received !== "") {
      received = round2(raw.received);
      if (!Number.isFinite(received) || received < amount) return { error: "short", total: amount };
    }
    paid = round2(paid + amount);
    payments.push({
      type: kind.kind === "cash" ? "CASH" : kind.kind === "card" ? "CARD" : "OTHER",
      /* The name the dashboard groups payments by, as a till would call it. */
      name: kind.name,
      payment_type_id: kind.id,
      money_amount: amount,
      received,
      change: kind.kind === "cash" ? round2(received - amount) : 0,
    });
  }
  if (Math.abs(paid - totalMoney) > 0.009) return { error: "split", total: totalMoney, paid };

  const pointsEarned = Number(loyaltyPct) > 0 && input?.customerId
    ? Math.floor((totalMoney * Number(loyaltyPct))) / 100
    : 0;

  const iso = new Date(at).toISOString();
  const id = number || receiptNumber(at);
  return {
    receipt: {
      id,
      receipt_number: id,
      receipt_type: "SALE",
      source: "register",
      receipt_date: iso,
      created_at: iso,
      store_id: String(branchId || REGISTER_BRANCH_ID),
      order_type: orderType,
      table: table || null,
      ticket_name: text(input?.ticketName, 40) || null,
      note: text(input?.note, 200) || null,
      cashier: text(cashier, 60),
      employee_id: text(employeeId, 60) || null,
      shift_id: text(shiftId, 60) || null,
      client_id: text(clientId, 80) || null,
      customer_id: text(input?.customerId, 60) || null,
      vat_pct: rate,
      vat_mode: inclusive ? "inclusive" : "exclusive",
      subtotal_money: subtotal,
      total_discount: totalDiscount,
      discounts: used,
      total_tax: tax,
      total_money: totalMoney,
      points_earned: pointsEarned,
      points_redeemed: pointsRedeemed,
      line_items: lineItems,
      payments,
    },
  };
}

/* A refund: some or all of a sale's lines, given back.

   Written as its own receipt — `REFUND`, pointing at the sale through
   `refund_for` — because that is the shape every report already subtracts,
   and the sale itself is never changed. What each line is worth comes from
   the sale, after its discounts, so a refunded discounted item gives back
   what was actually paid for it. A line cannot be refunded twice over:
   `already` is what earlier refunds of this sale gave back, per line. */
export function buildRefund(sale, { lines, at = Date.now(), number, reason = "", cashier = "", employeeId = "", shiftId = "", already = {}, paymentType = null, paymentTypes = DEFAULT_PAYMENT_TYPES }) {
  if (!sale || sale.receipt_type !== "SALE") return { error: "receipt" };
  const wanted = Array.isArray(lines) ? lines : [];
  if (!wanted.length) return { error: "empty" };

  const out = [];
  let net = 0;
  for (const raw of wanted) {
    const index = Number(raw?.index);
    const li = sale.line_items?.[index];
    if (!li) return { error: "line", index };
    const qty = Number(raw?.qty);
    const left = Number(li.quantity) - (Number(already[index]) || 0);
    if (!Number.isInteger(qty) || qty < 1) return { error: "qty", index };
    if (qty > left) return { error: "over", index, left };
    const money = round2((Number(li.total_money) * qty) / Number(li.quantity));
    net = round2(net + money);
    out.push({ ...li, line_index: index, quantity: qty, total_money: money,
      total_discount: round2((Number(li.total_discount || 0) * qty) / Number(li.quantity)),
      gross_total_money: round2((Number(li.gross_total_money ?? li.total_money) * qty) / Number(li.quantity)) });
  }

  const saleNet = (sale.line_items || []).reduce((sum, li) => sum + Number(li.total_money), 0);
  const share = saleNet > 0 ? net / saleNet : 0;
  const tax = round2(Number(sale.total_tax || 0) * share);
  const total = sale.vat_mode === "inclusive" ? net : round2(net + tax);

  const types = new Map((paymentTypes || DEFAULT_PAYMENT_TYPES).map((p) => [p.id, p]));
  const originalType = sale.payments?.[0]?.payment_type_id || (sale.payments?.[0]?.type === "CASH" ? "cash" : "card");
  const kind = types.get(String(paymentType || originalType)) || types.get("cash") || DEFAULT_PAYMENT_TYPES[0];

  const iso = new Date(at).toISOString();
  const id = number || receiptNumber(at);
  return {
    receipt: {
      id,
      receipt_number: id,
      receipt_type: "REFUND",
      refund_for: sale.receipt_number,
      source: "register",
      receipt_date: iso,
      created_at: iso,
      store_id: sale.store_id,
      order_type: sale.order_type,
      reason: text(reason, 200) || null,
      cashier: text(cashier, 60),
      employee_id: text(employeeId, 60) || null,
      shift_id: text(shiftId, 60) || null,
      customer_id: sale.customer_id || null,
      vat_pct: sale.vat_pct,
      vat_mode: sale.vat_mode || "exclusive",
      subtotal_money: net,
      total_discount: round2(out.reduce((sum, li) => sum + li.total_discount, 0)),
      total_tax: tax,
      total_money: total,
      /* Points earned on what came back are taken back with it. */
      points_earned: -Math.floor(Number(sale.points_earned || 0) * share * 100) / 100,
      points_redeemed: 0,
      line_items: out,
      payments: [{
        type: kind.kind === "cash" ? "CASH" : kind.kind === "card" ? "CARD" : "OTHER",
        name: kind.name,
        payment_type_id: kind.id,
        money_amount: total,
        received: total,
        change: 0,
      }],
    },
  };
}
