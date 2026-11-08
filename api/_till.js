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
import { REGISTER_BRANCH, REGISTER_WINDOW_DAYS } from "./_data.js";
import { imageUrl } from "./_imageurl.js";
import { listStores, storeNames } from "./_stores.js";
import { orgFor } from "./_org.js";
import {
  DEFAULT_VAT_PCT, ORDER_TYPES, PAYMENT_TYPES, PAYMENT_KINDS, DEFAULT_PAYMENT_TYPES, VAT_MODES,
  readVat, receiptNumber, readDiscount, buildSale, buildRefund,
} from "../shared/tillprice.js";

/* The pricing lives in `shared/tillprice.js` so a till offline can run it too. */
export {
  DEFAULT_VAT_PCT, ORDER_TYPES, PAYMENT_TYPES, PAYMENT_KINDS, DEFAULT_PAYMENT_TYPES, VAT_MODES,
  readVat, receiptNumber, readDiscount, buildSale, buildRefund,
};

export { REGISTER_BRANCH };


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
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return {
    vatPct: Number.isFinite(saved.vatPct) ? saved.vatPct : DEFAULT_VAT_PCT,
    vatMode: VAT_MODES.includes(saved.vatMode) ? saved.vatMode : "exclusive",
    addons: obj(saved.addons),
    variants: obj(saved.variants),
    images: obj(saved.images),
    usedAt: saved.usedAt || null,
    /* Everything below is the register as a till of its own: what it takes
       money as, what it may knock off, what it prints, and whether a cashier
       has to open a shift before selling. */
    paymentTypes: Array.isArray(saved.paymentTypes) && saved.paymentTypes.length
      ? saved.paymentTypes : DEFAULT_PAYMENT_TYPES,
    discounts: Array.isArray(saved.discounts) ? saved.discounts : [],
    receipt: obj(saved.receipt),
    loyaltyPct: Number.isFinite(saved.loyaltyPct) ? saved.loyaltyPct : 0,
    useShifts: saved.useShifts !== false,
    /* Things sold that have no recipe — a can of soda, a bottle of water. */
    products: obj(saved.products),
    /* Barcode, SKU and tile colour for a dish, kept beside the recipe rather
       than on it: they are facts about selling it, not about making it. */
    itemMeta: obj(saved.itemMeta),
  };
}

export async function putSettings(orgId, next) {
  await setJSON(settingsKey(orgId), next);
  return next;
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

/* Sizes or flavours of one item, each with its own price.

   `scale` is how much of the item's recipe — or, for a product, its stock
   item — one of this variant draws: 1.5 for a large that is half as much
   again. A variant that is its own recipe is written on the Recipes screen
   instead (same dish name, a variant set) and needs no scale. */
const MAX_VARIANTS = 20;
export function readVariants(list) {
  if (!Array.isArray(list)) return { error: "variants" };
  if (list.length > MAX_VARIANTS) return { error: "toomany", limit: MAX_VARIANTS };
  const out = [];
  const used = new Set();
  for (const raw of list) {
    const name = text(raw?.name, 40);
    if (!name) return { error: "name" };
    const price = Number(raw?.price);
    if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) return { error: "price", name };
    const scaleRaw = raw?.scale === undefined || raw?.scale === null || raw?.scale === "" ? 1 : Number(raw.scale);
    if (!Number.isFinite(scaleRaw) || scaleRaw < 0.05 || scaleRaw > 20) return { error: "scale", name };
    let id = raw?.id && /^v-[\p{L}\p{N}-]+$/u.test(String(raw.id)) && !used.has(String(raw.id)) ? String(raw.id) : `v-${slug(name)}`;
    for (let n = 2; used.has(id); n += 1) id = `v-${slug(name)}-${n}`;
    used.add(id);
    out.push({
      id, name, price: round2(price), scale: Math.round(scaleRaw * 1000) / 1000,
      barcode: text(raw?.barcode, 40).replace(/\s/g, ""), sku: text(raw?.sku, 40),
    });
  }
  return { variants: out };
}

