import { listIngredients } from "./_inventory.js";
import { slug } from "./_inventory.js";

/* A supplier invoice, turned into something the store can receive.

   The kitchen already photographs a delivery note to check it against what
   arrived. This reads the same photograph and matches each line to an
   ingredient the business already keeps, so a delivery becomes stock and a
   fresh unit cost without anybody typing a purchase order.

   The matching is done here, against the real ingredient list, and never by
   the model. A model asked to "return the ingredient id" will invent a
   plausible one, and an invented id is worse than no match: it writes a
   delivery against something that does not exist, or worse, against something
   that does and is not it.

   What the model is asked for is what is printed — a description, a quantity,
   a unit, a line total. Everything after that is arithmetic and lookup, and
   both belong in code. */

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/* Cheap similarity, deliberately not clever.

   A supplier writes "TOMATO RED 5KG BOX" where the ingredient is "Tomatoes".
   Token overlap catches that; an edit-distance score would also catch
   "Potatoes", which is the sort of near-miss that quietly ruins a stock
   balance. When nothing overlaps, the honest answer is no match, and the
   screen asks a person. */
/* Crude singular/plural folding. A shelf is labelled "Tomatoes" and an invoice
   says "TOMATO RED 5KG", which shares no token at all until the plural is
   taken off. Not linguistics — just enough that the commonest mismatch in a
   produce delivery stops costing a manual match. */
function stem(word) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

const tokens = (s) =>
  new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2).map(stem));

function score(text, name) {
  const a = tokens(text);
  const b = tokens(name);
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const w of b) if (a.has(w)) hits += 1;
  /* Measured against the ingredient's own words, so a long supplier
     description does not dilute a complete match. */
  return hits / b.size;
}

export function bestMatch(text, ingredients, floor = 0.5) {
  let winner = null;
  let best = 0;
  for (const ing of ingredients) {
    const s = score(text, ing.name);
    if (s > best) { best = s; winner = ing; }
  }
  return best >= floor ? { ingredient: winner, confidence: Math.round(best * 100) / 100 } : null;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function buildPurchase(parsed, ingredients) {
  const lines = (Array.isArray(parsed?.lines) ? parsed.lines : []).map((line) => {
    const text = String(line.text || line.description || "").trim();
    const qty = num(line.qty);
    const total = num(line.amount);
    const hit = bestMatch(text, ingredients);

    /* Unit cost is derived, never read. An invoice usually prints a line total
       and a quantity; the per-unit figure it sometimes also prints is rounded
       for display, and using it would make the stock value drift from what was
       actually paid. */
    const unitCost = qty && total ? Math.round((total / qty) * 10000) / 10000 : null;

    return {
      text,
      qty,
      unit: String(line.unit || "").trim(),
      amount: total,
      unitCost,
      ingredientId: hit?.ingredient?.id || null,
      ingredientName: hit?.ingredient?.name || null,
      confidence: hit?.confidence ?? 0,
      /* The unit the store keeps this in, so the screen can warn when the
         invoice speaks in cases and the shelf counts kilos. */
      stockUnit: hit?.ingredient?.stockUnit || null,
    };
  });

  const matched = lines.filter((l) => l.ingredientId);
  return {
    supplier: String(parsed?.supplier || "").trim(),
    invoiceNo: String(parsed?.invoiceNo || "").trim(),
    date: String(parsed?.date || "").trim(),
    total: num(parsed?.total),
    lines,
    unmatched: lines.filter((l) => !l.ingredientId).map((l) => l.text).filter(Boolean),
    /* A count rather than a boolean, because "6 of 9 lines matched" is what
       decides whether somebody fixes three rows or gives up and types it. */
    matchedCount: matched.length,
    complete: lines.length > 0 && matched.length === lines.length,
  };
}

export async function matchPurchase(orgId, parsed) {
  const ingredients = orgId ? await listIngredients(orgId) : [];
  return buildPurchase(parsed, ingredients);
}

export { slug };
