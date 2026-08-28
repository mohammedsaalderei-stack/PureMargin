/* Theoretical versus actual consumption — stage 4, phase 6.

   This is the engine the whole inventory and costing stage was building towards.
   Everything before it recorded facts: what an ingredient is, what came in, what
   went out, what the shelf actually held, what a dish contains. None of those
   answers the owner's real question, which is *where the margin went*.

   The arithmetic is simple. Making it honest is the work:

     theoretical  — what the sales should have consumed: sold quantity × the
                    recipe version in force at the time, drawn at gross (yield
                    applied), summed per ingredient.
     actual       — what the ledger says left the store in the period.
     variance     — actual − theoretical, valued at the period's cost basis.

   A raw variance number is close to useless, because most of it is usually
   explained. So it is decomposed the way the document asks: **waste** is recorded
   and known, **count adjustments** are the shelf disagreeing with the ledger, and
   what remains is **unexplained** — the number worth a manager's attention, since
   it is theft, over-portioning, unrecorded waste or a wrong recipe.

   Two refusals, both deliberate:

   1. **Sales without a recipe are reported, not skipped.** If half the menu has no
      recipe, theoretical usage is understated and the variance is meaningless in
      exactly the direction that looks like a problem. Coverage is a first-class
      output, not a footnote.
   2. **Unpriced ingredients are not valued at zero.** A quantity variance can be
      real while its financial value is unknown; the two are reported separately.

   Isolation: every read is per organization, and the branch list arrives already
   authorized and intersected from the route. Nothing here decides who may see
   what. */

import { listIngredients } from "./_inventory.js";
import { listMovements, MOVEMENT_TYPES } from "./_movements.js";
import { costBasis, costFrom, DEFAULT_COST_METHOD } from "./_costing.js";
import { effectiveVersion } from "./_recipes.js";
import { getJSON } from "./_store.js";

const RECIPES = (orgId) => `inv:${orgId}:recipes`;

const round = (n, places = 4) => (Number.isFinite(n) ? Number(n.toFixed(places)) : n);

/* Movements that represent stock being used up in the period. `transfer_out` is
   excluded on purpose: the stock didn't disappear, it moved to another branch —
   counting it as consumption would invent a variance in one branch and hide the
   matching one in the other. Returns to suppliers are excluded for the same
   reason. */
const CONSUMING = { consume: "consumed", issue: "issued", waste: "waste" };

/* Movements the system wrote itself from sales are excluded from actual usage.

   They are theoretical usage by construction — sold quantity times the recipe
   — so counting them as evidence of what actually left the store would compare
   a number with itself and report a variance of zero however much was being
   wasted. With automatic depletion switched on, leakage is found by counting
   the shelf instead, and the count adjustment is what this screen reads. */
const isAuto = (m) => Boolean(m.auto);

/* An index of recipes by what the POS calls the thing, so a sale can find its
   recipe. Matching is on the item name, case- and space-insensitive, with the
   variant preferred when a recipe declares one — a large latte and a regular one
   are the same POS name and genuinely different costs. */
function indexRecipes(recipes) {
  const key = (name, variant) =>
    `${String(name).trim().toLowerCase()}||${String(variant || "").trim().toLowerCase()}`;
  const index = new Map();
  for (const recipe of recipes) {
    if (recipe.archived) continue;
    index.set(key(recipe.menuItem, recipe.variant), recipe);
  }
  return {
    find: (name, variant) => index.get(key(name, variant)) || index.get(key(name, "")) || null,
  };
}

/* What the sales in this period should have consumed.

   Each sold line is costed against the recipe version in force **at the end of
   the period**, which is the same rule the recipe screen uses. Per-receipt dating
   would be more precise; it is deliberately not done here because the sales rows
   are aggregated per item and period, and a precision the inputs don't support
   would be a false claim rather than a better number. The period is stated with
   the result so the choice is visible. */
