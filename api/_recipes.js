/* Recipes and recipe cost — stage 4, phase 5.

   A recipe is what connects a sale to an ingredient. Without it a menu item's
   cost is a number somebody typed once, and theoretical consumption — the whole
   basis of usage variance — cannot be calculated at all. So this module is the
   bridge the next phase stands on, and its job is to be exactly right about four
   things the document lists: unit conversions, preparation yield, portioning, and
   dated versions.

   The decisions:

   1. **Versions are dated and append-only.** Saving a recipe writes a new version
      with an `effectiveFrom`; older versions are never edited or removed. A March
      sale must be costed with March's recipe, and a system that overwrites the
      recipe silently restates last quarter's food cost every time a chef changes
      a garnish.
   2. **Lines are stated as they end up in the dish** — net, prepared weight — and
      preparation yield converts that into what has to leave the store. 800 g of
      trimmed beef at a 75% yield draws 1066 g from stock. Stating lines gross
      instead would be defensible, but then every recipe would need re-writing
      whenever a supplier's trim changed, and the chef's own portion figure would
      be the derived one, which is backwards.
   3. **Packaging is a separate list, not an ingredient line.** It costs money and
      belongs in the cost of a sold item, but it isn't food: a food-cost
      percentage that includes clamshells is not comparable with anybody's
      benchmark, so the two are summed apart and reported apart.
   4. **A recipe with an unpriced ingredient reports the gap** instead of costing
      it at zero. Zero is the single most damaging default available here — it
      makes margin look better exactly where the data is worst.

   Recipes are organization-level shared master data, as the document allows, with
   branch-specific cost coming from each branch's own ledger rather than from a
   duplicated recipe per branch. */

import { getJSON, setJSON } from "./_store.js";
import { getIngredient, listIngredients, slug } from "./_inventory.js";
import { baseUnitOf } from "./_movements.js";
import { convert, isUnit, sameDimension } from "./_units.js";
import { costBasis, costFrom, evidenceFor, DEFAULT_COST_METHOD } from "./_costing.js";

const RECIPES = (orgId) => `inv:${orgId}:recipes`;

const round = (n, places = 6) => (Number.isFinite(n) ? Number(n.toFixed(places)) : n);

/* Every recipe as stored. Exported so the bill scanner can map menu items to
   what they consume without going through the costing path, which builds a
   cost basis it would have no use for. */
export async function listRecipes(orgId) {
  return Object.values((await readAll(orgId)) || {});
}

async function readAll(orgId) {
  return (await getJSON(RECIPES(orgId))) || {};
}

/* ── Validation ───────────────────────────────────────────── */

/* Lines come back resolved against the ingredient master, with each quantity
   converted to base units once, here. Everything downstream then works in one
   scale — the reason a unit mistake can't survive past this function. */
async function buildLines(orgId, inputs, { required }) {
  const rows = [];
  if (inputs === undefined || inputs === null) return { lines: rows };
  if (!Array.isArray(inputs)) return { error: "lines" };
  if (required && !inputs.length) return { error: "nolines" };

  for (const input of inputs) {
    const ingredient = await getIngredient(orgId, String(input.ingredientId || ""));
    if (!ingredient) return { error: "ingredientId" };
    if (rows.some((r) => r.ingredientId === ingredient.id)) return { error: "duplicate" };

    const qty = Number(input.qty);
    if (!Number.isFinite(qty) || qty <= 0) return { error: "qty" };

    const unit = input.unit || ingredient.stockUnit;
    if (!isUnit(unit) || !sameDimension(unit, ingredient.stockUnit)) return { error: "unit" };

    rows.push({
      ingredientId: ingredient.id,
      name: ingredient.name,
      qty, unit,
      /* Net — what ends up in the dish. Yield turns it into what leaves stock. */
      qtyBase: convert(qty, unit, baseUnitOf(ingredient)),
      baseUnit: baseUnitOf(ingredient),
      note: String(input.note || "").trim(),
    });
  }
  return { lines: rows };
}

function validateVersion({ portions, yieldPct }) {
  const p = Number(portions);
  if (!Number.isFinite(p) || p <= 0) return "portions";
  /* A yield above 100% would mean cooking created matter. Below 1% is a typo
     that would multiply cost by a hundred and look like a data problem forever. */
  const y = Number(yieldPct);
  if (!Number.isFinite(y) || y < 1 || y > 100) return "yieldPct";
  return null;
}

