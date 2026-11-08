/* Setting the register up: what it takes money as, what it may knock off,
   what it prints, and what it sells besides the recipes.

   Each setter reads what it is given, refuses what makes no sense by naming
   the field, and writes only its own part of the settings — a receipt footer
   saved from one screen must never reset the payment types saved from
   another. Ids are made here from names, so a client cannot aim two entries
   at one id. */

import { getSettings, putSettings, PAYMENT_KINDS, VAT_MODES } from "./_till.js";

const text = (v, max) => String(v ?? "").trim().slice(0, max);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const MAX_PRICE = 100000;
const slug = (s) => String(s).toLowerCase().trim()
  .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "x";
const uniqueId = (base, used) => {
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  used.add(id);
  return id;
};
const COLOR = /^#[0-9a-f]{6}$/i;

/* ── Payment types ── */

export function readPaymentTypes(list) {
  if (!Array.isArray(list) || !list.length || list.length > 12) return { error: "paymentTypes" };
  const used = new Set();
  const out = [];
  for (const raw of list) {
    const name = text(raw?.name, 30);
    if (!name) return { error: "name" };
    const kind = PAYMENT_KINDS.includes(raw?.kind) ? raw.kind : null;
    if (!kind) return { error: "kind", name };
    /* An id that already exists is kept, so receipts filed under it still
       group with new ones after a rename. */
    const wanted = raw?.id && /^[\p{L}\p{N}-]{1,40}$/u.test(String(raw.id)) ? String(raw.id) : slug(name);
    out.push({ id: uniqueId(wanted, used), name, kind });
  }
  return { paymentTypes: out };
}

/* ── Discounts ── */

export function readDiscounts(list) {
  if (!Array.isArray(list) || list.length > 30) return { error: "discounts" };
  const used = new Set();
  const out = [];
  for (const raw of list) {
    const name = text(raw?.name, 30);
    if (!name) return { error: "name" };
    const type = raw?.type === "amount" ? "amount" : raw?.type === "pct" ? "pct" : null;
    const value = Number(raw?.value);
    if (!type || !Number.isFinite(value) || value <= 0) return { error: "value", name };
    if (type === "pct" && value > 100) return { error: "value", name };
    if (type === "amount" && value > MAX_PRICE) return { error: "value", name };
    const wanted = raw?.id && /^[\p{L}\p{N}-]{1,40}$/u.test(String(raw.id)) ? String(raw.id) : slug(name);
    /* Restricted: only a manager may apply it. */
    out.push({ id: uniqueId(wanted, used), name, type, value: round2(value), restricted: Boolean(raw?.restricted) });
  }
  return { discounts: out };
}

/* ── What the receipt says ── */

export function readReceipt(raw) {
  const r = raw || {};
  return {
    receipt: {
      business: text(r.business, 60),
      address: text(r.address, 120),
      phone: text(r.phone, 30),
      /* The UAE tax registration number a tax invoice has to carry. */
      trn: text(r.trn, 20).replace(/\s/g, ""),
      header: text(r.header, 200),
      footer: text(r.footer, 200),
      showLogo: r.showLogo !== false,
    },
  };
}

export function readOptions(raw) {
  const out = {};
  if (raw?.vatMode !== undefined) {
    if (!VAT_MODES.includes(raw.vatMode)) return { error: "vatMode" };
    out.vatMode = raw.vatMode;
  }
  if (raw?.loyaltyPct !== undefined) {
    const n = Number(raw.loyaltyPct);
    if (!Number.isFinite(n) || n < 0 || n > 50) return { error: "loyaltyPct" };
    out.loyaltyPct = round2(n);
  }
  if (raw?.useShifts !== undefined) out.useShifts = Boolean(raw.useShifts);
  return { options: out };
}

export async function saveSection(orgId, section, value) {
  const current = await getSettings(orgId);
  const read = section === "paymentTypes" ? readPaymentTypes(value)
    : section === "discounts" ? readDiscounts(value)
    : section === "receipt" ? readReceipt(value)
    : section === "options" ? readOptions(value)
    : { error: "section" };
  if (read.error) return read;
  const next = section === "options" ? { ...current, ...read.options } : { ...current, [section]: read[section] };
  await putSettings(orgId, next);
  return { settings: next };
}

/* ── Products and the selling side of a dish ── */

/* A barcode belongs to one thing. Scanning it must ring up that thing and
   nothing else, so a second item claiming it is refused by name. */
function barcodeClash(settings, barcode, selfId) {
  if (!barcode) return null;
  for (const [id, p] of Object.entries(settings.products || {})) {
    if (id !== selfId && !p.archived && p.barcode === barcode) return p.name;
  }
  for (const [id, m] of Object.entries(settings.itemMeta || {})) {
    if (id !== selfId && m.barcode === barcode) return id;
  }
  return null;
}

export async function saveProduct(orgId, raw) {
  const settings = await getSettings(orgId);
  const name = text(raw?.name, 60);
  if (!name) return { error: "name" };
  const price = Number(raw?.price);
  if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) return { error: "price" };
  const costRaw = raw?.cost;
  const cost = costRaw === undefined || costRaw === null || costRaw === "" ? null : Number(costRaw);
  if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > MAX_PRICE)) return { error: "cost" };
  const color = text(raw?.color, 7);
  if (color && !COLOR.test(color)) return { error: "color" };
  const barcode = text(raw?.barcode, 40).replace(/\s/g, "");
  const used = new Set(Object.keys(settings.products));
  const id = raw?.id && settings.products[String(raw.id)] ? String(raw.id) : uniqueId(`p-${slug(name)}`, used);
  const clash = barcodeClash(settings, barcode, id);
  if (clash) return { error: "barcode", item: clash };
  const product = {
    name, price: round2(price), cost: cost === null ? null : round2(cost),
    category: text(raw?.category, 40), barcode, sku: text(raw?.sku, 40), color,
    hidden: Boolean(raw?.hidden), archived: false,
  };
  await putSettings(orgId, { ...settings, products: { ...settings.products, [id]: product } });
  return { id, product };
}

export async function archiveProduct(orgId, id) {
  const settings = await getSettings(orgId);
  const p = settings.products[String(id)];
  if (!p) return { error: "notfound" };
  await putSettings(orgId, { ...settings, products: { ...settings.products, [String(id)]: { ...p, archived: true } } });
  return { archived: true };
}

export async function saveItemMeta(orgId, itemId, raw) {
  const settings = await getSettings(orgId);
  const id = String(itemId || "");
  if (!id) return { error: "item" };
  const color = text(raw?.color, 7);
  if (color && !COLOR.test(color)) return { error: "color" };
  const barcode = text(raw?.barcode, 40).replace(/\s/g, "");
  const clash = barcodeClash(settings, barcode, id);
  if (clash) return { error: "barcode", item: clash };
  const meta = { barcode, sku: text(raw?.sku, 40), color, hidden: Boolean(raw?.hidden) };
  await putSettings(orgId, { ...settings, itemMeta: { ...settings.itemMeta, [id]: meta } });
  return { itemId: id, meta };
}