export function theoreticalUsage(salesRows, recipes, { at = Date.now() } = {}) {
  const index = indexRecipes(recipes);
  const byIngredient = new Map();
  const matched = [];
  const unmatched = new Map();
  let matchedRevenue = 0;
  let unmatchedRevenue = 0;

  for (const row of salesRows) {
    const recipe = index.find(row.name, row.variant);
    const version = recipe ? effectiveVersion(recipe, at) : null;

    if (!version) {
      /* A sold item with no usable recipe. Named, counted and totalled, because
         this is the number that decides whether the variance below can be
         trusted at all. */
      const seen = unmatched.get(row.name) || { name: row.name, qty: 0, revenue: 0, reason: recipe ? "noversion" : "norecipe" };
      seen.qty += row.qty;
      seen.revenue += row.revenue;
      unmatched.set(row.name, seen);
      unmatchedRevenue += row.revenue;
      continue;
    }

    matchedRevenue += row.revenue;
    matched.push({ name: row.name, branchId: row.branchId, qty: row.qty, recipeId: recipe.id, version: version.version });

    /* Portions sold, not batches: the recipe's quantities make `portions`
       servings, so one sale draws one portion's share. */
    const share = row.qty / version.portions;
    const yieldFactor = version.yieldPct / 100;

    for (const line of version.lines) {
      const row2 = byIngredient.get(line.ingredientId) || {
        ingredientId: line.ingredientId, name: line.name, baseUnit: line.baseUnit, qtyBase: 0, fromItems: new Map(),
      };
      /* Gross draw — yield applied, exactly as the recipe screen shows it. */
      const drawn = (line.qtyBase / yieldFactor) * share;
      row2.qtyBase += drawn;
      row2.fromItems.set(row.name, (row2.fromItems.get(row.name) || 0) + drawn);
      byIngredient.set(line.ingredientId, row2);
    }
    /* Packaging is not stock consumption in the food sense and is left out of
       usage variance — it is costed into the dish, not counted against the
       walk-in. */
  }

  const revenue = matchedRevenue + unmatchedRevenue;
  return {
    byIngredient,
    matched,
    unmatched: [...unmatched.values()].sort((a, b) => b.revenue - a.revenue),
    /* Share of sales revenue that a recipe could actually be found for. */
    coverage: revenue > 0 ? round(matchedRevenue / revenue) : 0,
    revenue: round(revenue, 2),
  };
}

/* What the ledger says actually left the store, split by why.

   Read per branch and kept per branch as well as totalled, so an owner's group
   figure and a branch manager's own figure come from one computation. */
export async function actualUsage(orgId, branchIds, { from, to }) {
  const byIngredient = new Map();

  for (const branchId of branchIds) {
    const ledger = await listMovements(orgId, branchId, { from, to, limit: Infinity });
    for (const m of ledger) {
      /* Reversed entries and the reversals themselves cancel out; excluding both
         is what makes a corrected mistake leave no trace in the totals. */
      if (m.reversedBy || m.reverses) continue;

      /* Auto-written consumption is skipped entirely: see isAuto above. */
      if (isAuto(m) && CONSUMING[m.type]) continue;
      const kind = CONSUMING[m.type] ? m.type : (m.type === "adjust" ? "adjust" : null);
      if (!kind) continue;

      const row = byIngredient.get(m.ingredientId) || {
        ingredientId: m.ingredientId,
        consumed: 0, waste: 0, adjustment: 0,
        byBranch: {},
        movements: 0,
      };
      /* `qtyBase` is signed by the ledger: outgoing is negative, an adjustment
         either way. Usage is the positive magnitude of what left. */
      const out = -m.qtyBase;

      if (m.type === "waste") row.waste += out;
      else if (m.type === "adjust") row.adjustment += out;
      else row.consumed += out;

      const branch = row.byBranch[branchId] || { consumed: 0, waste: 0, adjustment: 0 };
      if (m.type === "waste") branch.waste += out;
      else if (m.type === "adjust") branch.adjustment += out;
      else branch.consumed += out;
      row.byBranch[branchId] = branch;

      row.movements += 1;
      byIngredient.set(m.ingredientId, row);
    }
  }

  return byIngredient;
}

/* The comparison, per ingredient, with the money attached.

   `unexplained` is the point of the whole exercise: total usage minus what the
   recipes account for, minus the waste somebody wrote down, minus what a physical
   count corrected. What's left is the leak. */