/* ── Saving ───────────────────────────────────────────────── */

/* Creates the recipe if it is new, and in either case appends a version.

   `effectiveFrom` defaults to now. Back-dating is allowed — recipes get written
   down after the kitchen already changed — but versions are always kept sorted, so
   a back-dated version slots into history rather than landing on top of it. */
export async function saveVersion(orgId, input = {}) {
  const menuItem = String(input.menuItem || "").trim();
  if (!menuItem) return { error: "menuItem" };

  const invalid = validateVersion(input);
  if (invalid) return { error: invalid };

  const built = await buildLines(orgId, input.lines, { required: true });
  if (built.error) return { error: built.error };

  const packaging = await buildLines(orgId, input.packaging, { required: false });
  if (packaging.error) return { error: packaging.error };

  const map = await readAll(orgId);
  const id = String(input.id || "").trim() || slug(menuItem);
  const existing = map[id] || null;
  const now = Date.now();

  const version = {
    version: (existing?.versions?.length || 0) + 1,
    effectiveFrom: Number(input.effectiveFrom) > 0 ? Number(input.effectiveFrom) : now,
    /* How many sellable portions the quantities below produce. Recipes are
       written at batch scale in real kitchens; per-portion cost is derived. */
    portions: Number(input.portions),
    /* Usable output after trim, drain and cooking loss, as a percentage. */
    yieldPct: Number(input.yieldPct),
    lines: built.lines,
    packaging: packaging.lines,
    note: String(input.note || "").trim(),
    createdAt: now,
    createdBy: String(input.actor || ""),
  };

  const recipe = {
    id,
    menuItem,
    /* The POS variant this applies to, when a name alone is ambiguous
       (a large and a regular of the same drink cost different amounts). */
    variant: String(input.variant || "").trim(),
    category: String(input.category || "").trim(),
    sellPrice: Number(input.sellPrice) > 0 ? Number(input.sellPrice) : (existing?.sellPrice ?? null),
    archived: Boolean(input.archived ?? existing?.archived ?? false),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    versions: [...(existing?.versions || []), version].sort(
      (a, b) => a.effectiveFrom - b.effectiveFrom || a.version - b.version
    ),
  };

  map[id] = recipe;
  await setJSON(RECIPES(orgId), map);
  return { recipe, version, created: !existing };
}

/* Archived, never deleted: past sales were costed with these versions, and the
   figures they produced have to stay reproducible. */
/* Remove a recipe outright.

   Archiving was the only way out, on the reasoning that past sales were costed
   with these versions and have to stay reproducible. That was right when
   consumption was recomputed from recipes on demand. It is no longer: a sale
   now writes actual movements into the ledger at the time it happens, so the
   history lives in the ledger rather than in the recipe, and deleting one
   changes what future sales consume rather than rewriting the past.

   Archiving stays for a dish that is off the menu but might come back — its
   versions and their dates are worth keeping. Deleting is for the recipe that
   should never have existed: a duplicate, a mis-scanned card, a test. Telling
   somebody their mistake can only be hidden is the software protecting its own
   bookkeeping at their expense. */
export async function deleteRecipe(orgId, id) {
  const map = (await getJSON(RECIPES(orgId))) || {};
  if (!map[id]) return { error: "notfound" };
  const { menuItem } = map[id];
  delete map[id];
  await setJSON(RECIPES(orgId), map);
  return { deleted: true, menuItem };
}

export async function archiveRecipe(orgId, id, { archived = true } = {}) {
  const map = await readAll(orgId);
  if (!map[id]) return { error: "notfound" };
  map[id] = { ...map[id], archived: Boolean(archived), updatedAt: Date.now() };
  await setJSON(RECIPES(orgId), map);
  return { recipe: map[id] };
}

/* ── Effective version ────────────────────────────────────── */

/* The version in force at a moment: the newest one that had already taken effect.
   A recipe written last week does not cost a sale from last month — the single
   rule that makes a dated period's cost of sales reproducible. */
export function effectiveVersion(recipe, at = Date.now()) {
  const eligible = (recipe?.versions || []).filter((v) => v.effectiveFrom <= at);
  return eligible.length ? eligible[eligible.length - 1] : null;
}

