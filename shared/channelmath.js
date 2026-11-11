/* What a sale is worth on a given sales channel — the arithmetic alone.

   The same dish sold at the counter, on a delivery app and through the
   restaurant's own drivers leaves three different amounts behind, because
   each channel takes something different: a commission, a card fee, an
   advertising charge, a fixed fee, the cost of the delivery, a discount the
   restaurant funds. This works out what is left, and the price that would
   leave what the counter leaves.

   Outside `api/` and with no imports, like `tillprice.js`, so the screen and
   the server run one copy: a price the calculator recommends is the price the
   order's own economics will confirm.

   ── The terms, since every one of them is a place to be wrong ────────────

     listed     what the menu says, times quantity. Includes VAT when the
                business's prices do (`vatMode: "inclusive"`).
     discount   what the restaurant itself knocks off. A discount the platform
                pays for never enters: it does not reduce what the restaurant
                is owed.
     subtotal   listed less discount, without VAT. This is the sale. VAT is
                collected for the tax authority and is never revenue.
     fees       commission + payment fee + advertising + fixed fees, the VAT
                the platform adds to those, and what the delivery costs.
     net        subtotal − fees. What reaches the restaurant before food cost.
     profit     net − recipe cost. Contribution: nothing here allocates rent
                or wages to an order.

   Every fee that is a percentage is linear in the price, so the price that
   reaches a target profit is found from two evaluations rather than from a
   formula that would have to be rewritten each time a fee is added. */

export const CHANNEL_TYPES = ["in_store", "pickup", "website", "direct", "aggregator", "own_delivery", "custom"];
export const FEE_BASES = ["subtotal", "subtotal_plus_tax", "gross_total"];
export const AD_MODELS = ["none", "percent", "monthly_fixed", "per_order_fixed"];
export const DISCOUNT_MODELS = ["none", "percent", "fixed"];
export const IN_STORE_ID = "in-store";

/* The channels a restaurant is likely to have. Fees are deliberately absent:
   a commission is whatever that restaurant's contract says, and a default
   rate would be a number that looks read off a contract and was not. */
export const CHANNEL_PRESETS = [
  { key: "in_store", type: "in_store", name: "In-store" },
  { key: "pickup", type: "pickup", name: "Pickup" },
  { key: "website", type: "website", name: "Website" },
  { key: "whatsapp", type: "direct", name: "WhatsApp / direct" },
  { key: "talabat", type: "aggregator", name: "Talabat" },
  { key: "deliveroo", type: "aggregator", name: "Deliveroo" },
  { key: "careem", type: "aggregator", name: "Careem Food" },
  { key: "keeta", type: "aggregator", name: "Keeta" },
  { key: "noon", type: "aggregator", name: "Noon Food" },
  { key: "own_delivery", type: "own_delivery", name: "Own delivery" },
];

export const EMPTY_RULE = {
  commissionPct: 0,
  commissionBase: "subtotal",
  paymentFeePct: 0,
  paymentFeeBase: "subtotal_plus_tax",
  fixedOrderFee: 0,
  fixedItemFee: 0,
  advertisingModel: "none",
  advertisingPct: 0,
  advertisingMonthly: 0,
  advertisingPerOrder: 0,
  expectedMonthlyOrders: 0,
  discountModel: "none",
  merchantDiscountPct: 0,
  merchantDiscountFixed: 0,
  deliveryCostPerOrder: 0,
  vatOnPlatformFeePct: 0,
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));

/* A fee rule as typed, checked. Returns the field that is wrong rather than
   a sentence, so the screen can say it in the reader's language. */
export function readRule(raw = {}) {
  const pct = (key, max = 100) => {
    const v = raw[key] === "" || raw[key] === undefined || raw[key] === null ? 0 : Number(raw[key]);
    return Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 1000) / 1000 : null;
  };
  const money = (key) => {
    const v = raw[key] === "" || raw[key] === undefined || raw[key] === null ? 0 : Number(raw[key]);
    return Number.isFinite(v) && v >= 0 && v <= 1000000 ? round2(v) : null;
  };
  const rule = {};
  for (const key of ["commissionPct", "paymentFeePct", "advertisingPct", "merchantDiscountPct", "vatOnPlatformFeePct"]) {
    rule[key] = pct(key);
    if (rule[key] === null) return { error: key };
  }
  for (const key of ["fixedOrderFee", "fixedItemFee", "advertisingMonthly", "advertisingPerOrder", "merchantDiscountFixed", "deliveryCostPerOrder"]) {
    rule[key] = money(key);
    if (rule[key] === null) return { error: key };
  }
  rule.commissionBase = FEE_BASES.includes(raw.commissionBase) ? raw.commissionBase : EMPTY_RULE.commissionBase;
  rule.paymentFeeBase = FEE_BASES.includes(raw.paymentFeeBase) ? raw.paymentFeeBase : EMPTY_RULE.paymentFeeBase;
  rule.advertisingModel = AD_MODELS.includes(raw.advertisingModel) ? raw.advertisingModel : "none";
  rule.discountModel = DISCOUNT_MODELS.includes(raw.discountModel) ? raw.discountModel : "none";
  const orders = raw.expectedMonthlyOrders === "" || raw.expectedMonthlyOrders === undefined ? 0 : Number(raw.expectedMonthlyOrders);
  if (!Number.isFinite(orders) || orders < 0 || orders > 1000000) return { error: "expectedMonthlyOrders" };
  rule.expectedMonthlyOrders = Math.round(orders);
  /* A monthly advertising bill can only be put against an order by dividing
     it by how many orders it buys, so that number is asked for, not assumed. */
  if (rule.advertisingModel === "monthly_fixed" && rule.advertisingMonthly > 0 && !(rule.expectedMonthlyOrders > 0)) {
    return { error: "expectedMonthlyOrders" };
  }
  /* All the percentage fees together must leave something of the sale. */
  if (rule.commissionPct + rule.paymentFeePct + (rule.advertisingModel === "percent" ? rule.advertisingPct : 0) >= 100) {
    return { error: "commissionPct" };
  }
  if (raw.validFrom !== undefined && raw.validFrom !== "" && !isDay(raw.validFrom)) return { error: "validFrom" };
  if (raw.validTo && !isDay(raw.validTo)) return { error: "validTo" };
  if (raw.validTo && raw.validFrom && raw.validTo < raw.validFrom) return { error: "validTo" };
  return { rule };
}

