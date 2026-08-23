/* Ingredient cost sources — stage 4, phase 5.

   Every costed number in the platform eventually asks the same question: what is
   a gram of this worth right now? There is no single correct answer, and the
   document names both of the defensible ones:

   - **last cost** — what the most recent delivery charged. Responsive, and the
     right basis for "what would it cost me to make this today", which is the
     question a menu-price decision asks.
   - **weighted average** — total value received divided by total quantity
     received. Stable, and the right basis for valuing what is on the shelf and
     for a food-cost percentage that isn't whipped around by one odd invoice.

   So the method is a parameter, not a policy baked into the arithmetic, and every
   costed result says which one produced it. Both read the same ledger the
   balances come from, so a cost can always be traced to the receipts behind it —
   the provenance requirement, applied to money rather than quantity.

   Costs are per **base unit** (gram, millilitre, piece) throughout. Per-kilo and
   per-case prices are human-facing conveniences that get converted at the edges;
   arithmetic in the middle uses one scale, because that is how a factor-of-1000
   error stops being possible. */

import { listMovements } from "./_movements.js";

export const COST_METHODS = ["last", "wavg"];
export const DEFAULT_COST_METHOD = "wavg";

/* Entries that are allowed to inform a cost: goods that came in, priced, and not
   subsequently reversed. Issues and waste carry a cost too, but it is a cost they
   inherited — letting them vote would double-count the same delivery. */
const informsCost = (m) =>
  m.qtyBase > 0 &&
  !m.reversedBy &&
  !m.reverses &&
  m.costPerBase !== null &&
  m.costPerBase !== undefined;

/* One pass over the branches' ledgers, returning both methods per ingredient plus
   the evidence each rests on. Done in one read because a recipe costing twenty
   ingredients would otherwise walk the same ledger twenty times.

   `to` bounds the window, so a period's cost of sales can be computed from the
   prices that were true in that period rather than today's. */
export async function costBasis(orgId, branchIds, { to } = {}) {
  const totals = new Map();

  for (const branchId of branchIds) {
    /* No limit: a cost basis that silently ignored older receipts would drift
       without ever saying so. */
    const ledger = await listMovements(orgId, branchId, { to, limit: Infinity });
    for (const m of ledger) {
      if (!informsCost(m)) continue;
      const row = totals.get(m.ingredientId) || {
        qtyBase: 0, value: 0, receipts: 0, last: null, lastAt: 0,
      };
      row.qtyBase += m.qtyBase;
      row.value += m.qtyBase * m.costPerBase;
      row.receipts += 1;
      /* Strictly newer wins. The ledger arrives newest-first, so on a tie — two
         deliveries keyed in the same millisecond — the later entry keeps its
         place instead of being overwritten by the older one behind it. */
      if (row.last === null || m.at > row.lastAt) { row.last = m.costPerBase; row.lastAt = m.at; }
      totals.set(m.ingredientId, row);
    }
  }

  const basis = new Map();
  for (const [ingredientId, row] of totals) {
    basis.set(ingredientId, {
      last: row.last,
      wavg: row.qtyBase > 0 ? row.value / row.qtyBase : null,
      /* Provenance: how many priced deliveries stand behind this, and when the
         newest was. A cost resting on one invoice from March is a different
         claim from one resting on forty. */
      receipts: row.receipts,
      lastAt: row.lastAt || null,
    });
  }
  return basis;
}

/* Pull one method out of a basis, with the fallback stated rather than hidden:
   an ingredient that has never been received priced has **no** cost, and
   returning zero for it would quietly understate food cost — the one failure the
   document is most insistent about. Callers get null and must report it. */
export function costFrom(basis, ingredientId, method = DEFAULT_COST_METHOD) {
  const row = basis.get(ingredientId);
  if (!row) return null;
  const value = row[method === "last" ? "last" : "wavg"];
  return Number.isFinite(value) ? value : null;
}

export function evidenceFor(basis, ingredientId) {
  const row = basis.get(ingredientId);
  return row ? { receipts: row.receipts, lastAt: row.lastAt } : { receipts: 0, lastAt: null };
}