/* ── Costing ──────────────────────────────────────────────── */

/* Costs one version against a cost basis.

   Yield is applied to food, not to packaging: trimming a carrot wastes carrot, it
   does not waste the box. Both are summed per batch and then divided by portions,
   so the per-portion figure a menu decision needs comes out with the batch figure
   a kitchen recognises still visible beside it. */
export function costVersion(version, basis, { method = DEFAULT_COST_METHOD } = {}) {
  const yieldFactor = version.yieldPct / 100;

  const priceLines = (lines, applyYield) =>
    lines.map((line) => {
      const costPerBase = costFrom(basis, line.ingredientId, method);
      /* Gross draw on stock: what has to be issued to end up with the net
         quantity the recipe states. */
      const drawBase = applyYield ? line.qtyBase / yieldFactor : line.qtyBase;
      return {
        ...line,
        drawBase: round(drawBase),
        costPerBase,
        cost: costPerBase === null ? null : round(drawBase * costPerBase, 4),
        ...evidenceFor(basis, line.ingredientId),
      };
    });

  const food = priceLines(version.lines, true);
  const packaging = priceLines(version.packaging || [], false);
  const all = [...food, ...packaging];

  const sum = (rows) => rows.reduce((total, r) => total + (r.cost || 0), 0);
  const foodCost = sum(food);
  const packagingCost = sum(packaging);

  /* Data quality travels with the number, never as a footnote somebody has to go
     and look for. A cost that is missing two of twelve ingredients is not a cost,
     it is a lower bound, and the interface has to be able to say so. */
  const unpriced = all.filter((r) => r.cost === null);
  const coverage = all.length ? round((all.length - unpriced.length) / all.length, 4) : 0;

  return {
    method,
    portions: version.portions,
    yieldPct: version.yieldPct,
    lines: food,
    packaging,
    batch: {
      foodCost: round(foodCost, 4),
      packagingCost: round(packagingCost, 4),
      total: round(foodCost + packagingCost, 4),
    },
    perPortion: {
      foodCost: round(foodCost / version.portions, 4),
      packagingCost: round(packagingCost / version.portions, 4),
      total: round((foodCost + packagingCost) / version.portions, 4),
    },
    /* Complete only when every line has a price behind it. */
    complete: unpriced.length === 0,
    coverage,
    unpriced: unpriced.map((r) => ({ ingredientId: r.ingredientId, name: r.name })),
  };
}

/* Margin against the selling price, when one is known. Gross margin only —
   contribution margin arrives with the operating-cost layer the document defers,
   and calling this one "contribution" would overstate what it accounts for. */
export function marginFor(sellPrice, cost) {
  if (!(sellPrice > 0) || cost === null) return null;
  const profit = sellPrice - cost;
  return {
    sellPrice,
    cost: round(cost, 4),
    profit: round(profit, 4),
    marginPct: round((profit / sellPrice) * 100, 2),
    /* The number a kitchen actually manages by. */
    costPct: round((cost / sellPrice) * 100, 2),
  };
}

/* ── Reading ──────────────────────────────────────────────── */

/* One recipe, costed at a moment for a set of branches.

   The branch list is the already-intersected one from the route: cost comes from
   those branches' ledgers, so an owner asking about the group and a branch
   manager asking about their kitchen get the same recipe with each one's own
   prices — which is the point of keeping the recipe shared and the cost local. */
export async function costedRecipe(orgId, id, branchIds, { at = Date.now(), method } = {}) {
  const recipe = (await readAll(orgId))[String(id || "")];
  if (!recipe) return null;

  const version = effectiveVersion(recipe, at);
  const basis = await costBasis(orgId, branchIds, { to: at });
  const costing = version ? costVersion(version, basis, { method }) : null;

  return {
    ...recipe,
    at,
    effective: version,
    costing,
    margin: costing ? marginFor(recipe.sellPrice, costing.perPortion.total) : null,
  };
}

/* Every recipe, costed — the list a menu-engineering view reads. One cost basis is
   built and shared across all of them, because walking the ledger per recipe is
   how this screen would become the slow one. */
