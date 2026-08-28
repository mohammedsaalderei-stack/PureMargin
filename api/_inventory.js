/* Inventory master data: ingredients, suppliers, categories, storage locations.

   Stage 4 begins here because nothing later can exist without it — a recipe is a
   list of ingredients, a movement is a quantity of one, and actual food cost is
   what they were bought for. Movements, counts and waste come next; this file
   deliberately holds no quantities on hand. An ingredient is a definition, and
   the balance is a consequence of the movement ledger, so storing a quantity
   here would create a second truth for the same number.

   Isolation, per the direction document, is structural rather than checked:
   every key is prefixed with the organization id, so a query cannot reach
   another organization's records even if a caller asks for it. The org id always
   comes from the authenticated session, never from the request body.

   Ingredients are organization-level master data. Where a branch genuinely
   differs — a different supplier, a different local cost — that lives in
   `branchOverrides`, keyed by branch id, rather than in a duplicate ingredient
   per branch. Duplicating the item is what makes group-wide reporting
   impossible later. */

import { getJSON, setJSON } from "./_store.js";
import { isUnit, dimensionOf, UNITS } from "./_units.js";

const ING = (orgId) => `inv:${orgId}:ingredients`;
const SUP = (orgId) => `inv:${orgId}:suppliers`;
const META = (orgId) => `inv:${orgId}:meta`;

/* Ids are derived from the name, so importing the same sheet twice updates
   rather than duplicates. Two ingredients that differ only in punctuation are
   the same ingredient in practice. */