/* The rule in force on a day, for a branch.

   A rule written for one branch outranks one written for all of them; after
   that the one that started most recently; after that the one written most
   recently, which is how a typo is corrected without editing history — the
   mistaken rule stays on file, outranked. */
export function ruleAt(rules, day, branchId = null) {
  const live = (rules || []).filter((r) => r.validFrom <= day && (!r.validTo || r.validTo >= day)
    && (!r.branchId || String(r.branchId) === String(branchId || "")));
  live.sort((a, b) => (Number(Boolean(b.branchId)) - Number(Boolean(a.branchId)))
    || (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0)
    || ((b.createdAt || 0) - (a.createdAt || 0)));
  return live[0] || null;
}

/* The standing discount a rule describes, against a listed amount. */
export function ruleDiscount(rule, listed, orderShare = 1) {
  if (!rule || rule.discountModel === "none") return 0;
  if (rule.discountModel === "percent") return (listed * num(rule.merchantDiscountPct)) / 100;
  return Math.min(listed, num(rule.merchantDiscountFixed) * orderShare);
}

/* Unrounded, so a price can be solved for without rounding in the way. */
function raw({ lines, rule, vatPct = 0, vatMode = "exclusive", discount = 0, orderShare = 1 }) {
  const r = { ...EMPTY_RULE, ...(rule || {}) };
  const v = Math.max(0, num(vatPct)) / 100;
  const exVat = (x) => (vatMode === "inclusive" ? x / (1 + v) : x);

  const listed = (lines || []).reduce((s, l) => s + num(l.price) * num(l.qty), 0);
  const units = (lines || []).reduce((s, l) => s + num(l.qty), 0);
  const off = Math.max(0, Math.min(listed, num(discount)));
  const subtotal = exVat(listed - off);
  const tax = subtotal * v;
  const grossListed = exVat(listed) * (1 + v);
  const baseOf = (key) => (key === "gross_total" ? grossListed : key === "subtotal_plus_tax" ? subtotal + tax : subtotal);

  const commissionBase = baseOf(r.commissionBase);
  const commission = (commissionBase * num(r.commissionPct)) / 100;
  const paymentBase = baseOf(r.paymentFeeBase);
  const paymentFee = (paymentBase * num(r.paymentFeePct)) / 100;
  const advertising = r.advertisingModel === "percent" ? (subtotal * num(r.advertisingPct)) / 100
    : r.advertisingModel === "per_order_fixed" ? num(r.advertisingPerOrder) * orderShare
      : r.advertisingModel === "monthly_fixed" && num(r.expectedMonthlyOrders) > 0
        ? (num(r.advertisingMonthly) / num(r.expectedMonthlyOrders)) * orderShare
        : 0;
  const fixedFees = num(r.fixedOrderFee) * orderShare + num(r.fixedItemFee) * units;
  const platformFees = commission + paymentFee + advertising + fixedFees;
  const vatOnFees = (platformFees * num(r.vatOnPlatformFeePct)) / 100;
  const deliveryCost = num(r.deliveryCostPerOrder) * orderShare;
  const channelFees = platformFees + vatOnFees + deliveryCost;
  const merchantDiscount = exVat(off);
  const netRevenue = subtotal - channelFees;

  const known = (lines || []).filter((l) => l.recipeCost !== null && l.recipeCost !== undefined);
  const recipeCost = known.reduce((s, l) => s + num(l.recipeCost) * num(l.qty), 0);
  const costComplete = known.length === (lines || []).length;
  const contribution = netRevenue - recipeCost;

  return {
    listed, units, subtotal, tax, merchantDiscount, commissionBase, commission, paymentBase, paymentFee,
    advertising, fixedFees, vatOnFees, deliveryCost, channelFees,
    channelCost: channelFees + merchantDiscount, netRevenue, recipeCost, costComplete, contribution,
    marginPct: subtotal > 0 ? (contribution / subtotal) * 100 : null,
  };
}