export async function costedList(orgId, branchIds, { at = Date.now(), method, includeArchived = false } = {}) {
  const map = await readAll(orgId);
  const basis = await costBasis(orgId, branchIds, { to: at });

  return Object.values(map)
    .filter((r) => includeArchived || !r.archived)
    .sort((a, b) => a.menuItem.localeCompare(b.menuItem))
    .map((recipe) => {
      const version = effectiveVersion(recipe, at);
      const costing = version ? costVersion(version, basis, { method }) : null;
      return {
        id: recipe.id,
        menuItem: recipe.menuItem,
        variant: recipe.variant,
        category: recipe.category,
        sellPrice: recipe.sellPrice,
        archived: recipe.archived,
        versionCount: recipe.versions.length,
        version: version?.version || null,
        effectiveFrom: version?.effectiveFrom || null,
        portions: version?.portions || null,
        perPortion: costing?.perPortion || null,
        complete: costing?.complete ?? false,
        coverage: costing?.coverage ?? 0,
        unpriced: costing?.unpriced || [],
        margin: costing ? marginFor(recipe.sellPrice, costing.perPortion.total) : null,
      };
    });
}

/* ── Simulation ───────────────────────────────────────────── */

/* "What if this ingredient's price moved, or the portion changed, or we charged
   differently?" — modelled before anything is approved, which is what the
   document asks for and what stops a menu re-price being a guess.

   Nothing is written. The overrides are applied to a copy of the basis and the
   version, so the answer comes from the same costing code as the real figure
   rather than a parallel formula that could disagree with it. */
export async function simulate(orgId, id, branchIds, {
  at = Date.now(), method,
  /* { ingredientId: pricePerBase } — a supplier's new price. */
  costOverrides = {},
  /* { ingredientId: qty } in the line's own unit — a portion change. */
  qtyOverrides = {},
  portions,
  sellPrice,
} = {}) {
  const recipe = (await readAll(orgId))[String(id || "")];
  if (!recipe) return null;
  const version = effectiveVersion(recipe, at);
  if (!version) return null;

  const basis = await costBasis(orgId, branchIds, { to: at });
  const before = costVersion(version, basis, { method });

  /* A simulated basis: same shape, so `costVersion` can't tell the difference. */
  const simulated = new Map(basis);
  for (const [ingredientId, price] of Object.entries(costOverrides)) {
    const value = Number(price);
    if (!Number.isFinite(value) || value < 0) continue;
    const row = basis.get(ingredientId) || { receipts: 0, lastAt: null };
    simulated.set(ingredientId, { ...row, last: value, wavg: value });
  }

  const patchLines = (lines) =>
    lines.map((line) => {
      const override = Number(qtyOverrides[line.ingredientId]);
      if (!Number.isFinite(override) || override < 0) return line;
      return {
        ...line,
        qty: override,
        qtyBase: convert(override, line.unit, line.baseUnit),
      };
    });

  const patched = {
    ...version,
    portions: Number(portions) > 0 ? Number(portions) : version.portions,
    lines: patchLines(version.lines),
    packaging: patchLines(version.packaging || []),
  };
  const after = costVersion(patched, simulated, { method });

  const price = Number(sellPrice) > 0 ? Number(sellPrice) : recipe.sellPrice;

  return {
    id: recipe.id,
    menuItem: recipe.menuItem,
    before: {
      perPortion: before.perPortion,
      margin: marginFor(recipe.sellPrice, before.perPortion.total),
    },
    after: {
      perPortion: after.perPortion,
      margin: marginFor(price, after.perPortion.total),
    },
    /* The financial effect, stated — the document's "what was the effect?" */
    delta: {
      perPortion: round(after.perPortion.total - before.perPortion.total, 4),
      marginPct: (() => {
        const a = marginFor(price, after.perPortion.total);
        const b = marginFor(recipe.sellPrice, before.perPortion.total);
        return a && b ? round(a.marginPct - b.marginPct, 2) : null;
      })(),
    },
    /* Unchanged by a simulation, and worth repeating: a model built on a recipe
       with unpriced ingredients inherits that gap. */
    complete: after.complete,
    unpriced: after.unpriced,
  };
}

/* Everything a recipe editor needs to offer choices, resolved once. */
export async function recipeMeta(orgId) {
  return {
    ingredients: (await listIngredients(orgId)).map((i) => ({
      id: i.id, name: i.name, stockUnit: i.stockUnit, category: i.category,
    })),
  };
}

export async function getRecipe(orgId, id) {
  return (await readAll(orgId))[String(id || "")] || null;
}