export async function saveVariants(orgId, itemId, list) {
  const read = readVariants(list);
  if (read.error) return read;
  const current = await getSettings(orgId);
  const variants = { ...current.variants, [String(itemId)]: read.variants };
  if (!read.variants.length) delete variants[String(itemId)];
  await putSettings(orgId, { ...current, variants });
  return { variants: read.variants };
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

/* The menu: every dish on file that is not archived.

   A dish with no selling price is on it, marked `priced: false`, rather than
   missing. The menu is the recipes, and a menu scanned from a kitchen sheet
   comes in with no prices: leaving those dishes off made the register look
   empty to somebody looking at six dishes on the Recipes screen. A manager
   sets the price from the register; nobody can sell a dish at no price
   (`buildSale` refuses one). */
export function catalogueOf(recipes, settings, { orgId = null } = {}) {
  const meta = settings?.itemMeta || {};
  /* A picture's signed address, when the item has one and the organization is
     known; null otherwise, and a tile shows its colour instead. */
  const pictureOf = (id) => imageUrl(orgId, id, settings?.images?.[String(id)]) || null;
  const own = settings?.variants || {};
  const priceOf = (r) => (Number(r.sellPrice) > 0 ? round2(r.sellPrice) : null);

  /* Recipes that share a dish name and differ by variant ("Latte · Small",
     "Latte · Large") are one item on the register with those variants, each
     its own recipe and price. A dish with one recipe is an item as before,
     with whatever variants were set on the register. */
  const groups = new Map();
  for (const r of recipes || []) {
    if (!r || r.archived) continue;
    const name = String(r.menuItem || "").trim();
    if (!name) continue;
    const key = name.toLowerCase().replace(/\s+/g, " ");
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const dishes = [...groups.values()].map((list) => {
    const base = list.find((r) => !String(r.variant || "").trim()) || list[0];
    const m = meta[String(base.id)] || {};
    const fromRecipes = list.length > 1 || String(base.variant || "").trim()
      ? list.map((r) => ({
        id: `r-${r.id}`, name: String(r.variant || "").trim(), price: priceOf(r), recipeId: String(r.id), scale: 1,
        barcode: meta[String(r.id)]?.barcode || "", sku: meta[String(r.id)]?.sku || "",
      }))
      : [];
    const variants = fromRecipes.length ? fromRecipes : own[String(base.id)] || [];
    const prices = variants.map((v) => v.price).filter((p) => p > 0);
    return {
      id: String(base.id),
      kind: "recipe",
      name: String(base.menuItem || "").trim(),
      category: String(base.category || "").trim(),
      price: variants.length ? (prices.length ? Math.min(...prices) : null) : priceOf(base),
      priced: variants.length ? prices.length > 0 : priceOf(base) !== null,
      variants,
      variantsFromRecipes: fromRecipes.length > 0,
      image: pictureOf(base.id),
      addons: settings?.addons?.[String(base.id)] || [],
      barcode: m.barcode || "",
      sku: m.sku || "",
      color: m.color || "",
      hidden: Boolean(m.hidden),
    };
  });
  /* Products sold as they come. Ids carry a prefix so one can never collide
     with a recipe's, whatever either is called. */
  const products = Object.entries(settings?.products || {})
    .filter(([, p]) => p && !p.archived)
    .map(([id, p]) => ({
      id,
      kind: "product",
      name: String(p.name || "").trim(),
      category: String(p.category || "").trim(),
      price: own[id]?.length ? Math.min(...own[id].map((v) => v.price)) : Number(p.price) > 0 ? round2(p.price) : null,
      priced: Number(p.price) > 0 || Boolean(own[id]?.length),
      variants: own[id] || [],
      variantsFromRecipes: false,
      stock: p.stock?.ingredientId ? p.stock : null,
      image: pictureOf(id),
      addons: settings?.addons?.[id] || [],
      barcode: p.barcode || "",
      sku: p.sku || "",
      color: p.color || "",
      cost: Number.isFinite(p.cost) ? p.cost : null,
      hidden: Boolean(p.hidden),
    }));
  return [...dishes, ...products]
    .filter((item) => item.name)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export async function catalogueFor(orgId) {
  const [recipes, settings] = await Promise.all([listRecipes(orgId), getSettings(orgId)]);
  return { items: catalogueOf(recipes, settings, { orgId }), vatPct: settings.vatPct, settings };
}

/* ── A sale ──────────────────────────────────────────────────────────────── */


/* Turn what the cashier rang up into a receipt, or say what is wrong with it.

   `input` comes from the request and is trusted for nothing but which dish,
   how many and which add-ons. Everything with a price on it comes from
   `catalogue`. */




/* ── Storage ─────────────────────────────────────────────────────────────── */

export async function recordSale(orgId, receipt) {
  /* A sale sent twice is one sale. A till that lost its signal keeps a sale
     and sends it when it is back, and may send it again if the first answer
     never arrived; the id the till gave it is how the second copy is known. */
  if (receipt.client_id) {
    const seen = await getJSON(clientKey(orgId, receipt.client_id));
    if (seen) {
      const existing = await findReceipt(orgId, seen);
      if (existing) return { ...existing, duplicate: true };
    }
  }
  const at = new Date(receipt.receipt_date).getTime();
  await setJSON(`${receiptPrefix(orgId, monthOf(at))}${receipt.id}`, receipt);
  if (receipt.client_id) await setJSON(clientKey(orgId, receipt.client_id), receipt.id);
  if (receipt.receipt_type === "REFUND" && receipt.refund_for) {
    const list = (await getJSON(refundsKey(orgId, receipt.refund_for))) || [];
    await setJSON(refundsKey(orgId, receipt.refund_for), [...list, receipt.id]);
  }
  /* Marks the organization as one that sells through the register, which is
     how an account with no POS still gets a dashboard (see `branchList`). */
  const settings = await getSettings(orgId);
  if (!settings.usedAt) await putSettings(orgId, { ...settings, usedAt: at });
  return receipt;
}

const clientKey = (orgId, id) => `register:${orgId}:client:${String(id).slice(0, 80)}`;
const refundsKey = (orgId, number) => `register:${orgId}:refunds:${number}`;

/* The month a register receipt is filed under, read off its number. */
export function monthOfNumber(number) {
  const m = /^PM-(\d{2})(\d{2})\d{2}-\d{6}-[0-9A-Z]{3,6}$/.exec(String(number || ""));
  return m ? `20${m[1]}-${m[2]}` : null;
}

export async function findReceipt(orgId, number) {
  const month = monthOfNumber(number);
  if (!orgId || !month) return null;
  return getJSON(`${receiptPrefix(orgId, month)}${number}`);
}

/* What earlier refunds of a sale already gave back, per line. */
export async function refundedSoFar(orgId, number) {
  const ids = (await getJSON(refundsKey(orgId, number))) || [];
  const out = {};
  for (const id of ids) {
    const r = await findReceipt(orgId, id);
    for (const li of r?.line_items || []) {
      out[li.line_index] = (out[li.line_index] || 0) + Number(li.quantity || 0);
    }
  }
  return { lines: out, refunds: ids };
}

/* A receipt number proposed by a till that sold while offline.

   It printed that number on the customer's receipt, so the record has to
   carry the same one. Accepted only in the register's own format, dated the
   same day as the sale, and never over a number already used. */
export async function acceptNumber(orgId, proposed, at) {
  const month = monthOfNumber(proposed);
  if (!month) return null;
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  if (String(proposed).slice(3, 9) !== stamp) return null;
  if (await findReceipt(orgId, proposed)) return null;
  return String(proposed);
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
      variantId: li.variant_id || "",
      name: li.item_name || "",
      variant: li.variant_name || "",
      scale: Number(li.variant_scale) > 0 ? Number(li.variant_scale) : 1,
      stockDraw: Array.isArray(li.stock_draw) ? li.stock_draw : [],
      qty: Number(li.quantity) || 0,
      revenue: Number(li.total_money) || 0,
    })),
  };
}