const rounded = (e) => Object.fromEntries(Object.entries(e).map(([k, val]) => [k,
  typeof val === "number" ? (k === "marginPct" ? Math.round(val * 10) / 10 : k === "units" ? val : round2(val)) : val]));

/* What an order came to on its channel.

   `lines` are `{ price, qty, recipeCost }` with the price as listed and the
   recipe cost per unit, null when nobody knows it — in which case the profit
   is an upper bound and `costComplete` says so. `discount` is what the
   restaurant took off, on the same VAT basis as the prices. */
export function orderEconomics(input) {
  return rounded(raw(input));
}

/* One unit of one item, as part of an order of `itemsPerOrder` things: the
   charges that fall once per order are shared between them. With the default
   of one, the item carries every per-order charge alone — the cautious case. */
export function itemEconomics({ price, recipeCost = null, rule, vatPct = 0, vatMode = "exclusive", itemsPerOrder = 1, applyDiscount = true }) {
  const orderShare = 1 / Math.max(1, num(itemsPerOrder) || 1);
  const discount = applyDiscount ? ruleDiscount(rule, num(price), orderShare) : 0;
  return rounded(raw({ lines: [{ price, qty: 1, recipeCost }], rule, vatPct, vatMode, discount, orderShare }));
}

/* The listed price at which one unit leaves `target` behind, or null when no
   price can — the percentage fees take the whole sale, or the cost is unknown.

   `absorbPct` is the share of the commission the restaurant chooses to carry
   itself instead of passing on: the price is solved as though the commission
   were that much smaller, so the profit at it falls short of the target by
   exactly what was absorbed. */
export function priceFor({ target, recipeCost, rule, vatPct = 0, vatMode = "exclusive", itemsPerOrder = 1, applyDiscount = true, absorbPct = 0 }) {
  if (recipeCost === null || recipeCost === undefined || !Number.isFinite(Number(target))) return null;
  const r = { ...EMPTY_RULE, ...(rule || {}) };
  const solveWith = { ...r, commissionPct: num(r.commissionPct) * (1 - Math.max(0, Math.min(100, num(absorbPct))) / 100) };
  const orderShare = 1 / Math.max(1, num(itemsPerOrder) || 1);
  const at = (price) => raw({
    lines: [{ price, qty: 1, recipeCost }], rule: solveWith, vatPct, vatMode, orderShare,
    discount: applyDiscount ? ruleDiscount(solveWith, price, orderShare) : 0,
  }).contribution;
  /* Two points well clear of any fixed discount, where the line is straight. */
  const p1 = 1000;
  const p2 = 2000;
  const f1 = at(p1);
  const slope = (at(p2) - f1) / (p2 - p1);
  if (!(slope > 1e-9)) return null;
  const price = p1 + (Number(target) - f1) / slope;
  return price > 0 ? round2(price) : null;
}

/* green: the price leaves the target. orange: it makes money, less than the
   target. red: it loses money, or leaves less than the margin the business
   said it will not go below. */
export function statusOf({ contribution, marginPct, target, minMarginPct = 0 }) {
  if (!(contribution > 0)) return "red";
  if (marginPct !== null && marginPct !== undefined && marginPct < num(minMarginPct)) return "red";
  if (target === null || target === undefined || contribution >= Number(target) - 0.005) return "green";
  return "orange";
}

/* Everything the comparison shows for one item on one channel. `inStore` is
   the item's economics at the counter, which is the profit to preserve. */
export function compareItem({ price, inStorePrice, recipeCost, rule, inStoreRule, vatPct = 0, vatMode = "exclusive", itemsPerOrder = 1, minMarginPct = 0, target = null }) {
  const inStore = itemEconomics({ price: inStorePrice, recipeCost, rule: inStoreRule, vatPct, vatMode });
  const goal = target === null || target === undefined ? inStore.contribution : Number(target);
  const here = itemEconomics({ price, recipeCost, rule, vatPct, vatMode, itemsPerOrder });
  const known = recipeCost !== null && recipeCost !== undefined;
  const recommended = known ? priceFor({ target: goal, recipeCost, rule, vatPct, vatMode, itemsPerOrder }) : null;
  const breakEven = known ? priceFor({ target: 0, recipeCost, rule, vatPct, vatMode, itemsPerOrder }) : null;
  return {
    ...here,
    target: known ? round2(goal) : null,
    recommended,
    breakEven,
    status: known ? statusOf({ contribution: here.contribution, marginPct: here.marginPct, target: goal, minMarginPct }) : "unknown",
    inStoreContribution: known ? inStore.contribution : null,
  };
}

/* The key a price is filed under: the item, and its variant when it has one. */
export const itemKeyOf = (itemId, variantId = "") => (variantId ? `${itemId}::${variantId}` : String(itemId));
