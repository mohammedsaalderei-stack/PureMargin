/* The register: selling through PureMargin itself.

   Products are the business's own recipes — every dish with a selling price is
   a button — so a sale is costed and depletes stock without anybody pairing a
   till item to a recipe first. Add-ons carry a price and an internal cost of
   their own, so the margin on "extra cheese" is known too.

   A sale is stored as a receipt in the shape the POS already uses (Loyverse:
   `line_items`, `payments`, `store_id`, `total_money`), because everything
   downstream of a sale — the dashboard, the sales list, variance, the purchase
   plan, the assistant — reads that shape. Written in it, a register sale is
   simply another receipt and needs no second copy of any report. Its number
   starts with `PM-`, which no till issues, so it can never be counted as one
   of the till's own.

   Each receipt is its own key: `register:<org>:r:<YYYY-MM>:<number>`. One
   shared list per day would be read, appended to and written back by every
   till, and two sales at the same moment would leave only one of them. The
   month in the key lets a reporting window be read back with one query per
   month (`listJSON`).

   Prices are never taken from the request. The client says which dish, how
   many and which add-ons; the price, the add-on prices, the VAT and the total
   are all worked out here from the catalogue. Payment is recorded, not taken:
   the card goes through whatever card machine the business already has. */

import { getJSON, setJSON, listJSON } from "./_store.js";
import { listRecipes } from "./_recipes.js";
import { REGISTER_BRANCH, REGISTER_WINDOW_DAYS, branchList } from "./_data.js";
import { posTokenFor } from "./_accounts.js";
import { orgFor } from "./_org.js";

export { REGISTER_BRANCH };
export const ORDER_TYPES = ["dine_in", "takeaway", "car"];
export const PAYMENT_TYPES = ["cash", "card"];
export const DEFAULT_VAT_PCT = 5;

const MAX_LINES = 100;
const MAX_QTY = 999;
const MAX_ADDONS = 20;
const MAX_PRICE = 100000;
const DAY = 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const text = (v, max) => String(v ?? "").trim().slice(0, max);

const settingsKey = (orgId) => `register:${orgId}:settings`;
const receiptPrefix = (orgId, month) => `register:${orgId}:r:${month}:`;

/* The month a receipt is filed under, from its own timestamp. */
export const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);

/* Every month a window touches, oldest first. */
export function monthsBetween(sinceMs, nowMs) {
  const out = [];
  const d = new Date(Date.UTC(new Date(sinceMs).getUTCFullYear(), new Date(sinceMs).getUTCMonth(), 1));
  const end = monthOf(nowMs);
  for (let guard = 0; guard < 120; guard += 1) {
    const m = d.toISOString().slice(0, 7);
    out.push(m);
    if (m >= end) break;
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/* ── Settings: VAT and add-ons ───────────────────────────────────────────── */

export async function getSettings(orgId) {
  const saved = (await getJSON(settingsKey(orgId))) || {};
  return {
    vatPct: Number.isFinite(saved.vatPct) ? saved.vatPct : DEFAULT_VAT_PCT,
    addons: saved.addons && typeof saved.addons === "object" ? saved.addons : {},
    usedAt: saved.usedAt || null,
  };
}

async function putSettings(orgId, next) {
  await setJSON(settingsKey(orgId), next);
  return next;
}

/* VAT is a rate, between none and anything a government has actually set. */
export function readVat(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 50) return { error: "vat" };
  return { vatPct: round2(n) };
}

export async function saveVat(orgId, value) {
  const vat = readVat(value);
  if (vat.error) return vat;
  const current = await getSettings(orgId);
  await putSettings(orgId, { ...current, vatPct: vat.vatPct });
  return { vatPct: vat.vatPct };
}

const slug = (s) => String(s).toLowerCase().trim()
  .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "addon";

/* The add-ons offered on one dish: a name, what the customer pays, and what it
   costs the business. Ids are made here, from the name, so a client cannot
   point two add-ons at one id or choose an id that collides with another. */
export function readAddons(list) {
  if (!Array.isArray(list)) return { error: "addons" };
  if (list.length > MAX_ADDONS) return { error: "toomany", limit: MAX_ADDONS };
  const out = [];
  const used = new Set();
  for (const raw of list) {
    const name = text(raw?.name, 40);
    if (!name) return { error: "name" };
    const price = Number(raw?.price);
    if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) return { error: "price", name };
    const costRaw = raw?.cost;
    const cost = costRaw === null || costRaw === undefined || costRaw === "" ? null : Number(costRaw);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > MAX_PRICE)) return { error: "cost", name };
    let id = slug(name);
    for (let n = 2; used.has(id); n += 1) id = `${slug(name)}-${n}`;
    used.add(id);
    out.push({ id, name, price: round2(price), cost: cost === null ? null : round2(cost) });
  }
  return { addons: out };
}