export function slug(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* ── Ingredients ──────────────────────────────────────────── */

export async function listIngredients(orgId, { includeArchived = false } = {}) {
  const all = Object.values((await getJSON(ING(orgId))) || {});
  const live = includeArchived ? all : all.filter((i) => !i.archived);
  return live.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getIngredient(orgId, id) {
  const map = (await getJSON(ING(orgId))) || {};
  return map[id] || null;
}

/* Validation returns a field name rather than a message: the interface owns the
   wording in four languages, and the server owns what is acceptable. */
export function validateIngredient({ name, stockUnit, purchaseUnit, packSize }) {
  if (!String(name || "").trim()) return "name";
  if (!slug(name)) return "name";
  if (!isUnit(stockUnit)) return "stockUnit";

  /* A purchase unit is optional, but if given it must measure the same kind of
     thing as the stock unit — you cannot buy litres of something counted in
     kilograms without a density, which belongs on the ingredient. */
  if (purchaseUnit) {
    if (!isUnit(purchaseUnit)) return "purchaseUnit";
    if (dimensionOf(purchaseUnit) !== dimensionOf(stockUnit)) return "purchaseUnit";
    if (packSize !== undefined && packSize !== null && !(Number(packSize) > 0)) return "packSize";
  }
  return null;
}

export async function saveIngredient(orgId, input) {
  const error = validateIngredient(input);
  if (error) return { error };

  const map = (await getJSON(ING(orgId))) || {};
  const id = input.id || slug(input.name);
  const existing = map[id] || null;
  const now = Date.now();

  const record = {
    id,
    name: String(input.name).trim(),
    category: String(input.category || "").trim(),
    /* The unit stock is held and recipes are written in. Changing it on an
       ingredient that already has history would restate that history, so the
       caller is told rather than silently allowed. */
    stockUnit: input.stockUnit,
    dimension: dimensionOf(input.stockUnit),
    purchaseUnit: input.purchaseUnit || input.stockUnit,
    packSize: Number(input.packSize) > 0 ? Number(input.packSize) : 1,
    sku: String(input.sku || "").trim(),
    barcode: String(input.barcode || "").trim(),
    supplierId: String(input.supplierId || "").trim(),
    location: String(input.location || "").trim(),
    /* Reorder controls; the alerts in a later phase read these rather than
       inventing thresholds. */
    reorderPoint: Number(input.reorderPoint) >= 0 ? Number(input.reorderPoint) : null,
    parLevel: Number(input.parLevel) >= 0 ? Number(input.parLevel) : null,
    shelfLifeDays: Number(input.shelfLifeDays) > 0 ? Number(input.shelfLifeDays) : null,
    branchOverrides: input.branchOverrides && typeof input.branchOverrides === "object"
      ? input.branchOverrides
      : existing?.branchOverrides || {},
    archived: Boolean(input.archived ?? existing?.archived ?? false),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  map[id] = record;
  await setJSON(ING(orgId), map);
  return { ingredient: record, created: !existing };
}

/* Archive, never delete. The document is explicit that the ledger is corrected
   by reversing entries rather than deletion, and an ingredient referenced by a
   past movement or a dated recipe version has to remain resolvable. */
export async function archiveIngredient(orgId, id) {
  const map = (await getJSON(ING(orgId))) || {};
  if (!map[id]) return { error: "notfound" };
  map[id] = { ...map[id], archived: true, updatedAt: Date.now() };
  await setJSON(ING(orgId), map);
  return { ingredient: map[id] };
}

export async function restoreIngredient(orgId, id) {
  const map = (await getJSON(ING(orgId))) || {};
  if (!map[id]) return { error: "notfound" };
  map[id] = { ...map[id], archived: false, updatedAt: Date.now() };
  await setJSON(ING(orgId), map);
  return { ingredient: map[id] };
}

/* ── Suppliers ────────────────────────────────────────────── */

export async function listSuppliers(orgId) {
  const all = Object.values((await getJSON(SUP(orgId))) || {});
  return all.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveSupplier(orgId, input) {
  if (!String(input?.name || "").trim()) return { error: "name" };
  const map = (await getJSON(SUP(orgId))) || {};
  const id = input.id || slug(input.name);
  const existing = map[id] || null;
  map[id] = {
    id,
    name: String(input.name).trim(),
    contact: String(input.contact || "").trim(),
    phone: String(input.phone || "").trim(),
    email: String(input.email || "").trim(),
    /* Lead time feeds the reorder alerts later: a threshold without it can only
       say "low", not "order now". */
    leadTimeDays: Number(input.leadTimeDays) >= 0 ? Number(input.leadTimeDays) : null,
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await setJSON(SUP(orgId), map);
  return { supplier: map[id], created: !existing };
}

export async function removeSupplier(orgId, id) {
  const map = (await getJSON(SUP(orgId))) || {};
  if (!map[id]) return { error: "notfound" };
  /* Refuse while ingredients still point at it, rather than leaving them
     pointing at nothing. */
  const used = (await listIngredients(orgId, { includeArchived: true })).filter((i) => i.supplierId === id);
  if (used.length) return { error: "inuse", count: used.length };
  delete map[id];
  await setJSON(SUP(orgId), map);
  return { ok: true };
}

/* ── Categories and storage locations ─────────────────────── */

/* Kept as an editable org-level list rather than a table: they exist to group
   and to populate a picker consistently, and a free-text field per item is how
   "Dairy", "dairy" and "Diary" end up in the same report. */
export async function getMeta(orgId) {
  const meta = (await getJSON(META(orgId))) || {};
  return {
    categories: meta.categories || [],
    locations: meta.locations || [],
    /* Whether a sale should take its ingredients out of stock by itself.

       Off by default, and deliberately so. Leakage compares what the ledger
       says left the store against what the sales say should have left; writing
       consumption derived from those sales into the ledger makes both sides
       the same number and leakage reads zero however much is being wasted.

       On, the balance is live and leakage moves to the count sheet. Off,
       leakage works as designed and somebody records what the kitchen takes.
       Both are defensible; silently choosing one is not. */
    autoDepleteFromSales: Boolean(meta.autoDepleteFromSales),
  };
}

export async function saveMeta(orgId, { categories, locations, autoDepleteFromSales }) {
  const clean = (list) =>
    [...new Set((list || []).map((v) => String(v).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const meta = {
    categories: clean(categories ?? (await getMeta(orgId)).categories),
    locations: clean(locations ?? (await getMeta(orgId)).locations),
    autoDepleteFromSales: autoDepleteFromSales === undefined
      ? (await getMeta(orgId)).autoDepleteFromSales
      : Boolean(autoDepleteFromSales),
  };
  await setJSON(META(orgId), meta);
  return meta;
}

/* What a branch actually sees for an ingredient: the org definition with that
   branch's overrides applied. One place, so every later consumer — recipes,
   costing, alerts — resolves an override the same way. */
export function forBranch(ingredient, branchId) {
  if (!ingredient) return null;
  const override = branchId ? ingredient.branchOverrides?.[branchId] : null;
  if (!override) return ingredient;
  return { ...ingredient, ...override, id: ingredient.id, overridden: true };
}

export { UNITS };
