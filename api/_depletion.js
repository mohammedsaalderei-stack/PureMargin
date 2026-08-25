import { listRecipes, effectiveVersion } from "./_recipes.js";

/* What a scanned bill took out of the store.

   The scanner already knows which menu items were sold and how many. Recipes
   already know what a portion of each contains, in base units, with yield
   applied. Nothing new has to be measured — the two halves simply were never
   joined, so a bill was priced and then the stock it consumed stayed on the
   shelf as far as the ledger was concerned, until somebody counted and found
   a gap they then had to explain.

   This proposes the movements. It does not write them. Two reasons, and both
   matter more than the convenience of doing it automatically:

   A scan is a reading of a photograph. It is usually right and occasionally
   reads 11 as 4, and a wrong `consume` is not a display error — it silently
   moves the balance that the variance screen later treats as fact, which is
   the one number in this product that has to be trustworthy. So a person
   confirms, on a screen showing exactly what will move.

   And a cashier is not an approver. The count workflow already separates the
   person who records from the person who commits, deliberately; letting a
   till-side photo write the ledger directly would route around that in the
   one place where it was most carefully drawn.

   A recipe whose yield is under 100% consumes more than the dish contains —
   `qtyBase` is what ends up on the plate, so the trimmings have to be added
   back or every dish would look cheaper to make than it is. */

export function scaleLine(qtyBase, yieldPct) {
  const factor = Number(yieldPct) > 0 ? Number(yieldPct) / 100 : 1;
  return qtyBase / factor;
}

/* Round to something a store person recognises without pretending to a
   precision the estimate doesn't have. */
function tidy(n) {
  return Math.round(n * 1000) / 1000;
}

export function planFromLines(lines, recipesByItem, { at = Date.now() } = {}) {
  const totals = new Map();
  const unmatched = [];
  const noRecipe = [];

  for (const line of lines || []) {
    if (!line.menuItem) {
      if (line.text) unmatched.push(line.text);
      continue;
    }
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      /* A line whose quantity could not be read is reported, never assumed to
         be one. Assuming would put a number in the ledger that nobody wrote. */
      noRecipe.push({ menuItem: line.menuItem, reason: "qty" });
      continue;
    }

    const recipe = recipesByItem.get(line.menuItem);
    const version = recipe ? effectiveVersion(recipe, at) : null;
    if (!version || !(version.lines || []).length) {
      noRecipe.push({ menuItem: line.menuItem, reason: "recipe" });
      continue;
    }

    const portions = Number(version.portions) > 0 ? Number(version.portions) : 1;
    for (const ing of version.lines) {
      const perPortion = scaleLine(Number(ing.qtyBase) || 0, version.yieldPct) / portions;
      const moved = perPortion * qty;
      if (!(moved > 0)) continue;

      const key = `${ing.ingredientId}|${ing.baseUnit}`;
      const existing = totals.get(key);
      if (existing) existing.qty += moved;
      else {
        totals.set(key, {
          ingredientId: ing.ingredientId,
          name: ing.name,
          unit: ing.baseUnit,
          qty: moved,
          from: [],
        });
      }
      totals.get(key).from.push(line.menuItem);
    }
  }

  const movements = [...totals.values()]
    .map((m) => ({ ...m, qty: tidy(m.qty), from: [...new Set(m.from)] }))
    .filter((m) => m.qty > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    movements,
    /* Named separately so the screen can say which dishes are missing a recipe
       rather than just showing a shorter list than the bill. A silent omission
       here reads as the feature working. */
    noRecipe,
    unmatched,
    complete: movements.length > 0 && !noRecipe.length && !unmatched.length,
  };
}

export async function depletionFor(orgId, lines, { at = Date.now() } = {}) {
  const recipes = await listRecipes(orgId);
  const byItem = new Map(
    (recipes || [])
      .filter((r) => !r.archived)
      .map((r) => [r.menuItem, r]),
  );
  return planFromLines(lines, byItem, { at });
}