/* What a report route needs: the organization's receipts over the longest
   window any report reads, and the names of its stores. */
export async function registerContext(account, { days = REGISTER_WINDOW_DAYS } = {}) {
  const org = account ? await orgFor(account) : null;
  const orgId = org?.id || null;
  const settings = orgId ? await getSettings(orgId) : null;
  const used = Boolean(settings?.usedAt);
  /* The first sale, less a week for sales rung up offline before it was
     sent. Nothing is read from before it, which is what keeps "all time"
     from asking storage for every month since 1970. */
  const firstSaleAt = used ? new Date(settings.usedAt).getTime() - 7 * DAY : null;
  const since = days === "all" ? firstSaleAt : Math.max(Date.now() - days * DAY, firstSaleAt ?? 0);
  return {
    orgId,
    used,
    firstSaleAt,
    register: used ? await registerReceipts(orgId, { since }) : [],
    names: orgId ? await storeNames(orgId, org?.name) : {},
  };
}

/* The branches a route works with, for a signed-in account: the stores the
   business has set up (one, named after it, until it adds more). */
export async function rosterFor(account) {
  const org = account ? await orgFor(account) : null;
  if (!org?.id) return [];
  return (await listStores(org.id, { orgName: org.name }))
    .map((st) => ({ id: st.id, name: st.name, address: st.address || "", phone: st.phone || "", trn: st.trn || "" }));
}