export async function varianceReport(orgId, branchIds, {
  salesRows = [], from, to = Date.now(), method = DEFAULT_COST_METHOD,
} = {}) {
  const recipes = Object.values((await getJSON(RECIPES(orgId))) || {});
  const ingredients = await listIngredients(orgId, { includeArchived: true });
  const names = new Map(ingredients.map((i) => [i.id, i]));

  const theoretical = theoreticalUsage(salesRows, recipes, { at: to });
  const actual = await actualUsage(orgId, branchIds, { from, to });
  const basis = await costBasis(orgId, branchIds, { to });

  /* Every ingredient that either side has something to say about. An ingredient
     the recipes expected but the ledger never issued is as interesting as the
     reverse — usually it means consumption isn't being recorded. */
  const ids = new Set([...theoretical.byIngredient.keys(), ...actual.keys()]);

  const items = [];
  for (const id of ids) {
    const th = theoretical.byIngredient.get(id);
    const ac = actual.get(id) || { consumed: 0, waste: 0, adjustment: 0, byBranch: {}, movements: 0 };
    const ingredient = names.get(id);
    const costPerBase = costFrom(basis, id, method);

    const theoreticalBase = th?.qtyBase || 0;
    const actualBase = ac.consumed + ac.waste + ac.adjustment;
    const varianceBase = actualBase - theoreticalBase;
    /* What the recipes don't account for and nobody wrote down. */
    const unexplainedBase = varianceBase - ac.waste - ac.adjustment;

    const value = (qty) => (costPerBase === null ? null : round(qty * costPerBase, 2));

    items.push({
      ingredientId: id,
      name: ingredient?.name || th?.name || id,
      category: ingredient?.category || "",
      baseUnit: th?.baseUnit || null,
      stockUnit: ingredient?.stockUnit || null,
      theoreticalBase: round(theoreticalBase),
      actualBase: round(actualBase),
      consumedBase: round(ac.consumed),
      wasteBase: round(ac.waste),
      adjustmentBase: round(ac.adjustment),
      varianceBase: round(varianceBase),
      unexplainedBase: round(unexplainedBase),
      /* Usage variance as a share of what was expected — the figure that makes a
         50 g variance on herbs and a 50 kg variance on flour comparable. */
      variancePct: theoreticalBase > 0 ? round((varianceBase / theoreticalBase) * 100, 1) : null,
      costPerBase,
      value: {
        theoretical: value(theoreticalBase),
        actual: value(actualBase),
        variance: value(varianceBase),
        waste: value(ac.waste),
        adjustment: value(ac.adjustment),
        unexplained: value(unexplainedBase),
      },
      /* Provenance, per row: which items drove the expectation, and how many
         ledger entries the actual rests on. */
      drivers: th ? [...th.fromItems.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([name, qtyBase]) => ({ name, qtyBase: round(qtyBase) })) : [],
      movements: ac.movements,
      byBranch: ac.byBranch,
      priced: costPerBase !== null,
    });
  }

  /* Ranked by the money at stake, not the quantity: the decision this screen
     supports is where to spend an hour of attention. */
  items.sort((a, b) => Math.abs(b.value.unexplained || 0) - Math.abs(a.value.unexplained || 0));

  const sum = (pick) => round(items.reduce((total, i) => total + (pick(i) || 0), 0), 2);
  const unpriced = items.filter((i) => !i.priced);

  return {
    period: { from: from || null, to },
    method,
    branches: branchIds,
    items,
    totals: {
      theoretical: sum((i) => i.value.theoretical),
      actual: sum((i) => i.value.actual),
      variance: sum((i) => i.value.variance),
      waste: sum((i) => i.value.waste),
      adjustment: sum((i) => i.value.adjustment),
      unexplained: sum((i) => i.value.unexplained),
      /* Theoretical food cost as a share of the sales it came from — the number
         a target is set against. */
      revenue: theoretical.revenue,
      theoreticalCostPct: theoretical.revenue > 0
        ? round((sum((i) => i.value.theoretical) / theoretical.revenue) * 100, 1) : null,
      actualCostPct: theoretical.revenue > 0
        ? round((sum((i) => i.value.actual) / theoretical.revenue) * 100, 1) : null,
    },
    /* Data quality, stated up front rather than implied by a suspiciously
       flattering number. */
    quality: {
      recipeCoverage: theoretical.coverage,
      unmatched: theoretical.unmatched.slice(0, 20),
      unpricedCount: unpriced.length,
      unpriced: unpriced.slice(0, 20).map((i) => ({ ingredientId: i.ingredientId, name: i.name })),
      ledgerEntries: items.reduce((total, i) => total + i.movements, 0),
    },
  };
}