export async function saveAddons(orgId, itemId, list) {
  const read = readAddons(list);
  if (read.error) return read;
  const current = await getSettings(orgId);
  const addons = { ...current.addons, [String(itemId)]: read.addons };
  if (!read.addons.length) delete addons[String(itemId)];
  await putSettings(orgId, { ...current, addons });
  return { addons: read.addons };
}

/* ── The catalogue ───────────────────────────────────────────────────────── */

/* Every dish that can be sold: on file, not archived, with a selling price.
   A dish without a price is not on the register rather than on it at zero. */
export function catalogueOf(recipes, settings) {
  return (recipes || [])
    .filter((r) => r && !r.archived && Number(r.sellPrice) > 0)
    .map((r) => ({
      id: String(r.id),
      name: String(r.menuItem || "").trim(),
      category: String(r.category || "").trim(),
      price: round2(r.sellPrice),
      addons: settings?.addons?.[String(r.id)] || [],
    }))
    .filter((item) => item.name)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export async function catalogueFor(orgId) {
  const [recipes, settings] = await Promise.all([listRecipes(orgId), getSettings(orgId)]);
  return { items: catalogueOf(recipes, settings), vatPct: settings.vatPct };
}

/* ── A sale ──────────────────────────────────────────────────────────────── */

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

/* Turn what the cashier rang up into a receipt, or say what is wrong with it.

   `input` comes from the request and is trusted for nothing but which dish,
   how many and which add-ons. Everything with a price on it comes from
   `catalogue`. */
export function buildSale(input, { catalogue, vatPct = DEFAULT_VAT_PCT, branchId, at = Date.now(), number, cashier = "" }) {
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  if (!lines.length) return { error: "empty" };
  if (lines.length > MAX_LINES) return { error: "toomany", limit: MAX_LINES };

  const orderType = ORDER_TYPES.includes(input?.orderType) ? input.orderType : null;
  if (!orderType) return { error: "ordertype" };
  const table = orderType === "dine_in" ? text(input?.table, 10) : "";

  const byId = new Map((catalogue || []).map((item) => [item.id, item]));
  const lineItems = [];
  let subtotal = 0;

  for (const raw of lines) {
    const item = byId.get(String(raw?.itemId ?? ""));
    if (!item) return { error: "item", itemId: raw?.itemId ?? null };
    const qty = Number(raw?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { error: "qty", item: item.name };

    const wanted = Array.isArray(raw?.addons) ? raw.addons.map(String) : [];
    const offered = new Map(item.addons.map((a) => [a.id, a]));
    const chosen = [];
    for (const id of wanted) {
      const addon = offered.get(id);
      if (!addon) return { error: "addon", item: item.name, addonId: id };
      chosen.push(addon);
    }

    const unit = round2(item.price + chosen.reduce((sum, a) => sum + a.price, 0));
    const total = round2(unit * qty);
    subtotal = round2(subtotal + total);
    const addonCost = chosen.some((a) => a.cost !== null)
      ? round2(chosen.reduce((sum, a) => sum + (a.cost || 0), 0) * qty)
      : null;

    lineItems.push({
      /* The recipe, by id, where the till would put its catalogue id. Stock
         depletion matches by this first and by the dish name after. */
      item_id: `recipe:${item.id}`,
      variant_id: "",
      item_name: item.name,
      variant_name: "",
      quantity: qty,
      price: unit,
      total_money: total,
      line_modifiers: chosen.map((a) => ({ id: a.id, name: a.name, price: a.price, cost: a.cost })),
      /* What the add-ons cost the business, for this line. Not the dish's own
         cost, which comes from its recipe like any sale's. */
      addon_cost: addonCost,
    });
  }

  const rate = readVat(vatPct).error ? DEFAULT_VAT_PCT : Number(vatPct);
  const tax = round2((subtotal * rate) / 100);
  const totalMoney = round2(subtotal + tax);

  const payType = PAYMENT_TYPES.includes(input?.payment?.type) ? input.payment.type : null;
  if (!payType) return { error: "payment" };
  let received = totalMoney;
  if (payType === "cash" && input.payment.received !== undefined && input.payment.received !== null && input.payment.received !== "") {
    received = round2(input.payment.received);
    if (!Number.isFinite(received) || received < totalMoney) return { error: "short", total: totalMoney };
  }
  const change = payType === "cash" ? round2(received - totalMoney) : 0;

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
      store_id: String(branchId || REGISTER_BRANCH.id),
      order_type: orderType,
      table: table || null,
      cashier: text(cashier, 60),
      vat_pct: rate,
      subtotal_money: subtotal,
      total_tax: tax,
      total_money: totalMoney,
      line_items: lineItems,
      payments: [{
        type: payType === "cash" ? "CASH" : "CARD",
        /* The name the dashboard groups payments by, as a till would call it. */
        name: payType === "cash" ? "Cash" : "Card",
        money_amount: totalMoney,
        received,
        change,
      }],
    },
  };
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

export async function recordSale(orgId, receipt) {
  const at = new Date(receipt.receipt_date).getTime();
  await setJSON(`${receiptPrefix(orgId, monthOf(at))}${receipt.id}`, receipt);
  /* Marks the organization as one that sells through the register, which is
     how an account with no POS still gets a dashboard (see `branchList`). */
  const settings = await getSettings(orgId);
  if (!settings.usedAt) await putSettings(orgId, { ...settings, usedAt: at });
  return receipt;
}

/* Register receipts inside a window, oldest first. */
export async function registerReceipts(orgId, { since = Date.now() - REGISTER_WINDOW_DAYS * DAY, now = Date.now() } = {}) {
  if (!orgId) return [];
  const rows = (await Promise.all(
    monthsBetween(since, now).map((m) => listJSON(receiptPrefix(orgId, m))),
  )).flat();
  return rows
    .map((row) => row.value)
    .filter((r) => {
      const t = new Date(r?.receipt_date).getTime();
      return Number.isFinite(t) && t >= since && t <= now;
    })
    .sort((a, b) => new Date(a.receipt_date) - new Date(b.receipt_date));
}

/* Whether this organization has ever sold through the register. */
export async function usesRegister(orgId) {
  if (!orgId) return false;
  return Boolean((await getSettings(orgId)).usedAt);
}

/* The receipts every report should see alongside the till's: the register's,
   over the longest window any report reads. Empty for an organization that has
   never used it, at the cost of one read. */
export async function registerForReports(orgId) {
  if (!(await usesRegister(orgId))) return [];
  return registerReceipts(orgId);
}

/* What a sale consumed, in the form stock depletion reads. */
export function forDepletion(receipt) {
  return {
    id: receipt.id,
    at: new Date(receipt.receipt_date).getTime(),
    lines: (receipt.line_items || []).map((li) => ({
      itemId: li.item_id || "",
      variantId: "",
      name: li.item_name || "",
      variant: "",
      qty: Number(li.quantity) || 0,
      revenue: Number(li.total_money) || 0,
    })),
  };
}

/* What a report route needs to include register sales: the organization's
   register receipts, and whether it uses the register at all (an account with
   no till that does is given the register as its branch). Two reads for an
   organization that has never used it. */
export async function registerContext(account) {
  const org = account ? await orgFor(account) : null;
  const orgId = org?.id || null;
  const used = await usesRegister(orgId);
  return { orgId, used, register: used ? await registerReceipts(orgId) : [] };
}

/* The branches a route works with, for a signed-in account: the till's, or,
   with no till, the register.

   With no till the register is the branch from the start, not from the first
   sale. A business opening without a POS stocks the shelf before it sells
   anything, and a branch that only appeared after the first sale refused the
   delivery that has to come first. The dashboard is unaffected: it still says
   there is nothing to show until a sale exists (`getMetrics`). */
export async function rosterFor(account) {
  const posToken = await posTokenFor(account.username);
  return branchList(posToken, { register: !posToken });
}
